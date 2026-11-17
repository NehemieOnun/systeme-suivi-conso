// Calculs de consommation à partir des mesures stockées.
// Le PZEM-004T fournit un compteur d'énergie cumulé (kWh) : l'énergie d'une période
// est la somme des écarts entre deux mesures successives d'un même boîtier.
// Si le compteur repart à zéro (remise à zéro du module), l'écart vaut la nouvelle valeur.
const { pool, FUSEAU } = require('./db');

// Sous-requête commune : écart d'énergie de chaque mesure par rapport à la précédente
const ECARTS = `
  SELECT me.boitier_id, me.horodatage,
         CASE
           WHEN prec IS NULL THEN 0
           WHEN me.energie_kwh >= prec THEN me.energie_kwh - prec
           ELSE me.energie_kwh
         END AS ecart_kwh
  FROM (
    SELECT m.boitier_id, m.horodatage, m.energie_kwh,
           LAG(m.energie_kwh) OVER (PARTITION BY m.boitier_id ORDER BY m.horodatage) AS prec
    FROM mesure m
    JOIN boitier b ON b.id = m.boitier_id
    WHERE b.menage_id = $1
      AND m.horodatage >= $2::timestamptz - INTERVAL '2 days'
  ) me
  WHERE me.horodatage >= $2::timestamptz
`;

// Début de la journée locale (Lubumbashi), décalé de "joursAvant" jours
async function debutJournee(joursAvant = 0) {
  const { rows } = await pool.query(
    `SELECT (date_trunc('day', NOW() AT TIME ZONE $1) - make_interval(days => $2)) AT TIME ZONE $1 AS debut`,
    [FUSEAU, joursAvant]
  );
  return rows[0].debut;
}

async function tarifActuel() {
  const { rows } = await pool.query(
    `SELECT prix_kwh_cdf::float AS prix FROM tarif
     WHERE date_debut <= (NOW() AT TIME ZONE $1)::date
     ORDER BY date_debut DESC, id DESC LIMIT 1`,
    [FUSEAU]
  );
  return rows[0] ? rows[0].prix : null;
}

async function energieDepuis(menageId, debut) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(ecart_kwh), 0)::float AS energie FROM (${ECARTS}) e`,
    [menageId, debut]
  );
  return rows[0].energie;
}

async function energieDuJour(menageId) {
  return energieDepuis(menageId, await debutJournee(0));
}

// Résumé affiché sur le tableau de bord
async function resume(menageId) {
  const derniere = await pool.query(
    `SELECT m.horodatage, m.tension_v, m.courant_a, m.puissance_w, m.facteur_puissance, m.energie_kwh
     FROM mesure m JOIN boitier b ON b.id = m.boitier_id
     WHERE b.menage_id = $1
     ORDER BY m.horodatage DESC LIMIT 1`,
    [menageId]
  );
  const energie = await energieDuJour(menageId);
  const prix = await tarifActuel();
  return {
    derniere_mesure: derniere.rows[0] || null,
    energie_jour_kwh: Math.round(energie * 1000) / 1000,
    tarif_kwh_cdf: prix,
    cout_jour_cdf: prix === null ? null : Math.round(energie * prix)
  };
}

const PERIODES = {
  jour: { joursAvant: 0, pas: '1 hour', nb: 24 },
  semaine: { joursAvant: 6, pas: '1 day', nb: 7 },
  mois: { joursAvant: 29, pas: '1 day', nb: 30 }
};

// Énergie par tranche (heure ou jour) sur la période choisie
async function historique(menageId, periode) {
  const conf = PERIODES[periode];
  const debut = await debutJournee(conf.joursAvant);
  const { rows } = await pool.query(
    `WITH tranches AS (
       SELECT generate_series(
         $2::timestamptz AT TIME ZONE $3,
         ($2::timestamptz AT TIME ZONE $3) + ($5::int - 1) * $4::interval,
         $4::interval
       ) AS tranche
     ),
     ecarts AS (${ECARTS})
     SELECT to_char(t.tranche, 'YYYY-MM-DD"T"HH24:MI') AS tranche,
            COALESCE(SUM(e.ecart_kwh), 0)::float AS energie_kwh
     FROM tranches t
     LEFT JOIN ecarts e
       ON date_trunc(CASE WHEN $4::interval = INTERVAL '1 hour' THEN 'hour' ELSE 'day' END,
                     e.horodatage AT TIME ZONE $3) = t.tranche
     GROUP BY t.tranche
     ORDER BY t.tranche`,
    [menageId, debut, FUSEAU, conf.pas, conf.nb]
  );
  const prix = await tarifActuel();
  const total = rows.reduce((s, r) => s + r.energie_kwh, 0);
  return {
    periode,
    tranches: rows.map((r) => ({ tranche: r.tranche, energie_kwh: Math.round(r.energie_kwh * 1000) / 1000 })),
    total_kwh: Math.round(total * 1000) / 1000,
    cout_total_cdf: prix === null ? null : Math.round(total * prix)
  };
}

// Crée une alerte si l'énergie du jour dépasse le seuil (au plus une alerte par jour)
async function verifierSeuil(menageId) {
  const { rows } = await pool.query(
    'SELECT id, energie_max_jour_kwh FROM seuil WHERE menage_id = $1 AND actif = TRUE',
    [menageId]
  );
  const seuil = rows[0];
  if (!seuil) return null;
  const debut = await debutJournee(0);
  const energie = await energieDepuis(menageId, debut);
  if (energie <= seuil.energie_max_jour_kwh) return null;
  const deja = await pool.query(
    'SELECT 1 FROM alerte WHERE seuil_id = $1 AND date_heure >= $2 LIMIT 1',
    [seuil.id, debut]
  );
  if (deja.rowCount > 0) return null;
  const message = `Consommation du jour (${energie.toFixed(2).replace(".", ",")} kWh) supérieure au seuil de ${String(seuil.energie_max_jour_kwh).replace(".", ",")} kWh`;
  const ins = await pool.query(
    'INSERT INTO alerte (seuil_id, energie_mesuree_kwh, message) VALUES ($1, $2, $3) RETURNING id',
    [seuil.id, energie, message]
  );
  return ins.rows[0].id;
}

module.exports = { resume, historique, verifierSeuil, PERIODES };
