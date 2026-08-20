# ADR 0010 — TypeScript exécuté nativement, sans étape de build

**Statut** : Accepté
**Date** : 2026-08-20

## Contexte

Node 24 exécute les fichiers `.ts` nativement par **effacement de types**, et
charge les variables d'environnement avec `--env-file`. Deux dépendances
habituelles — un exécuteur de développement (`tsx`) et `dotenv` — deviennent
inutiles.

TypeScript reste nécessaire au projet, pour trois raisons liées à des
décisions déjà prises : le client typé de l'admin UI dérive des schémas Zod
(ADR 0005) ; le catalogue de permissions transforme une faute de frappe dans
un nom de permission en erreur de compilation plutôt qu'en refus silencieux
(ADR 0004) ; et le cadrage multi-tenant peut être renforcé par des types
marqués (ADR 0003).

## Décision

- **Aucune étape de build.** Node exécute `src/**/*.ts` directement, en
  développement comme en exécution
- **`erasableSyntaxOnly: true`** dans `tsconfig.json` : la syntaxe non
  effaçable (`enum`, paramètres-propriétés, `namespace`) échoue au typecheck
  plutôt qu'à l'exécution
- **`--env-file=.env`**, pas de `dotenv`
- **`node:test`** pour les tests, pas de Vitest — aucune dépendance, et Node
  exécute déjà le TypeScript
- **TypeScript 5.9**, pas 7.x

## Alternatives écartées

**TypeScript 7.x.** Essayé, puis abandonné : la réécriture native en Go ne
livre que `tsc`, **sans `tsserver`**. L'éditeur retomberait sur sa propre
version 5.x pendant que `pnpm typecheck` utiliserait la 7 — deux compilateurs
pouvant diverger sur le même code. À reconsidérer quand un serveur de langage
existera.

**`tsx` et `dotenv`.** Deux dépendances pour ce que la plateforme fait déjà.

**Vitest.** Meilleur outillage de mocking et de surveillance, mais ajoute une
dépendance et sa propre chaîne de transformation, contre un besoin que
`node:test` couvre aujourd'hui.

## Conséquences

Les `enum` TypeScript sont interdits — utiliser des unions de littéraux ou des
objets `as const`.

Aucun artefact de build en production : Node effectue l'effacement de types au
chargement.

Le choix de `node:test` est facilement réversible ; celui de
`erasableSyntaxOnly` contraint le code qu'on écrit et mérite d'être connu
avant de coder.
