// Crée les tables de la base à partir de schema.sql
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Tables créées (ou déjà existantes).');
  await pool.end();
})().catch((err) => {
  console.error('Échec de la création des tables :', err.message);
  process.exit(1);
});
