// Routes de l'usager connecté : consommation, historique, seuil, alertes
const express = require('express');
const { pool } = require('../db');
const { exigerUtilisateur } = require('../auth');
const valider = require('../validation');
const { resume, historique, PERIODES } = require('../consommation');

const router = express.Router();
router.use(exigerUtilisateur);

// L'usager doit être rattaché à un ménage
function menageDe(req, res) {
  const id = req.utilisateur.menage_id;
  if (!id) {
    res.status(404).json({ erreur: 'Aucun ménage associé à ce compte' });
    return null;
  }
  return id;
}

router.get('/consommation/resume', async (req, res) => {
  const menageId = menageDe(req, res);
  if (!menageId) return;
  res.json(await resume(menageId));
});

router.get('/consommation/historique', async (req, res) => {
  const menageId = menageDe(req, res);
  if (!menageId) return;
  const periode = String(req.query.periode || 'jour');
  if (!Object.hasOwn(PERIODES, periode)) {
    return res.status(400).json({ erreur: 'Période invalide (jour, semaine ou mois)' });
  }
  return res.json(await historique(menageId, periode));
});

router.get('/seuil', async (req, res) => {
  const menageId = menageDe(req, res);
  if (!menageId) return;
  const { rows } = await pool.query(
    'SELECT energie_max_jour_kwh, actif FROM seuil WHERE menage_id = $1',
    [menageId]
  );
  res.json(rows[0] || null);
});

router.put('/seuil', async (req, res) => {
  const menageId = menageDe(req, res);
  if (!menageId) return;
  const max = valider.nombre(req.body?.energie_max_jour_kwh, { min: 0.01, max: 1000 });
  const actif = typeof req.body?.actif === 'boolean' ? req.body.actif : true;
  if (max === null) {
    return res.status(400).json({ erreur: 'Le seuil doit être un nombre entre 0,01 et 1 000 kWh' });
  }
  const { rows } = await pool.query(
    `INSERT INTO seuil (menage_id, energie_max_jour_kwh, actif) VALUES ($1, $2, $3)
     ON CONFLICT (menage_id) DO UPDATE SET energie_max_jour_kwh = EXCLUDED.energie_max_jour_kwh, actif = EXCLUDED.actif
     RETURNING energie_max_jour_kwh, actif`,
    [menageId, max, actif]
  );
  return res.json(rows[0]);
});

router.get('/alertes', async (req, res) => {
  const menageId = menageDe(req, res);
  if (!menageId) return;
  const { rows } = await pool.query(
    `SELECT a.id, a.date_heure, a.energie_mesuree_kwh, a.message, a.lue
     FROM alerte a JOIN seuil s ON s.id = a.seuil_id
     WHERE s.menage_id = $1 ORDER BY a.date_heure DESC LIMIT 20`,
    [menageId]
  );
  res.json(rows);
});

router.patch('/alertes/:id/lue', async (req, res) => {
  const menageId = menageDe(req, res);
  if (!menageId) return;
  const id = valider.entier(req.params.id);
  if (id === null) return res.status(400).json({ erreur: 'Identifiant invalide' });
  // La jointure garantit qu'un usager ne modifie que les alertes de son ménage
  const r = await pool.query(
    `UPDATE alerte a SET lue = TRUE FROM seuil s
     WHERE a.id = $1 AND a.seuil_id = s.id AND s.menage_id = $2`,
    [id, menageId]
  );
  if (r.rowCount === 0) return res.status(404).json({ erreur: 'Alerte introuvable' });
  return res.status(204).end();
});

module.exports = router;
