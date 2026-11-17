/*
 * Boîtier de mesure de la consommation électrique domestique
 * TFE Bac 3 Génie Informatique – ESI / UNILU
 *
 * Matériel : ESP32 DevKit + PZEM-004T v3.0 (100 A, avec tore)
 * Bibliothèque requise : "PZEM-004T-v30" (Jakub Mandula), via le gestionnaire de bibliothèques Arduino
 *
 * Fonctionnement :
 *  1. Lecture du PZEM toutes les 10 s ;
 *  2. Moyenne par minute placée dans un tampon circulaire (24 h de capacité) ;
 *  3. Envoi des mesures par lots en HTTPS toutes les 15 min ;
 *  4. Le tampon n'est vidé qu'après la confirmation du serveur (HTTP 201).
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>
#include <time.h>
#include "config.h"

// ---------- Structures ----------
struct Mesure {
  uint32_t t;   // horodatage Unix (s)
  float v;      // tension (V)
  float i;      // courant (A)
  float p;      // puissance active (W)
  float pf;     // facteur de puissance
  float e;      // énergie cumulée (kWh)
};

// Tampon circulaire : la mesure la plus ancienne est écrasée quand il est plein
Mesure tampon[TAILLE_TAMPON];
uint16_t debutTampon = 0;
uint16_t nbTampon = 0;

PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

// Accumulateurs pour la moyenne de la minute en cours
float sommeV = 0, sommeI = 0, sommeP = 0, sommePF = 0, derniereE = 0;
uint16_t nbLectures = 0;
uint32_t minuteEnCours = 0;

unsigned long derniereLecture = 0;
unsigned long prochainEnvoi = PERIODE_ENVOI_MS;

// ---------- Tampon ----------
void ajouterAuTampon(const Mesure &m) {
  uint16_t position = (debutTampon + nbTampon) % TAILLE_TAMPON;
  tampon[position] = m;
  if (nbTampon < TAILLE_TAMPON) {
    nbTampon++;
  } else {
    debutTampon = (debutTampon + 1) % TAILLE_TAMPON;  // tampon plein : on écrase la plus ancienne
  }
}

void retirerDuTampon(uint16_t n) {
  debutTampon = (debutTampon + n) % TAILLE_TAMPON;
  nbTampon -= n;
}

// ---------- Réseau ----------
bool connecterWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.print("Connexion au Wi-Fi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int k = 0; k < 20 && WiFi.status() != WL_CONNECTED; k++) {
    delay(500);
    Serial.print('.');
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " échec");
  return WiFi.status() == WL_CONNECTED;
}

bool heureSynchronisee() {
  return time(nullptr) > 1700000000;  // après novembre 2023 : l'heure NTP a été reçue
}

void synchroniserHeure() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // heure UTC ; le serveur gère le fuseau
  for (int k = 0; k < 20 && !heureSynchronisee(); k++) delay(500);
  Serial.println(heureSynchronisee() ? "Heure synchronisée" : "Heure non synchronisée");
}

// ---------- Mesure ----------
void lirePzem() {
  float v = pzem.voltage();
  float i = pzem.current();
  float p = pzem.power();
  float e = pzem.energy();
  float pf = pzem.pf();
  if (isnan(v) || isnan(i) || isnan(p) || isnan(e)) {
    Serial.println("Lecture PZEM invalide (vérifier le câblage)");
    return;
  }
  if (!heureSynchronisee()) return;  // sans heure fiable, la mesure ne peut pas être datée

  uint32_t maintenant = (uint32_t)time(nullptr);
  uint32_t minute = maintenant / 60;

  // Changement de minute : on enregistre la moyenne de la minute écoulée
  if (minute != minuteEnCours && nbLectures > 0) {
    Mesure m;
    m.t = minuteEnCours * 60;
    m.v = sommeV / nbLectures;
    m.i = sommeI / nbLectures;
    m.p = sommeP / nbLectures;
    m.pf = sommePF / nbLectures;
    m.e = derniereE;  // énergie cumulée : on garde la dernière valeur, pas une moyenne
    ajouterAuTampon(m);
    Serial.printf("Minute enregistrée : %.1f V, %.0f W, %.3f kWh (tampon : %u)\n", m.v, m.p, m.e, nbTampon);
    sommeV = sommeI = sommeP = sommePF = 0;
    nbLectures = 0;
  }
  minuteEnCours = minute;
  sommeV += v;
  sommeI += i;
  sommeP += p;
  sommePF += isnan(pf) ? 0 : pf;
  derniereE = e;
  nbLectures++;
}

// ---------- Envoi ----------
// Construit le JSON d'un lot : {"mesures":[{"t":..,"v":..,"i":..,"p":..,"pf":..,"e":..}, ...]}
String construireLot(uint16_t n) {
  String json;
  json.reserve(40 + n * 90);
  json = "{\"mesures\":[";
  char ligne[120];
  for (uint16_t k = 0; k < n; k++) {
    const Mesure &m = tampon[(debutTampon + k) % TAILLE_TAMPON];
    snprintf(ligne, sizeof(ligne), "%s{\"t\":%lu,\"v\":%.1f,\"i\":%.3f,\"p\":%.1f,\"pf\":%.2f,\"e\":%.3f}",
             k ? "," : "", (unsigned long)m.t, m.v, m.i, m.p, m.pf, m.e);
    json += ligne;
  }
  json += "]}";
  return json;
}

// Envoie un lot ; renvoie le code HTTP (201 = reçu, négatif = erreur réseau)
int envoyerLot(uint16_t n) {
  WiFiClientSecure client;
  if (strlen(ROOT_CA) > 0) {
    client.setCACert(ROOT_CA);
  } else {
    client.setInsecure();  // essais uniquement : voir config.h
  }
  HTTPClient http;
  http.setConnectTimeout(20000);
  http.setTimeout(60000);  // le serveur gratuit peut mettre environ une minute à se réveiller
  if (!http.begin(client, String(API_URL) + "/api/mesures")) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Boitier-Id", BOITIER_ID);
  http.addHeader("X-Cle-Api", CLE_API);
  int code = http.POST(construireLot(n));
  Serial.printf("Envoi de %u mesures : HTTP %d\n", n, code);
  http.end();
  return code;
}

// Vide le tampon lot par lot ; s'arrête au premier échec (les mesures restent en mémoire)
bool envoyerTampon() {
  while (nbTampon > 0) {
    uint16_t n = nbTampon < TAILLE_LOT ? nbTampon : TAILLE_LOT;
    int code = envoyerLot(n);
    if (code == 400) {
      // Lot jugé invalide par le serveur : le renvoyer bloquerait le tampon indéfiniment
      Serial.println("Lot rejeté (données invalides) : abandonné");
      retirerDuTampon(n);
      continue;
    }
    if (code != 201) return false;  // réseau, serveur en veille ou clé refusée : on garde le lot
    retirerDuTampon(n);
  }
  return true;
}

// ---------- Programme principal ----------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nBoîtier de mesure – démarrage");
  if (connecterWifi()) synchroniserHeure();
}

void loop() {
  unsigned long ms = millis();

  if (ms - derniereLecture >= PERIODE_LECTURE_MS) {
    derniereLecture = ms;
    lirePzem();
  }

  // (soustraction en entiers non signés : correcte même quand millis() repasse à zéro)
  if ((long)(ms - prochainEnvoi) >= 0) {
    bool succes = false;
    if (connecterWifi()) {
      if (!heureSynchronisee()) synchroniserHeure();
      succes = envoyerTampon();
    }
    // Après un échec, nouvel essai rapide (le serveur s'est peut-être réveillé entre-temps)
    prochainEnvoi = millis() + (succes ? PERIODE_ENVOI_MS : REESSAI_RAPIDE_MS);
  }

  delay(50);
}
