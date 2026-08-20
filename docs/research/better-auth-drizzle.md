# Recherche — Better-Auth et l'adapter Drizzle

**Recherche menée en août 2026**, pour décider comment Better-Auth accède à
Postgres. Voir la décision dans
[../architecture/database.md](../architecture/database.md).

## Le déclencheur

Doute initial sur la fiabilité du couple Better-Auth + Drizzle. La recherche
l'a confirmé : les frictions sont réelles, récentes et récurrentes.

## Problèmes confirmés sur l'adapter Drizzle

- **Incompatibilité avec Drizzle 1.0** — depuis le nouveau moteur de requêtes
  basé sur Effect-TS, l'adapter utilise encore l'ancienne syntaxe : erreurs
  *"Unknown relational filter field"*, *"The model 'user' was not found in the
  schema object"*
  ([#6766](https://github.com/better-auth/better-auth/issues/6766),
  [#7691](https://github.com/better-auth/better-auth/issues/7691))
- **Modèle d'exécution Effect non supporté** — l'adapter reçoit un objet
  Effect au lieu d'un tableau de résultats
  ([#7234](https://github.com/better-auth/better-auth/issues/7234))
- **Comptage de lignes affectées incorrect** — `updateMany`/`deleteMany`
  retournaient 0 avec les drivers `postgres-js`/`bun-sql`, corrigé seulement
  en juin 2026
  ([PR #10257](https://github.com/better-auth/better-auth/pull/10257))
- **Bugs de schéma récurrents** — *"field does not exist in schema"* après
  mise à jour de version
  ([#5386](https://github.com/better-auth/better-auth/issues/5386)), champ
  `role` exigé même sans le plugin admin
  ([#7006](https://github.com/better-auth/better-auth/issues/7006)), index
  dupliqués à la génération
- **Signal fort** : la communauté a dû publier un adapter tiers non officiel
  ([remorses/better-auth-drizzle-adapter](https://github.com/remorses/better-auth-drizzle-adapter))
  pour combler le retard sur Drizzle v1

## L'alternative vérifiée : Kysely

Kysely est l'adapter **natif et par défaut** de Better-Auth — pas une
intégration tierce à synchroniser avec les breaking changes d'un autre projet.

- Activement maintenu (publication récente au moment de la recherche)
- **Gains de performance mesurables** : les endpoints comme `/get-session` et
  `/get-full-organization` bénéficient de joins SQL natifs — 2 à 3× plus
  rapides selon la latence de la base — via `advanced.database.joins: true`
- **Améliorations 2026** : compteurs (rate limiting, quotas de clés API)
  devenus atomiques en une seule requête, réduisant les *race conditions*
- Bémols mineurs et sans commune mesure : option `transaction: false` pas
  toujours propagée (surtout Cloudflare D1, hors de notre contexte,
  [#4732](https://github.com/better-auth/better-auth/issues/4732)), et un
  problème d'import avec Kysely 0.29.x cassant les bundlers stricts, déjà
  corrigé ([PR #9811](https://github.com/better-auth/better-auth/pull/9811))

## Ce qui a été retenu

Ni l'un ni l'autre comme couche partagée : **Better-Auth accède à Postgres via
un `pg.Pool` direct** (son moteur Kysely interne gère ses propres tables), et
**Drizzle gère uniquement les tables applicatives**. Better-Auth documente
lui-même ce découpage — les tables produit se contentent de référencer
`user_id`.

Avantage : Drizzle n'est jamais dans le chemin de Better-Auth, donc aucun des
bugs ci-dessus ne s'applique. Et si l'adapter Drizzle se stabilise un jour, le
rebrancher ne coûte qu'un changement de config, sans toucher aux tables
applicatives.

## Sources

- [Database | Better Auth](https://better-auth.com/docs/concepts/database)
- [PostgreSQL | Better Auth](https://better-auth.com/docs/adapters/postgresql)
- [Drizzle ORM Adapter | Better Auth](https://better-auth.com/docs/adapters/drizzle)
- [@better-auth/kysely-adapter — npm](https://www.npmjs.com/package/@better-auth/kysely-adapter)
- Issues citées ci-dessus
