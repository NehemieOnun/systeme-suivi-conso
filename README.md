# Système IoT de suivi de la consommation électrique domestique

TFE Bac 3 Génie Informatique – ESI, Université de Lubumbashi – Nehemie Onun

```
systeme-suivi-conso/
├── firmware/boitier_mesure/   Programme de l'ESP32 (Arduino)
├── api/                       API REST Node.js + PostgreSQL (hébergée sur Render)
└── dashboard/                 Tableau de bord web statique (hébergé sur Vercel)
```

## 1. Base de données (Neon, gratuit)

1. Créer un compte sur https://neon.com, puis un projet (région la plus proche).
2. Copier la chaîne de connexion (`postgresql://...?sslmode=require`).

## 2. API

### En local

Prérequis : Node.js 22.9 ou plus récent.

```bash
cd api
npm install
cp .env.example .env          # puis remplir DATABASE_URL et JWT_SECRET
npm run init-db               # crée les tables
npm run creer-admin -- "Votre Nom" vous@exemple.com "MotDePasse8+"
npm start                     # http://localhost:3000/api/sante
```

Générer un `JWT_SECRET` :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Tests automatisés

Ils utilisent une base PostgreSQL locale nommée `suivi_test` (jamais la base de production) :

```bash
createdb suivi_test           # une seule fois
npm test                      # lit .env.test
```

### Déploiement sur Render (gratuit)

1. Publier le dossier sur GitHub (le fichier `.env` est exclu par `.gitignore`).
2. Render > New > Web Service > choisir le dépôt.
   - Root Directory : `api`
   - Build Command : `npm install`
   - Start Command : `npm start`
   - Instance Type : Free
3. Onglet Environment : ajouter `DATABASE_URL`, `JWT_SECRET` et `CORS_ORIGIN` (adresse Vercel du tableau de bord).
4. Exécuter une fois `npm run init-db` et `npm run creer-admin` depuis votre ordinateur, avec le `.env` pointant vers Neon.

## 3. Tableau de bord

1. Dans `dashboard/config.js`, remplacer `API_URL` par l'adresse Render (ex. `https://mon-api.onrender.com`).
2. Vercel > Add New > Project > choisir le dépôt, Root Directory : `dashboard`, Framework : Other.
3. Test local : `cd dashboard && python3 -m http.server 8080`, puis ouvrir http://localhost:8080.

Une fois connecté en administrateur (Paramètres) : définir le tarif SNEL, créer le ménage, l'usager, puis le boîtier. **Copier la clé API affichée : elle n'est montrée qu'une fois.**

## 4. Boîtier ESP32

1. Arduino IDE > Préférences > URL de cartes supplémentaires :
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
2. Gestionnaire de cartes : installer **esp32** (Espressif Systems).
3. Gestionnaire de bibliothèques : installer **PZEM-004T-v30** (Jakub Mandula).
4. Copier `config.example.h` en `config.h` et le remplir (Wi-Fi, adresse de l'API, numéro de série et clé API du boîtier).
5. Carte « ESP32 Dev Module », téléverser, puis ouvrir le moniteur série à 115 200 bauds.

**Sécurité électrique** : le PZEM-004T est relié au 220 V. Câbler hors tension, dans un boîtier isolant fermé, avec un fusible.

## 5. Essai sans matériel (données fictives)

```bash
cd api
npm run simuler -- http://localhost:3000 BOITIER-001 <CLE_API> 48
```

Envoie 48 h de mesures **simulées**. Ne jamais les présenter comme des mesures réelles.
