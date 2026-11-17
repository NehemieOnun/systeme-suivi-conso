// POST /api/mesures : réception d'un lot de mesures envoyé par un boîtier ESP32
const express = require('express');
const { pool } = require('../db');
const { exigerBoitier } = require('../auth');
const valider = require('../validation');
const { verifierSeuil } = require('../consommation');

const router = express.Router();
const TAILLE_MAX_LOT = 120;

router.post('/', exigerBoitier, async (req, res) => {
  const lot = req.body?.mesures;
  if (!Array.isArray(lot) || lot.length === 0 || lot.length > TAILLE_MAX_LOT) {
    return res.status(400).json({ erreur: `Le lot doit contenir entre 1 et ${TAILLE_MAX_LOT} mesures` });
  }
  const mesures = lot.map(valider.mesure);
  const invalide = mesures.findIndex((m) => m === null);
  if (invalide !== -1) {
    return res.status(400).json({ erreur: `Mesure n° ${invalide + 1} invalide` });
  }

  const client = await pool.connect();
  let inserees = 0;
  try {
    await client.query('BEGIN');
    for (const m of mesures) {
      // ON CONFLICT : une mesure déjà reçue (lot renvoyé) est ignorée
      const r = await client.query(
        `INSERT INTO mesure (boitier_id, horodatage, tension_v, courant_a, puissance_w, facteur_puissance, energie_kwh)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (boitier_id, horodatage) DO NOTHING`,
        [req.boitier.id, m.horodatage, m.tension_v, m.courant_a, m.puissance_w, m.facteur_puissance, m.energie_kwh]
      );
      inserees += r.rowCount;
    }
    await client.query('UPDATE boitier SET derniere_connexion = NOW() WHERE id = $1', [req.boitier.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const alerte = await verifierSeuil(req.boitier.menage_id);
  return res.status(201).json({ recues: mesures.length, inserees, alerte_creee: alerte !== null });
});

module.exports = router;
