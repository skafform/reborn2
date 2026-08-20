# Roadmap

Voir [architecture/overview.md](./architecture/overview.md) pour le détail des
décisions techniques associées à chaque phase.

## Phase 1 — MVP

Projet unique (pas encore multi-tenant), schémas dynamiques, CRUD des documents,
sans interface d'admin (tests via appels API directs).

## Phase 2 — Multi-tenant

Introduction des organizations / projects / clés API, isolation des données par
projet.

## Phase 3 — Draft / publish

Ajout du cycle de vie brouillon → publié sur les documents.

## Phase 4 — Admin UI

Interface d'administration basique permettant le CRUD des schémas et des
documents, avec formulaires générés dynamiquement.

## Phase 5 — Assets, webhooks, requêtes avancées

Gestion des fichiers/assets, notifications par webhooks, langage de requête plus
riche pour l'API de lecture publique.
