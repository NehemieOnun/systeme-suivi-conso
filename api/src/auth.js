// Authentification : utilisateurs (jeton JWT) et boîtiers (clé API)
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET doit contenir au moins 32 caractères (voir .env.example).');
  process.exit(1);
}

const DUREE_JETON = '8h';

// Hachage factice : sert à comparer en temps constant quand le boîtier n'existe pas
const HASH_FACTICE = bcrypt.hashSync('cle-factice-inexistante', 10);

function creerJeton(utilisateur) {
  return jwt.sign(
    { id: utilisateur.id, role: utilisateur.role, menage_id: utilisateur.menage_id },
    JWT_SECRET,
    { expiresIn: DUREE_JETON }
  );
}

// Middleware : exige un jeton valide dans l'en-tête Authorization: Bearer <jeton>
function exigerUtilisateur(req, res, next) {
  const entete = req.get('Authorization') || '';
  const [type, jeton] = entete.split(' ');
  if (type !== 'Bearer' || !jeton) {
    return res.status(401).json({ erreur: 'Authentification requise' });
  }
  try {
    req.utilisateur = jwt.verify(jeton, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ erreur: 'Session expirée ou invalide' });
  }
}

function exigerAdmin(req, res, next) {
  if (req.utilisateur?.role !== 'admin') {
    return res.status(403).json({ erreur: 'Accès réservé à l\'administrateur' });
  }
  return next();
}

// Middleware : identifie le boîtier par ses en-têtes X-Boitier-Id et X-Cle-Api
async function exigerBoitier(req, res, next) {
  const numero = req.get('X-Boitier-Id');
  const cle = req.get('X-Cle-Api');
  if (!numero || !cle || numero.length > 50 || cle.length > 128) {
    return res.status(401).json({ erreur: 'Identifiants du boîtier manquants' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, menage_id, cle_api_hash FROM boitier WHERE numero_serie = $1',
      [numero]
    );
    const boitier = rows[0];
    // bcrypt.compare est exécuté même si le boîtier n'existe pas (temps constant)
    const hash = boitier ? boitier.cle_api_hash : HASH_FACTICE;
    const valide = await bcrypt.compare(cle, hash);
    if (!boitier || !valide) {
      return res.status(401).json({ erreur: 'Boîtier non reconnu' });
    }
    req.boitier = { id: boitier.id, menage_id: boitier.menage_id };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { creerJeton, exigerUtilisateur, exigerAdmin, exigerBoitier };
