# 0008 — Résolution des projets d'un membre de projet

**État** : ouvert
**Priorité** : 🟢 Quand un utilisateur sera membre de beaucoup de projets
**Ouvert le** : 2026-08-20

## Le constat

`projectGrant` dans `backend/src/auth/authorization.ts` charge **tous** les
projets où l'utilisateur est membre dans l'organization, ainsi que les
permissions de chacun, à chaque requête. Le `Grant` porte ensuite la liste
complète des `projectIds`, que `can()` parcourt.

Pour un pigiste rattaché à deux projets, c'est sans objet. Pour quelqu'un
ajouté à des centaines, la requête grossit et le `Grant` transporte une liste
dont une seule entrée sert.

## Pourquoi ce n'est pas fait maintenant

Personne n'a ce profil, et l'optimisation change la forme du `Grant` : le
faire à l'aveugle serait une abstraction spéculative. Le coût actuel est une
requête indexée sur `project_members_user_id_idx`.

## Pistes le jour venu

**Résoudre le projet ciblé plutôt que tous.** La plupart des routes portent sur
un projet précis, connu de l'URL. Charger les permissions de **ce** projet
seulement ramène la requête à une ligne, quel que soit le nombre d'adhésions.

Cela demande que le middleware connaisse le projet ciblé — il ne résout
aujourd'hui que l'organization. À faire en même temps qu'un
`requireProject`, qui sera de toute façon nécessaire pour les routes de
contenu (étape 6).

**Ce qui ne changerait pas** : la résolution reste par requête, sans cache
inter-requêtes — voir [ADR 0012](../adr/0012-resolution-des-permissions-par-requete.md)
pour les raisons.

## Mesurer avant

Aucun chiffre ne justifie ce travail aujourd'hui. À rouvrir sur une mesure,
pas sur une intuition.
