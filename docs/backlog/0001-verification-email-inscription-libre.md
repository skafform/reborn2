# 0001 — Vérification d'email à l'inscription libre

**État** : **fait**
**Ouvert le** : 2026-08-20 · **Clos le** : 2026-08-20

`requireEmailVerification: true` avec `sendVerificationEmail` et
`autoSignInAfterVerification`. La réinitialisation de mot de passe est branchée
au passage — un utilisateur qui ne peut ni se connecter ni réinitialiser serait
bloqué. Voir [architecture/auth.md](../architecture/auth.md), qui note l'écart
avec l'esquisse initiale et pourquoi.


## Ce qui a été fait

- `requireEmailVerification: true`
- email de confirmation à l'inscription, session ouverte au clic
- email de réinitialisation de mot de passe
