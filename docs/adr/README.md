# Architecture Decision Records

Un ADR enregistre **une décision, son contexte, et ce qui a été écarté**. Il
est daté et immuable : on ne le réécrit pas, on en écrit un nouveau qui le
remplace.

C'est complémentaire de [../architecture/](../architecture/), qui décrit *ce
que le système est* — un ADR dit *pourquoi il en est arrivé là*.

## Quand un ADR est justifié

Les trois conditions doivent être réunies :

1. La décision **contraint le travail futur** — on ne peut pas la contourner
   sans conséquence
2. Il existait des **alternatives réelles**, écartées pour des raisons
   nommables
3. Quelqu'un pourrait plausiblement vouloir **la remettre en question** plus
   tard, faute de se souvenir du raisonnement

## Quand il ne l'est pas

- Un choix facilement réversible et sans effet sur le reste (un formateur, un
  nom de variable)
- Une conséquence mécanique d'une décision déjà consignée
- Une préférence sans alternative sérieuse

## Format

Titre, statut, date, contexte, décision, alternatives écartées, conséquences.
Court : si un ADR dépasse une page, c'est souvent qu'il en contient deux.

## Statuts

`Accepté` · `Remplacé par ADR-XXXX` · `Déprécié`

## Index

| # | Décision | Date |
|---|---|---|
| [0001](0001-postgres-nu-sans-verrouillage-fournisseur.md) | Postgres nu, sans helper propriétaire | 2026-08-19 |
| [0002](0002-deux-proprietaires-de-schema.md) | Deux propriétaires de schéma : Better-Auth et Drizzle | 2026-08-19 |
| [0003](0003-rls-frontiere-tenant-roles-en-code.md) | RLS pour la frontière multi-tenant, rôles en TypeScript | 2026-08-19 |
| [0004](0004-rbac-catalogue-de-permissions.md) | RBAC : catalogue de permissions et point de vérification unique | 2026-08-20 |
| [0005](0005-depots-separes-contrat-openapi.md) | Dépôts séparés, contrat d'API en OpenAPI | 2026-08-19 |
| [0006](0006-couture-environnements.md) | Couture d'environnements : `environment_id` dès le départ | 2026-08-19 |
| [0007](0007-localisation-au-niveau-du-document.md) | Localisation au niveau du document | 2026-08-19 |
| [0008](0008-point-d-emission-d-evenements-unique.md) | Point d'émission d'événements unique | 2026-08-19 |
| [0009](0009-pas-de-better-auth-cli.md) | Ne pas utiliser `@better-auth/cli` | 2026-08-20 |
| [0010](0010-typescript-natif-sans-etape-de-build.md) | TypeScript exécuté nativement, sans étape de build | 2026-08-20 |
