// Copier ce fichier en "config.h" (même dossier) et remplir les valeurs.
// Ne jamais publier config.h : il contient le mot de passe Wi-Fi et la clé API.
#pragma once

// --- Réseau Wi-Fi du ménage ---
#define WIFI_SSID      "NomDuReseau"
#define WIFI_PASSWORD  "MotDePasseWifi"

// --- API (adresse Render, sans "/" final) ---
#define API_URL        "https://votre-api.onrender.com"

// --- Identité du boîtier (créée dans Paramètres > Nouveau boîtier) ---
#define BOITIER_ID     "BOITIER-001"
#define CLE_API        "collez_ici_la_cle_affichee_une_seule_fois"

// --- Paramètres de fonctionnement ---
#define PERIODE_LECTURE_MS   10000UL   // lecture du PZEM toutes les 10 s
#define PERIODE_ENVOI_MS     900000UL  // envoi toutes les 15 min
#define REESSAI_RAPIDE_MS    90000UL   // nouvel essai 90 s après un échec (réveil du serveur)
#define TAILLE_TAMPON        1440      // 1 440 mesures = 24 h de coupure
#define TAILLE_LOT           60        // mesures par requête HTTP

// --- Broches de la liaison série avec le PZEM-004T (UART2) ---
#define PZEM_RX_PIN    16   // reçoit le TX du PZEM (via le pont diviseur)
#define PZEM_TX_PIN    17   // vers le RX du PZEM

// --- Certificat racine du serveur (recommandé) ---
// Coller ici le certificat racine (format PEM) de l'autorité qui signe le certificat
// de votre API, pour que l'ESP32 vérifie qu'il parle bien à votre serveur.
// Laisser vide UNIQUEMENT pendant les essais : la connexion reste chiffrée,
// mais l'identité du serveur n'est alors pas vérifiée.
#define ROOT_CA ""
