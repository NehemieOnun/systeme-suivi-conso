// Connexion à PostgreSQL (Neon en production, base locale en développement)
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Variable DATABASE_URL manquante (voir .env.example).');
  process.exit(1);
}

// Neon impose SSL ; une base locale n'en a pas besoin.
const estLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: estLocal ? false : { rejectUnauthorized: true },
  max: 5, // l'offre gratuite limite le nombre de connexions
  idleTimeoutMillis: 30000
});

// Fuseau horaire utilisé pour découper les journées
const FUSEAU = 'Africa/Lubumbashi';

module.exports = { pool, FUSEAU };
