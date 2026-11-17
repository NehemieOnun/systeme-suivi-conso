// Tableau de bord : toutes les données reçues sont insérées avec textContent (protection XSS)
'use strict';

const API = window.CONFIG.API_URL.replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const fmt = (n, dec = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

let session = null;
let graphJour = null;
let graphHisto = null;
let alerteAffichee = null;
let minuterie = null;

// ---------- Appels à l'API ----------
async function appel(chemin, { methode = 'GET', corps } = {}) {
  const ctrl = new AbortController();
  // Le serveur gratuit peut mettre environ une minute à se réveiller
  const delai = setTimeout(() => ctrl.abort(), 90000);
  const lent = setTimeout(() => message('Le serveur démarre, cela peut prendre jusqu\'à une minute…'), 4000);
  try {
    const rep = await fetch(API + chemin, {
      method: methode,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.jeton}` } : {})
      },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal
    });
    if (rep.status === 401 && session) {
      deconnecter('Votre session a expiré. Reconnectez-vous.');
      throw new Error('Session expirée');
    }
    const donnees = rep.status === 204 ? null : await rep.json().catch(() => null);
    if (!rep.ok) throw new Error(donnees?.erreur || `Erreur ${rep.status}`);
    message('');
    return donnees;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Le serveur ne répond pas. Vérifiez votre connexion.');
    if (err instanceof TypeError) throw new Error('Connexion impossible. Vérifiez votre accès à Internet.');
    throw err;
  } finally {
    clearTimeout(delai);
    clearTimeout(lent);
  }
}

function message(texte, type = '', cible = 'msg-app') {
  const el = $(cible);
  if (!el) return;
  el.textContent = texte;
  el.className = `message ${type}`;
}

// ---------- Session ----------
function chargerSession() {
  try {
    session = JSON.parse(sessionStorage.getItem('session'));
  } catch {
    session = null;
  }
}

function deconnecter(texte = '') {
  session = null;
  sessionStorage.removeItem('session');
  clearInterval(minuterie);
  afficherConnexion();
  message(texte, texte ? 'erreur' : '', 'msg-connexion');
}

function afficherConnexion() {
  $('vue-app').hidden = true;
  $('vue-connexion').hidden = false;
}

async function afficherApp() {
  $('vue-connexion').hidden = true;
  $('vue-app').hidden = false;
  $('zone-admin').hidden = session.utilisateur.role !== 'admin';
  changerOnglet('tableau');
  if (session.utilisateur.role === 'admin') chargerAdmin();
  clearInterval(minuterie);
  minuterie = setInterval(() => { if (!document.hidden && !$('onglet-tableau').hidden) chargerTableau(); }, 60000);
}

$('form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const motDePasse = $('mot-de-passe').value;
  if (!email || !motDePasse) return message('Saisissez votre e-mail et votre mot de passe.', 'erreur', 'msg-connexion');
  const bouton = e.submitter;
  bouton.disabled = true;
  message('Connexion…', '', 'msg-connexion');
  try {
    session = await appel('/api/auth/connexion', { methode: 'POST', corps: { email, motDePasse } });
    sessionStorage.setItem('session', JSON.stringify(session));
    $('mot-de-passe').value = '';
    message('', '', 'msg-connexion');
    afficherApp();
  } catch (err) {
    message(err.message, 'erreur', 'msg-connexion');
  } finally {
    bouton.disabled = false;
  }
});

$('btn-deconnexion').addEventListener('click', () => deconnecter());

// ---------- Navigation ----------
function changerOnglet(nom) {
  for (const o of ['tableau', 'historique', 'parametres']) $(`onglet-${o}`).hidden = o !== nom;
  document.querySelectorAll('.navigation button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === nom));
  if (nom === 'tableau') chargerTableau();
  if (nom === 'historique') chargerHistorique(document.querySelector('.periodes .actif').dataset.periode);
  if (nom === 'parametres') chargerSeuil();
}
document.querySelectorAll('.navigation button').forEach((b) => b.addEventListener('click', () => changerOnglet(b.dataset.onglet)));

// ---------- Graphiques ----------
function dessiner(ancien, canvas, etiquettes, valeurs) {
  if (ancien) ancien.destroy();
  return new window.Chart(canvas, {
    type: 'bar',
    data: { labels: etiquettes, datasets: [{ label: 'Énergie (kWh)', data: valeurs, backgroundColor: '#2a5d9f', borderRadius: 3 }] },
    options: {
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(c.parsed.y, 3)} kWh` } } },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'kWh' } }, x: { grid: { display: false } } }
    }
  });
}

const etiquetteHeure = (t) => `${t.slice(11, 13)} h`;
const etiquetteJour = (t) => `${t.slice(8, 10)}/${t.slice(5, 7)}`;

// ---------- Tableau de bord ----------
async function chargerTableau() {
  if (!session.utilisateur.menage_id) {
    $('derniere-mesure').textContent = 'Compte administrateur : aucun ménage associé.';
    return;
  }
  try {
    const [resume, histo, alertes] = await Promise.all([
      appel('/api/consommation/resume'),
      appel('/api/consommation/historique?periode=jour'),
      appel('/api/alertes')
    ]);
    const m = resume.derniere_mesure;
    if (m) {
      const date = new Date(m.horodatage);
      const minutes = Math.round((Date.now() - date.getTime()) / 60000);
      $('derniere-mesure').textContent =
        `Dernière mesure reçue : ${date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} (il y a ${minutes} min)`;
      $('val-puissance').textContent = `${fmt(m.puissance_w)} W`;
      $('val-tension').textContent = `${fmt(m.tension_v, 1)} V`;
    } else {
      $('derniere-mesure').textContent = 'Aucune mesure reçue pour le moment.';
    }
    $('val-energie').textContent = `${fmt(resume.energie_jour_kwh, 2)} kWh`;
    $('val-cout').textContent = resume.cout_jour_cdf === null ? 'Tarif non défini' : `${fmt(resume.cout_jour_cdf)} CDF`;

    const nonLue = alertes.find((a) => !a.lue);
    alerteAffichee = nonLue ? nonLue.id : null;
    $('bandeau-alerte').hidden = !nonLue;
    if (nonLue) $('texte-alerte').textContent = `Alerte : ${nonLue.message}`;

    graphJour = dessiner(graphJour, $('graph-jour'), histo.tranches.map((t) => etiquetteHeure(t.tranche)), histo.tranches.map((t) => t.energie_kwh));
  } catch (err) {
    message(err.message, 'erreur');
  }
}

$('btn-alerte-lue').addEventListener('click', async () => {
  if (!alerteAffichee) return;
  try {
    await appel(`/api/alertes/${alerteAffichee}/lue`, { methode: 'PATCH' });
    $('bandeau-alerte').hidden = true;
  } catch (err) {
    message(err.message, 'erreur');
  }
});

// ---------- Historique ----------
async function chargerHistorique(periode) {
  try {
    const h = await appel(`/api/consommation/historique?periode=${encodeURIComponent(periode)}`);
    const libelle = { jour: 'Aujourd\'hui', semaine: '7 derniers jours', mois: '30 derniers jours' }[periode];
    const cout = h.cout_total_cdf === null ? '' : ` – ${fmt(h.cout_total_cdf)} CDF`;
    $('total-periode').textContent = `${libelle} : ${fmt(h.total_kwh, 2)} kWh${cout}`;
    const etiq = periode === 'jour' ? etiquetteHeure : etiquetteJour;
    graphHisto = dessiner(graphHisto, $('graph-historique'), h.tranches.map((t) => etiq(t.tranche)), h.tranches.map((t) => t.energie_kwh));
  } catch (err) {
    message(err.message, 'erreur');
  }
}

document.querySelectorAll('.periodes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.periodes button').forEach((x) => {
    x.classList.toggle('actif', x === b);
    x.setAttribute('aria-selected', String(x === b));
  });
  chargerHistorique(b.dataset.periode);
}));

// ---------- Paramètres ----------
async function chargerSeuil() {
  if (!session.utilisateur.menage_id) { $('form-seuil').hidden = true; return; }
  try {
    const s = await appel('/api/seuil');
    if (s) {
      $('seuil').value = s.energie_max_jour_kwh;
      $('seuil-actif').checked = s.actif;
    }
  } catch (err) {
    message(err.message, 'erreur');
  }
}

$('form-seuil').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valeur = Number($('seuil').value);
  if (!Number.isFinite(valeur) || valeur <= 0 || valeur > 1000) return message('Saisissez un seuil entre 0,01 et 1 000 kWh.', 'erreur');
  try {
    await appel('/api/seuil', { methode: 'PUT', corps: { energie_max_jour_kwh: valeur, actif: $('seuil-actif').checked } });
    message('Seuil enregistré.', 'ok');
  } catch (err) {
    message(err.message, 'erreur');
  }
});

// ---------- Administration ----------
async function chargerAdmin() {
  try {
    const [menages, tarifs] = await Promise.all([appel('/api/admin/menages'), appel('/api/admin/tarifs')]);
    document.querySelectorAll('.liste-menages').forEach((select) => {
      select.replaceChildren();
      const vide = new Option('— Aucun —', '');
      if (select.id === 'u-menage') select.add(vide);
      for (const m of menages) select.add(new Option(`n° ${m.id} – ${m.adresse} (${m.commune})`, String(m.id)));
    });
    $('tarif-actuel').textContent = tarifs.length
      ? `Tarif en vigueur : ${fmt(tarifs[0].prix_kwh_cdf, 2)} CDF/kWh depuis le ${tarifs[0].date_debut.split('-').reverse().join('/')}`
      : 'Aucun tarif défini : le coût ne peut pas être calculé.';
  } catch (err) {
    message(err.message, 'erreur');
  }
}

function soumettre(formId, chemin, construire, apres) {
  $(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!e.target.checkValidity()) return message('Vérifiez les champs du formulaire.', 'erreur');
    try {
      const r = await appel(chemin, { methode: 'POST', corps: construire() });
      message('Enregistré.', 'ok');
      if (apres) apres(r);
      e.target.reset();
      chargerAdmin();
    } catch (err) {
      message(err.message, 'erreur');
    }
  });
}

soumettre('form-tarif', '/api/admin/tarifs', () => ({ prix_kwh_cdf: Number($('tarif-prix').value), date_debut: $('tarif-date').value }));
soumettre('form-menage', '/api/admin/menages', () => ({ adresse: $('menage-adresse').value, commune: $('menage-commune').value }));
soumettre('form-utilisateur', '/api/admin/utilisateurs', () => ({
  nom: $('u-nom').value, email: $('u-email').value, motDePasse: $('u-mdp').value,
  role: $('u-role').value, menage_id: $('u-menage').value ? Number($('u-menage').value) : null
}));
soumettre('form-boitier', '/api/admin/boitiers', () => ({ numero_serie: $('b-numero').value, menage_id: Number($('b-menage').value) }),
  (r) => { $('cle-valeur').textContent = r.cle_api; $('cle-boitier').hidden = false; });

// ---------- Démarrage ----------
chargerSession();
if (session) afficherApp(); else afficherConnexion();
