# 0002 — `FORCE ROW LEVEL SECURITY` sur les tables applicatives

**État** : ouvert
**Priorité** : 🔴 À faire à la création des tables (étape 3)
**Ouvert le** : 2026-08-20

## Ce qui est déjà en place

Les deux rôles Postgres existent et sont vérifiés : `skafform_owner` possède le
schéma, `skafform_app` sert au serveur — ni superuser, ni propriétaire, sans
`BYPASSRLS`. Les droits par défaut donnent automatiquement les opérations CRUD
à `skafform_app` sur les tables créées par `skafform_owner`.

## Ce qui manque

Aucune table applicative n'existe encore, donc aucune policy ni
`FORCE ROW LEVEL SECURITY`.

`skafform_app` n'étant pas propriétaire, il est déjà soumis aux policies sans
`FORCE`. Celui-ci reste une défense en profondeur : il protège si quelqu'un
connecte un jour le serveur avec le rôle propriétaire.

## À faire

Sur chaque table applicative, au moment de sa création :

- `ENABLE ROW LEVEL SECURITY` et `FORCE ROW LEVEL SECURITY`
- une policy sur la colonne de cadrage (`organization_id` /
  `environment_id`), **sans aucune valeur de repli**
- la colonne de cadrage en **tête de chaque index** de la table

## Vérification

Se connecter en `skafform_app` et confirmer qu'une requête sans contexte posé
retourne zéro ligne — pas une erreur, zéro ligne.

Voir [ADR 0003](../adr/0003-rls-frontiere-tenant-roles-en-code.md) et
[architecture/securite.md](../architecture/securite.md).
