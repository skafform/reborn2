# Vue d'ensemble

## Contexte

Backend Hono agissant comme un CMS headless **hébergé** (façon
Contentful/Sanity) : multi-tenant, schémas de contenu dynamiques, admin UI
destinée à des éditeurs non-techniques.

⚠️ Ce document a longtemps dit « auto-hébergé ». C'était faux, et la formule
masquait une question qu'on ne s'était jamais posée : un service hébergé a un
**exploitant**, dont le modèle ne portait aucune trace. Voir
l'[ADR 0015](../adr/0015-exploitation-hors-ligne-jamais-dans-l-application.md) —
l'exploitation vit **hors de l'application, en local**, et n'ajoute aucun
chemin transverse à ce que l'on expose.

## Stack technique

- **API** : Hono, sur Node.js
- **Base de données** : PostgreSQL — voir [database.md](./database.md)
- **Auth** : Better-Auth — voir [auth.md](./auth.md)
- **Validation** : Zod (statique + générée dynamiquement à partir des schémas de
  contenu) — voir [content-schemas.md](./content-schemas.md)
- **Assets** : stockage S3-compatible (R2, S3), à ajouter dans une phase ultérieure

## Structure du projet

**Pas de monorepo.** Deux dépôts distincts, déployés séparément :

- **API** — serveur Hono (ce dépôt)
- **Admin UI** — console d'administration, son propre dépôt, son propre
  serveur/instance (voir [admin-ui.md](./admin-ui.md))

Les deux communiquent exclusivement par HTTP, sous le même domaine racine
(sous-domaines) pour que les cookies de session restent partagés.

## Documents liés

- [database.md](./database.md) — modèle Postgres, répartition des schémas entre
  Better-Auth et Drizzle
- [multi-tenant.md](./multi-tenant.md) — organizations → projects → documents
- [environments.md](./environments.md) — la couture `master`/`staging`
- [auth.md](./auth.md) — authentification
- [roles-permissions.md](./roles-permissions.md) — rôles et règles d'accès
- [securite.md](./securite.md) — modèle de sécurité, RLS et défense en profondeur
- [invitations.md](./invitations.md) — inscription et invitations
- [content-schemas.md](./content-schemas.md) — schémas dynamiques, draft/publish
- [api.md](./api.md) — couche API et clés API
- [localisation.md](./localisation.md) — contenu multilingue
- [assets.md](./assets.md) — fichiers et images
- [recherche.md](./recherche.md) — recherche plein texte
- [cache.md](./cache.md) — cache CDN et invalidation
- [audit.md](./audit.md) — journal d'audit
- [admin-ui.md](./admin-ui.md) — admin UI
- [evolutions-prevues.md](./evolutions-prevues.md) — ce qu'on sait vouloir un
  jour, et les coutures posées pour l'accueillir
- [decisions-ouvertes.md](./decisions-ouvertes.md) — ce qui reste à trancher

## Décisions

[../adr/](../adr/) enregistre les décisions structurantes : leur contexte, ce
qui a été écarté, et leurs conséquences. Les documents ci-dessus décrivent *ce
que le système est* ; les ADR disent *pourquoi il en est arrivé là*.

## Recherches

Notes de recherche ayant mené aux décisions ci-dessus :

- [../research/better-auth-drizzle.md](../research/better-auth-drizzle.md) —
  pourquoi Better-Auth n'utilise pas Drizzle
- [../research/comparaison-typage-cms.md](../research/comparaison-typage-cms.md)
  — Sanity, Contentful et Storyblok : comment ils typent leurs clients
- [../research/comparaison-environnements.md](../research/comparaison-environnements.md)
  — environnements, et où vit le schéma (base vs code)
- [../research/rls-multi-tenant.md](../research/rls-multi-tenant.md) — RLS sans
  Supabase : faisabilité, pièges, et l'argument OWASP
- [../research/rbac.md](../research/rbac.md) — modèle de rôles : catalogue de
  permissions, et pourquoi pas ReBAC
- [../research/resolution-des-permissions.md](../research/resolution-des-permissions.md)
  — où et à quelle fréquence résoudre les permissions
- [../research/derive-du-contrat-console-api.md](../research/derive-du-contrat-console-api.md)
  — empêcher la dérive entre la console et l'API : la dérive démontrée sur le
  code, ce que font Pact et les registres de schémas, et l'essai d'Orval sur
  notre spec réelle

Voir aussi [../roadmap.md](../roadmap.md) pour le phasage du projet.
