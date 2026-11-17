// POST /api/auth/connexion : vérifie l'e-mail et le mot de passe, renvoie un jeton
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { creerJeton } = require('../auth');
const valider = require('../validation');

const router = express.Router();

// Limite les tentatives pour freiner les attaques par force brute
const limiteConnexion = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

router.post('/connexion', limiteConnexion, async (req, res) => {
  const email = valider.email(req.body?.email);
  const motDePasse = valider.texte(req.body?.motDePasse, { min: 1, max: 128 });
  if (!email || !motDePasse) {
    return res.status(400).json({ erreur: 'E-mail ou mot de passe invalide' });
  }
  const { rows } = await pool.query(
    'SELECT id, nom, email, role, menage_id, mot_de_passe_hash FROM utilisateur WHERE email = $1',
    [email]
  );
  const u = rows[0];
  const valide = u ? await bcrypt.compare(motDePasse, u.mot_de_passe_hash) : false;
  if (!valide) {
    return res.status(401).json({ erreur: 'Identifiants incorrects' });
  }
  return res.json({
    jeton: creerJeton(u),
    utilisateur: { id: u.id, nom: u.nom, email: u.email, role: u.role, menage_id: u.menage_id }
  });
});

module.exports = router;
