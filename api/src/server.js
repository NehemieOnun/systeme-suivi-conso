// Point d'entrée : démarre le serveur HTTP
const app = require('./app');

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`API de suivi de consommation démarrée sur le port ${PORT}`);
});
