// Fonctions de validation des entrées (aucune donnée n'est utilisée sans contrôle)

const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,20}$/;

function texte(valeur, { min = 1, max = 255 } = {}) {
  if (typeof valeur !== 'string') return null;
  const v = valeur.trim();
  return v.length >= min && v.length <= max ? v : null;
}

function email(valeur) {
  const v = texte(valeur, { max: 150 });
  return v && EMAIL_REGEX.test(v) ? v.toLowerCase() : null;
}

function nombre(valeur, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof valeur === 'string' && valeur.trim() !== '' ? Number(valeur) : valeur;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function entier(valeur, { min = 1, max = 2147483647 } = {}) {
  const n = nombre(valeur, { min, max });
  return n !== null && Number.isInteger(n) ? n : null;
}

function date(valeur) {
  if (typeof valeur !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return null;
  const d = new Date(valeur + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : valeur;
}

// Horodatage d'une mesure : secondes Unix envoyées par l'ESP32
function horodatage(valeur) {
  const s = entier(valeur, { min: 1577836800, max: 4102444800 }); // 2020-01-01 à 2100-01-01
  if (s === null) return null;
  const maintenant = Date.now() / 1000;
  if (s > maintenant + 300) return null; // refuse les dates dans le futur (> 5 min)
  return new Date(s * 1000);
}

// Valide une mesure reçue du boîtier ; renvoie null si une valeur est hors plage
function mesure(m) {
  if (!m || typeof m !== 'object') return null;
  const h = horodatage(m.t);
  const v = nombre(m.v, { min: 0, max: 300 });
  const i = nombre(m.i, { min: 0, max: 100 });
  const p = nombre(m.p, { min: 0, max: 23000 });
  const pf = m.pf === undefined || m.pf === null ? null : nombre(m.pf, { min: 0, max: 1 });
  const e = nombre(m.e, { min: 0, max: 10000 });
  if (!h || v === null || i === null || p === null || e === null) return null;
  if (m.pf !== undefined && m.pf !== null && pf === null) return null;
  return { horodatage: h, tension_v: v, courant_a: i, puissance_w: p, facteur_puissance: pf, energie_kwh: e };
}

module.exports = { texte, email, nombre, entier, date, mesure };
