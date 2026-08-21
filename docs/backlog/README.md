# Backlog

Items de travail **numérotés, à identifiant stable**. C'est le seul endroit
référençable depuis le code, un commit ou une discussion : `backlog #7`.

Un item ne réexplique jamais le fond — il renvoie au document qui le porte.

## Répartition avec les autres documents

| Document | Répond à |
|---|---|
| **Ce backlog** | *Que faire, et où en est-on ?* |
| [../roadmap.md](../roadmap.md) | *Dans quel ordre ?* — les grandes étapes |
| [../architecture/decisions-ouvertes.md](../architecture/decisions-ouvertes.md) | *Quelles questions restent sans réponse ?* — des questions, pas des tâches |
| [../architecture/evolutions-prevues.md](../architecture/evolutions-prevues.md) | *Pourquoi telle fonctionnalité sera peu coûteuse plus tard ?* — les coutures |
| [../adr/](../adr/) | *Pourquoi a-t-on tranché ainsi ?* — l'histoire |

Une question qui trouve sa réponse devient un item ici. Un item terminé qui
tranchait une décision structurante devient un ADR.

## États

`ouvert` · `en cours` · `fait` · `abandonné`

Un item `fait` reste dans le fichier : son numéro peut être cité ailleurs.

## Convention

Un fichier par item : `NNNN-titre-court.md`. Le numéro ne change jamais et
n'est jamais réattribué.

## Index

| # | Item | Priorité | État |
|---|---|---|---|
| [0001](0001-verification-email-inscription-libre.md) | Vérification d'email à l'inscription libre | 🔴 | **fait** (étape 5) |
| [0002](0002-force-row-level-security.md) | `FORCE ROW LEVEL SECURITY` sur les tables applicatives | 🔴 À la création des tables | **fait** (étape 3a) |
| [0003](0003-transaction-et-contexte-rls.md) | Transaction explicite et contexte RLS par requête | 🔴 Avant la première requête applicative | **fait** (étape 3a) |
| [0004](0004-cors-admin-ui.md) | CORS pour l'admin UI | 🟡 Quand l'admin UI existe | ouvert |
| [0005](0005-policy-organizations-par-appartenance.md) | Policy `organizations` par appartenance | 🔴 Étape 3b | **fait** (étape 3b) |
| [0006](0006-garde-fous-escalade-privileges.md) | Garde-fous d'escalade de privilèges | 🔴 | **fait** (étape 4) |
| [0007](0007-amorcage-et-verification-db.md) | Amorçage de la base et vérification des préconditions | 🔴 | **fait** |
| [0008](0008-resolution-des-projets-d-un-membre.md) | Résolution des projets d'un membre de projet | 🟢 À mesurer d'abord | ouvert |
| [0009](0009-rate-limiting-des-invitations.md) | Rate limiting des invitations | 🟠 | **fait** (étape 5) |
| [0010](0010-suppression-d-organization-bloquee.md) | Une organization ne peut pas être supprimée | 🔴 | **fait** (migration 0019) |
| [0011](0011-nettoyage-des-tests-avale-ses-erreurs.md) | Le nettoyage des tests avale ses erreurs | 🟠 | **fait** |
| [0012](0012-la-console-n-a-aucun-test.md) | La console n'a aucun test | 🟠 Avec la CI | ouvert |
| [0013](0013-portee-de-role-non-verifiee.md) | La portée d'un rôle n'est pas vérifiée à l'invitation | 🔴 Avant la Team de projet | ouvert |
