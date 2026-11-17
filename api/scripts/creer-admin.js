// Crée le premier compte administrateur
// Usage : npm run creer-admin -- "Nom Prénom" email@exemple.com "MotDePasse8+"
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const valider = require('../src/validation');

(async () => {
  const [nomBrut, emailBrut, motDePasseBrut] = process.argv.slice(2);
  const nom = valider.texte(nomBrut, { max: 100 });
  const email = valider.email(emailBrut);
  const motDePasse = valider.texte(motDePasseBrut, { min: 8, max: 128 });
  if (!nom || !email || !motDePasse) {
    console.error('Usage : npm run creer-admin -- "Nom" email@exemple.com "MotDePasse (8 caractères min.)"');
    process.exit(1);
  }
  const hash = await bcrypt.hash(motDePasse, 10);
  await pool.query(
    `INSERT INTO utilisateur (nom, email, mot_de_passe_hash, role) VALUES ($1, $2, $3, 'admin')`,
    [nom, email, hash]
  );
  console.log(`Administrateur ${email} créé.`);
  await pool.end();
})().catch((err) => {
  console.error(err.code === '23505' ? 'Cet e-mail existe déjà.' : err.message);
  process.exit(1);
});
