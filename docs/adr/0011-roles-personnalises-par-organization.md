# ADR 0011 — Rôles personnalisés par organization

**Statut** : Accepté
**Date** : 2026-08-20
**Remplace partiellement** : [ADR 0004](0004-rbac-catalogue-de-permissions.md)

## Contexte

L'[ADR 0004](0004-rbac-catalogue-de-permissions.md) plaçait la correspondance
rôle → permissions dans une constante versionnée en code, et reportait les
rôles personnalisés au motif qu'aucun besoin n'était exprimé.

Ce besoin est désormais exprimé : **une organization doit pouvoir définir ses
propres rôles**.

Cela impose de déplacer la correspondance en base. La combinaison
intermédiaire — noms de rôles en base, permissions en code — est explicitement
écartée : un rôle inséré sans correspondance côté code n'accorderait rien,
silencieusement.

## Décision

La correspondance rôle → permissions vit **en base**. Le **catalogue de
permissions reste défini en code** et alimente une table `permissions` par
migration, qui sert de cible de clé étrangère — aucune permission inconnue ne
peut donc être accordée.

```
permissions        (key, description)              -- vocabulaire, alimenté par migration
roles              (id, organization_id, scope, name, is_system)
role_permissions   (role_id, permission_key)
```

### Chaque organization possède ses propres rôles

Les rôles système (`owner`, `admin`, `viewer`, `editor`, `contributor`,
`guest`) sont **copiés dans chaque organization à sa création**, marqués
`is_system` — ni modifiables, ni supprimables.

`organization_members` et `project_members` référencent un rôle par une **clé
étrangère composite** :

```sql
FOREIGN KEY (organization_id, role_id) → roles (organization_id, id)
```

Il devient **structurellement impossible** d'assigner à un membre de
l'organization A un rôle appartenant à l'organization B.

### Deux règles de sécurité

**On ne peut pas accorder une permission qu'on ne détient pas.** Vérifié à la
création ou modification d'un rôle, *et* à son assignation. Sans cette règle,
un `admin` crée un rôle portant `org.delete`, se l'assigne, et devient
propriétaire — l'escalade par endpoint d'administration que la littérature
signale comme le vecteur principal.

**Grant-only.** Un rôle accorde, il ne retire jamais. Les règles de refus
compliquent l'évaluation et le débogage sans bénéfice ici.

Une permission s'ajoute au catalogue : **`role.manage`**, détenue par `owner`
et `admin`.

## Alternatives écartées

**Rôles système partagés (`organization_id NULL`).** Évite six lignes par
organization, mais la validation de l'assignation ne peut plus être une clé
étrangère : il faudrait un trigger vérifiant que le rôle appartient bien à la
bonne organization. Moins sûr, plus de machinerie — et la duplication évitée
est négligeable.

**Tout garder en code.** C'était l'ADR 0004 ; incompatible avec le besoin.

**Noms de rôles en base, permissions en code.** La combinaison qui dérive.

## Conséquences

**Ce que l'ADR 0004 conserve** : le catalogue de permissions atomiques défini
en code, la règle de découpage, le point de vérification unique `can(acteur,
permission, ressource)`, et le partage du catalogue avec les clés API.

**Ce qui change** : la matrice n'est plus une constante mais des lignes.

**Perte assumée** : modifier qui peut publier n'apparaît plus dans une revue de
code. La contrepartie est la règle d'escalade — personne ne peut accorder
au-delà de ce qu'il détient — et la journalisation de ces changements
([audit.md](../architecture/audit.md), qui couvre déjà les modifications de
rôle).

**La règle du dernier `owner`** ([ADR 0003](0003-rls-frontiere-tenant-roles-en-code.md)
et [architecture/roles-permissions.md](../architecture/roles-permissions.md))
s'applique au rôle système `owner` de chaque organization.

Sources : [Organization roles — WorkOS](https://workos.com/changelog/organization-roles)
· [How to design an RBAC model for multi-tenant SaaS — WorkOS](https://workos.com/blog/how-to-design-multi-tenant-rbac-saas)
