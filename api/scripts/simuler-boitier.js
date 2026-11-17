// Simulateur de boîtier : envoie des mesures FICTIVES à l'API, pour tester le système
// sans le matériel. Ces données ne doivent jamais être présentées comme des mesures réelles.
//
// Usage : npm run simuler -- <URL_API> <NUMERO_SERIE> <CLE_API> [heures]
// Exemple : npm run simuler -- http://localhost:3000 BOITIER-001 3f9a... 48

const [url, numero, cle, heuresBrut] = process.argv.slice(2);
if (!url || !numero || !cle) {
  console.error('Usage : npm run simuler -- <URL_API> <NUMERO_SERIE> <CLE_API> [heures]');
  process.exit(1);
}
const heures = Math.min(Math.max(Number(heuresBrut) || 24, 1), 24 * 30);

// Profil de puissance fictif : faible la nuit, pics le matin et le soir
function puissanceFictive(date) {
  const h = date.getUTCHours() + 2 + date.getUTCMinutes() / 60; // heure de Lubumbashi (UTC+2)
  const heure = h % 24;
  let base = 120; // réfrigérateur et veilles
  if (heure >= 6 && heure < 8) base += 900; // fer à repasser, bouilloire
  if (heure >= 18 && heure < 22) base += 600; // éclairage, télévision
  return base + Math.random() * 60;
}

(async () => {
  const fin = Math.floor(Date.now() / 60000) * 60; // dernière minute entière (s)
  const debut = fin - heures * 3600;
  let energie = 0;
  const mesures = [];
  for (let t = debut; t <= fin; t += 60) {
    const p = puissanceFictive(new Date(t * 1000));
    const v = 215 + Math.random() * 10;
    const pf = 0.9;
    energie += p / 1000 / 60; // kWh consommés pendant la minute
    mesures.push({ t, v: +v.toFixed(1), i: +(p / (v * pf)).toFixed(3), p: +p.toFixed(1), pf, e: +energie.toFixed(3) });
  }

  let inserees = 0;
  for (let k = 0; k < mesures.length; k += 60) {
    const lot = mesures.slice(k, k + 60);
    const rep = await fetch(`${url}/api/mesures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Boitier-Id': numero, 'X-Cle-Api': cle },
      body: JSON.stringify({ mesures: lot })
    });
    if (rep.status !== 201) {
      console.error(`Lot refusé (HTTP ${rep.status}) :`, await rep.text());
      process.exit(1);
    }
    inserees += (await rep.json()).inserees;
  }
  console.log(`${inserees} mesures fictives envoyées (${heures} h, énergie totale ${energie.toFixed(2)} kWh).`);
})().catch((err) => {
  console.error('Échec de la simulation :', err.message);
  process.exit(1);
});
