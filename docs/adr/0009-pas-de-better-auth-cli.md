# ADR 0009 — Ne pas utiliser `@better-auth/cli`

**Statut** : Accepté
**Date** : 2026-08-20

## Contexte

La documentation officielle de Better-Auth recommande, pour PostgreSQL avec un
pool standard, d'utiliser `@better-auth/cli generate` pour produire le schéma
SQL puis de l'appliquer manuellement.

Appliqué tel quel, l'inscription échouait en **500** :

```
column "issuer" of relation "account" does not exist
```

Cause : `@better-auth/cli` (1.4.21 au moment de l'écriture) épingle
`better-auth: 1.4.21` et `@better-auth/core: 1.4.21` en **dépendances dures**,
pas en peer. Il génère donc le schéma de *sa* version, quelle que soit celle
réellement installée — ici 1.7.1, où `account.issuer` existe. L'installer
localement ne change rien : le paquet embarque sa propre copie.

## Décision

**Ne pas utiliser `@better-auth/cli`.**

`backend/scripts/migrate-auth.ts` appelle `getMigrations`, exporté par
`better-auth/db/migration` du **paquet installé**. Il ne peut structurellement
pas diverger de la version en usage. Il diffe contre le schéma vivant et
n'émet que le nécessaire.

Chaque exécution produisant un changement écrit le SQL compilé dans
`backend/migrations/auth/`, versionné avec le code.

## Alternatives écartées

**Aligner `better-auth` sur 1.4.21 pour matcher le CLI.** Démarrer un projet
neuf sur une version dépassée pour contourner un outil est de la dette
immédiate.

**Écrire le schéma à la main.** Correct une fois, dérive à chaque montée de
version.

**Appliquer le schéma généré puis le rapiécer.** `getMigrations` détecte les
colonnes manquantes, pas les types divergents — un schéma rapiécé aurait été de
la dette invisible. Les tables ont été supprimées et recréées.

## Conséquences

Deux commandes, la première n'appliquant rien :

```bash
pnpm auth:migrate         # écrit le SQL et l'affiche
pnpm auth:migrate:apply   # écrit puis applique
```

Le script se connecte avec `DATABASE_MIGRATION_URL`, donc le rôle
propriétaire.

**Limite assumée** : `runMigrations()` diffe contre l'état vivant, il ne
rejoue pas les fichiers versionnés. Ceux-ci sont une trace d'audit, pas une
source rejouable — c'est le modèle de Better-Auth, qui possède son schéma
(ADR 0002). Le mode sans `--apply` permet de relire avant d'exécuter.

**Piège à connaître** : suivre la documentation officielle mène ici à un
schéma incomplet. C'est signalé dans `CLAUDE.md`.
