// Point d'entrée Vercel : l'application Express sert de fonction serverless.
// Toutes les requêtes /api/* sont redirigées ici (voir vercel.json).
module.exports = require('../src/app');
