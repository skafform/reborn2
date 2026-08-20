# 0006 — Garde-fous d'escalade de privilèges

**État** : **fait**
**Ouvert le** : 2026-08-20 · **Clos le** : 2026-08-20

Livré dans `backend/src/auth/escalation.ts`, couvert par
`backend/src/auth/authorization.test.ts`.

## Ce qui est déjà garanti par la base

- Un membre ne peut pas recevoir le rôle d'une **autre organization** — clé
  étrangère composite `(organization_id, role_id)`
- Les **rôles système** ne peuvent être ni modifiés, ni supprimés, et leurs
  permissions sont figées — triggers
- Une organization **conserve toujours un `owner`** — trigger de contrainte,
  différé, avec verrou sur la ligne organization
- Aucune **permission inconnue** ne peut être accordée — clé étrangère vers
  `permissions`

## Ce qui manque, et que la base ne peut pas garantir

**On ne peut pas accorder une permission qu'on ne détient pas.**

Sans cette règle, un `admin` crée un rôle personnalisé portant `org.delete`, se
l'assigne, et devient propriétaire de fait. C'est le vecteur d'escalade que la
littérature signale comme principal — il passe par les endpoints
d'administration, pas par une faille technique.

À appliquer à **deux moments** :

1. **Création ou modification d'un rôle** — chaque permission accordée doit
   être détenue par l'acteur
2. **Assignation d'un rôle** — l'acteur doit détenir toutes les permissions que
   ce rôle accorde

C'est une règle d'autorisation, pas un invariant d'intégrité : elle dépend de
l'acteur, que la base ne connaît pas. Elle vit donc en TypeScript, au même
endroit que `can()` (ADR 0003).

## Autres règles à porter dans la même couche

- Seul un porteur de `role.manage` peut créer ou modifier un rôle
- Seul un porteur de `member.manage_admin` peut accorder ou retirer un rôle
  système `owner` ou `admin`
- **Grant-only** : un rôle accorde, il ne retire jamais

Voir [ADR 0011](../adr/0011-roles-personnalises-par-organization.md).
