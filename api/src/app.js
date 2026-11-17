// Application Express : sécurité, routes et gestion des erreurs
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { pool } = require('./db');

const app = express();
app.set('trust proxy', 1); // Render place l'application derrière un proxy

app.use(helmet());
// Seul le tableau de bord (son adresse Vercel) est autorisé à appeler l'API depuis un navigateur
const origines = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: origines.length ? origines : false }));
app.use(express.json({ limit: '100kb' }));

// Point de contrôle : permet aussi de "réveiller" le service Render
app.get('/api/sante', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, heure_serveur: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/mesures', require('./routes/mesures'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/usager'));

app.use((req, res) => res.status(404).json({ erreur: 'Route introuvable' }));

// Les erreurs internes ne révèlent aucun détail technique au client
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'JSON invalide' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erreur: 'Requête trop volumineuse' });
  console.error(err);
  return res.status(500).json({ erreur: 'Erreur interne du serveur' });
});

module.exports = app;
