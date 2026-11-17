// Tests automatisés de l'API (base de test locale, jamais la base de production)
// Lancer : npm test   (lit .env.test)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

assert.match(process.env.DATABASE_URL || '', /suivi_test/, 'Les tests doivent tourner sur la base suivi_test');

const { pool } = require('../src/db');
const app = require('../src/app');

let serveur, base, jetonAdmin, jetonUsager, jetonAutre, menageId, autreMenageId, cleBoitier;
const NUMERO = 'TEST-001';

async function api(chemin, { methode = 'GET', corps, jeton, entetes = {} } = {}) {
  const rep = await fetch(base + chemin, {
    method: methode,
    headers: {
      'Content-Type': 'application/json',
      ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      ...entetes
    },
    body: corps === undefined ? undefined : typeof corps === 'string' ? corps : JSON.stringify(corps)
  });
  const texte = await rep.text();
  let json = null;
  try { json = texte ? JSON.parse(texte) : null; } catch { json = texte; }
  return { statut: rep.status, json };
}

const enteteBoitier = (cle = cleBoitier) => ({ 'X-Boitier-Id': NUMERO, 'X-Cle-Api': cle });
// Mesure valide, horodatée "minutesAvant" minutes avant maintenant
const mesure = (minutesAvant, e, extra = {}) => ({
  t: Math.floor(Date.now() / 60000) * 60 - minutesAvant * 60,
  v: 220.5, i: 2.1, p: 420, pf: 0.91, e, ...extra
});

before(async () => {
  await pool.query('DROP TABLE IF EXISTS alerte, seuil, mesure, boitier, utilisateur, menage, tarif CASCADE');
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  await pool.query(
    `INSERT INTO utilisateur (nom, email, mot_de_passe_hash, role) VALUES ('Admin', 'admin@test.cd', $1, 'admin')`,
    [await bcrypt.hash('AdminTest123', 10)]
  );
  serveur = app.listen(0);
  base = `http://127.0.0.1:${serveur.address().port}`;
});

after(async () => {
  serveur.close();
  await pool.end();
});

test('T01 – Le point de santé répond', async () => {
  const r = await api('/api/sante');
  assert.equal(r.statut, 200);
  assert.equal(r.json.ok, true);
});

test('T02 – Connexion refusée avec un mauvais mot de passe', async () => {
  const r = await api('/api/auth/connexion', { methode: 'POST', corps: { email: 'admin@test.cd', motDePasse: 'faux' } });
  assert.equal(r.statut, 401);
});

test('T03 – Connexion acceptée avec les bons identifiants', async () => {
  const r = await api('/api/auth/connexion', { methode: 'POST', corps: { email: 'ADMIN@test.cd', motDePasse: 'AdminTest123' } });
  assert.equal(r.statut, 200);
  assert.ok(r.json.jeton);
  assert.equal(r.json.utilisateur.role, 'admin');
  jetonAdmin = r.json.jeton;
});

test('T04 – Tentative d\'injection SQL dans l\'e-mail sans effet', async () => {
  const r = await api('/api/auth/connexion', { methode: 'POST', corps: { email: "' OR '1'='1' --", motDePasse: 'x' } });
  assert.ok([400, 401].includes(r.statut));
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM utilisateur');
  assert.equal(rows[0].n, 1);
});

test('T05 – Route protégée inaccessible sans jeton', async () => {
  const r = await api('/api/consommation/resume');
  assert.equal(r.statut, 401);
});

test('T06 – L\'administrateur crée ménages, usagers, boîtier et tarif', async () => {
  let r = await api('/api/admin/menages', { methode: 'POST', jeton: jetonAdmin, corps: { adresse: 'Avenue Test 12, <script>alert(1)</script>', commune: 'Kampemba' } });
  assert.equal(r.statut, 201);
  menageId = r.json.id;
  r = await api('/api/admin/menages', { methode: 'POST', jeton: jetonAdmin, corps: { adresse: 'Autre adresse', commune: 'Lubumbashi' } });
  autreMenageId = r.json.id;

  r = await api('/api/admin/utilisateurs', { methode: 'POST', jeton: jetonAdmin, corps: { nom: 'Usager Test', email: 'usager@test.cd', motDePasse: 'Usager12345', menage_id: menageId } });
  assert.equal(r.statut, 201);
  r = await api('/api/admin/utilisateurs', { methode: 'POST', jeton: jetonAdmin, corps: { nom: 'Autre', email: 'autre@test.cd', motDePasse: 'Autre123456', menage_id: autreMenageId } });
  assert.equal(r.statut, 201);
  r = await api('/api/admin/utilisateurs', { methode: 'POST', jeton: jetonAdmin, corps: { nom: 'Doublon', email: 'usager@test.cd', motDePasse: 'Usager12345' } });
  assert.equal(r.statut, 409);

  r = await api('/api/admin/boitiers', { methode: 'POST', jeton: jetonAdmin, corps: { numero_serie: NUMERO, menage_id: menageId } });
  assert.equal(r.statut, 201);
  assert.equal(r.json.cle_api.length, 48);
  cleBoitier = r.json.cle_api;
  const { rows } = await pool.query('SELECT cle_api_hash FROM boitier WHERE numero_serie = $1', [NUMERO]);
  assert.notEqual(rows[0].cle_api_hash, cleBoitier, 'la clé ne doit pas être stockée en clair');

  r = await api('/api/admin/tarifs', { methode: 'POST', jeton: jetonAdmin, corps: { prix_kwh_cdf: 200, date_debut: '2026-01-01' } });
  assert.equal(r.statut, 201);
});

test('T07 – Un usager n\'a pas accès aux routes d\'administration', async () => {
  let r = await api('/api/auth/connexion', { methode: 'POST', corps: { email: 'usager@test.cd', motDePasse: 'Usager12345' } });
  jetonUsager = r.json.jeton;
  r = await api('/api/auth/connexion', { methode: 'POST', corps: { email: 'autre@test.cd', motDePasse: 'Autre123456' } });
  jetonAutre = r.json.jeton;
  r = await api('/api/admin/utilisateurs', { jeton: jetonUsager });
  assert.equal(r.statut, 403);
});

test('T08 – Lot refusé sans clé ou avec une clé incorrecte', async () => {
  let r = await api('/api/mesures', { methode: 'POST', corps: { mesures: [mesure(5, 1)] } });
  assert.equal(r.statut, 401);
  r = await api('/api/mesures', { methode: 'POST', corps: { mesures: [mesure(5, 1)] }, entetes: enteteBoitier('mauvaise-cle') });
  assert.equal(r.statut, 401);
});

test('T09 – Mesures hors plage, futures ou lot trop grand refusés', async () => {
  let r = await api('/api/mesures', { methode: 'POST', corps: { mesures: [mesure(5, 1, { v: 400 })] }, entetes: enteteBoitier() });
  assert.equal(r.statut, 400);
  r = await api('/api/mesures', { methode: 'POST', corps: { mesures: [mesure(-60, 1)] }, entetes: enteteBoitier() });
  assert.equal(r.statut, 400);
  r = await api('/api/mesures', { methode: 'POST', corps: { mesures: Array.from({ length: 121 }, (_, k) => mesure(200 - k, 1)) }, entetes: enteteBoitier() });
  assert.equal(r.statut, 400);
  r = await api('/api/mesures', { methode: 'POST', corps: '{"mesures": [', entetes: enteteBoitier() });
  assert.equal(r.statut, 400);
});

test('T10 – Lot valide enregistré, puis renvoi sans doublon', async () => {
  const lot = [mesure(4, 1.0), mesure(3, 1.5), mesure(2, 2.25)];
  let r = await api('/api/mesures', { methode: 'POST', corps: { mesures: lot }, entetes: enteteBoitier() });
  assert.equal(r.statut, 201);
  assert.equal(r.json.inserees, 3);
  r = await api('/api/mesures', { methode: 'POST', corps: { mesures: lot }, entetes: enteteBoitier() });
  assert.equal(r.statut, 201);
  assert.equal(r.json.inserees, 0);
});

test('T11 – Énergie du jour et coût calculés correctement (avec remise à zéro du compteur)', async () => {
  // Compteur : 1,0 → 1,5 → 2,25 puis remise à zéro → 0,1 : énergie = 0,5 + 0,75 + 0,1 = 1,35 kWh
  await api('/api/mesures', { methode: 'POST', corps: { mesures: [mesure(1, 0.1)] }, entetes: enteteBoitier() });
  const r = await api('/api/consommation/resume', { jeton: jetonUsager });
  assert.equal(r.statut, 200);
  assert.equal(r.json.energie_jour_kwh, 1.35);
  assert.equal(r.json.tarif_kwh_cdf, 200);
  assert.equal(r.json.cout_jour_cdf, 270); // 1,35 × 200
  assert.equal(r.json.derniere_mesure.energie_kwh, 0.1);
});

test('T12 – Historique du jour : 24 tranches dont la somme égale le total', async () => {
  const r = await api('/api/consommation/historique?periode=jour', { jeton: jetonUsager });
  assert.equal(r.statut, 200);
  assert.equal(r.json.tranches.length, 24);
  const somme = r.json.tranches.reduce((s, t) => s + t.energie_kwh, 0);
  assert.ok(Math.abs(somme - 1.35) < 0.001);
  const mois = await api('/api/consommation/historique?periode=mois', { jeton: jetonUsager });
  assert.equal(mois.json.tranches.length, 30);
  const invalide = await api('/api/consommation/historique?periode=annee', { jeton: jetonUsager });
  assert.equal(invalide.statut, 400);
});

test('T13 – Seuil dépassé : une seule alerte par jour', async () => {
  let r = await api('/api/seuil', { methode: 'PUT', jeton: jetonUsager, corps: { energie_max_jour_kwh: -5 } });
  assert.equal(r.statut, 400);
  r = await api('/api/seuil', { methode: 'PUT', jeton: jetonUsager, corps: { energie_max_jour_kwh: 1 } });
  assert.equal(r.statut, 200);
  r = await api('/api/mesures', { methode: 'POST', corps: { mesures: [mesure(0, 0.2)] }, entetes: enteteBoitier() });
  assert.equal(r.json.alerte_creee, true);
  r = await api('/api/mesures', { methode: 'POST', corps: { mesures: [{ ...mesure(0, 0.3), t: mesure(0, 0).t + 30 }] }, entetes: enteteBoitier() });
  assert.equal(r.json.alerte_creee, false);
  r = await api('/api/alertes', { jeton: jetonUsager });
  assert.equal(r.json.length, 1);
});

test('T14 – Un usager ne voit ni ne modifie les alertes d\'un autre ménage', async () => {
  const { json: alertes } = await api('/api/alertes', { jeton: jetonUsager });
  let r = await api(`/api/alertes/${alertes[0].id}/lue`, { methode: 'PATCH', jeton: jetonAutre });
  assert.equal(r.statut, 404);
  r = await api('/api/alertes', { jeton: jetonAutre });
  assert.equal(r.json.length, 0);
  r = await api(`/api/alertes/${alertes[0].id}/lue`, { methode: 'PATCH', jeton: jetonUsager });
  assert.equal(r.statut, 204);
});

test('T15 – Le texte saisi est stocké tel quel (l\'échappement se fait à l\'affichage)', async () => {
  const r = await api('/api/admin/menages', { jeton: jetonAdmin });
  assert.ok(r.json[0].adresse.includes('<script>'));
});
