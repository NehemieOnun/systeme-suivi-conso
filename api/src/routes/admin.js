// Routes de l'administrateur : ménages, utilisateurs, boîtiers, tarif
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { exigerUtilisateur, exigerAdmin } = require('../auth');
const valider = require('../validation');

const router = express.Router();
router.use(exigerUtilisateur, exigerAdmin);

router.get('/menages', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.adresse, m.commune,
            (SELECT COUNT(*) FROM boitier b WHERE b.menage_id = m.id)::int AS nb_boitiers
     FROM menage m ORDER BY m.id`
  );
  res.json(rows);
});

router.post('/menages', async (req, res) => {
  const adresse = valider.texte(req.body?.adresse, { max: 255 });
  const commune = valider.texte(req.body?.commune, { max: 50 });
  if (!adresse || !commune) return res.status(400).json({ erreur: 'Adresse et commune obligatoires' });
  const { rows } = await pool.query(
    'INSERT INTO menage (adresse, commune) VALUES ($1, $2) RETURNING id, adresse, commune',
    [adresse, commune]
  );
  return res.status(201).json(rows[0]);
});

router.get('/utilisateurs', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nom, email, role, menage_id, cree_le FROM utilisateur ORDER BY id'
  );
  res.json(rows);
});

router.post('/utilisateurs', async (req, res) => {
  const nom = valider.texte(req.body?.nom, { max: 100 });
  const email = valider.email(req.body?.email);
  const motDePasse = valider.texte(req.body?.motDePasse, { min: 8, max: 128 });
  const role = req.body?.role === 'admin' ? 'admin' : 'usager';
  const menageId = req.body?.menage_id ? valider.entier(req.body.menage_id) : null;
  if (!nom || !email || !motDePasse) {
    return res.status(400).json({ erreur: 'Nom, e-mail valide et mot de passe (8 caractères minimum) obligatoires' });
  }
  if (req.body?.menage_id && menageId === null) return res.status(400).json({ erreur: 'Ménage invalide' });
  const hash = await bcrypt.hash(motDePasse, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO utilisateur (nom, email, mot_de_passe_hash, role, menage_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nom, email, role, menage_id`,
      [nom, email, hash, role, menageId]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erreur: 'Cet e-mail est déjà utilisé' });
    if (err.code === '23503') return res.status(400).json({ erreur: 'Ménage introuvable' });
    throw err;
  }
});

router.get('/boitiers', async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, menage_id, numero_serie, to_char(date_installation, 'YYYY-MM-DD') AS date_installation, derniere_connexion FROM boitier ORDER BY id"
  );
  res.json(rows);
});

// Crée un boîtier et renvoie sa clé API EN CLAIR une seule fois (à copier dans config.h)
router.post('/boitiers', async (req, res) => {
  const numero = valider.texte(req.body?.numero_serie, { max: 50 });
  const menageId = valider.entier(req.body?.menage_id);
  if (!numero || !/^[A-Za-z0-9_-]+$/.test(numero) || menageId === null) {
    return res.status(400).json({ erreur: 'Numéro de série (lettres, chiffres, - et _) et ménage obligatoires' });
  }
  const cle = crypto.randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(cle, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO boitier (menage_id, numero_serie, cle_api_hash) VALUES ($1, $2, $3)
       RETURNING id, menage_id, numero_serie, to_char(date_installation, 'YYYY-MM-DD') AS date_installation`,
      [menageId, numero, hash]
    );
    return res.status(201).json({ ...rows[0], cle_api: cle });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erreur: 'Ce numéro de série existe déjà' });
    if (err.code === '23503') return res.status(400).json({ erreur: 'Ménage introuvable' });
    throw err;
  }
});

router.get('/tarifs', async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, prix_kwh_cdf::float AS prix_kwh_cdf, to_char(date_debut, 'YYYY-MM-DD') AS date_debut FROM tarif ORDER BY date_debut DESC"
  );
  res.json(rows);
});

router.post('/tarifs', async (req, res) => {
  const prix = valider.nombre(req.body?.prix_kwh_cdf, { min: 0.01, max: 1e7 });
  const dateDebut = valider.date(req.body?.date_debut);
  if (prix === null || !dateDebut) {
    return res.status(400).json({ erreur: 'Prix positif et date (AAAA-MM-JJ) obligatoires' });
  }
  const { rows } = await pool.query(
    "INSERT INTO tarif (prix_kwh_cdf, date_debut) VALUES ($1, $2) RETURNING id, prix_kwh_cdf::float AS prix_kwh_cdf, to_char(date_debut, 'YYYY-MM-DD') AS date_debut",
    [prix, dateDebut]
  );
  return res.status(201).json(rows[0]);
});

module.exports = router;
