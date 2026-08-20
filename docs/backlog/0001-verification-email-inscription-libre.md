# 0001 — Vérification d'email à l'inscription libre

**État** : ouvert
**Priorité** : 🔴 Bloquant avant toute mise en ligne
**Ouvert le** : 2026-08-20

## Écart actuel

`backend/src/auth.ts` porte `requireEmailVerification: false`.

[architecture/auth.md](../architecture/auth.md) décrit l'inverse :
l'inscription libre passe par un lien à usage unique prouvant la possession de
l'adresse, après quoi l'utilisateur complète son compte (nom + mot de passe).

## Pourquoi c'est en l'état

Le flux exige l'envoi d'emails, qui n'existe pas encore — c'est l'étape 5 de
la [roadmap](../roadmap.md).

## Risque tant que ça tient

**N'importe qui peut créer un compte avec l'adresse d'un tiers.** Acceptable
en développement local, inacceptable en ligne.

## Levée

Quand Resend est branché :

- passer `requireEmailVerification` à `true`
- brancher le flux par lien à usage unique décrit dans
  [architecture/auth.md](../architecture/auth.md)
- retirer le commentaire d'écart dans `backend/src/auth.ts`
- retirer l'entrée correspondante de
  [architecture/decisions-ouvertes.md](../architecture/decisions-ouvertes.md)
