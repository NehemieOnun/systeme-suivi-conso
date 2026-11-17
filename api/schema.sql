-- Schéma de la base PostgreSQL du système de suivi de consommation
-- Exécuter une seule fois : npm run init-db

CREATE TABLE IF NOT EXISTS menage (
  id SERIAL PRIMARY KEY,
  adresse VARCHAR(255) NOT NULL,
  commune VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS utilisateur (
  id SERIAL PRIMARY KEY,
  menage_id INT REFERENCES menage(id) ON DELETE SET NULL,
  nom VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  mot_de_passe_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('usager', 'admin')),
  cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boitier (
  id SERIAL PRIMARY KEY,
  menage_id INT NOT NULL REFERENCES menage(id) ON DELETE CASCADE,
  numero_serie VARCHAR(50) NOT NULL UNIQUE,
  cle_api_hash VARCHAR(255) NOT NULL,
  date_installation DATE NOT NULL DEFAULT CURRENT_DATE,
  derniere_connexion TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mesure (
  id BIGSERIAL PRIMARY KEY,
  boitier_id INT NOT NULL REFERENCES boitier(id) ON DELETE CASCADE,
  horodatage TIMESTAMPTZ NOT NULL,
  tension_v REAL NOT NULL CHECK (tension_v BETWEEN 0 AND 300),
  courant_a REAL NOT NULL CHECK (courant_a >= 0),
  puissance_w REAL NOT NULL CHECK (puissance_w >= 0),
  facteur_puissance REAL CHECK (facteur_puissance BETWEEN 0 AND 1),
  energie_kwh DOUBLE PRECISION NOT NULL CHECK (energie_kwh >= 0),
  UNIQUE (boitier_id, horodatage) -- évite les doublons si un lot est renvoyé
);

CREATE TABLE IF NOT EXISTS seuil (
  id SERIAL PRIMARY KEY,
  menage_id INT NOT NULL UNIQUE REFERENCES menage(id) ON DELETE CASCADE,
  energie_max_jour_kwh REAL NOT NULL CHECK (energie_max_jour_kwh > 0),
  actif BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS alerte (
  id SERIAL PRIMARY KEY,
  seuil_id INT NOT NULL REFERENCES seuil(id) ON DELETE CASCADE,
  date_heure TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  energie_mesuree_kwh REAL NOT NULL,
  message VARCHAR(255) NOT NULL,
  lue BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tarif (
  id SERIAL PRIMARY KEY,
  prix_kwh_cdf NUMERIC(10, 2) NOT NULL CHECK (prix_kwh_cdf > 0),
  date_debut DATE NOT NULL
);
