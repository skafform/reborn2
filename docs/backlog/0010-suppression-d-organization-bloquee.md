# 0010 — Une organization ne peut pas être supprimée

**État** : **fait** — migration `0019_delete_organization_cascade.sql`
**Priorité** : 🔴 Bloquant — la permission `org.delete` existe et ne peut pas s'exercer
**Ouvert le** : 2026-08-20
**Clos le** : 2026-08-20

## Le constat

`DELETE FROM organizations WHERE id = …` **échoue toujours**, quel que soit le
rôle, y compris en superuser :

```
ERROR:  system roles cannot be deleted
CONTEXT:  PL/pgSQL function protect_system_roles() line 5 at RAISE
SQL statement "DELETE FROM ONLY "public"."roles" WHERE $1 = "organization_id""
```

La clé étrangère `roles.organization_id` est en `ON DELETE CASCADE`. Supprimer
une organization propage donc un `DELETE` vers ses rôles — et le garde-fou
`protect_system_roles`, qui doit empêcher de supprimer un rôle système
isolément, l'intercepte sans distinguer les deux situations.

Le garde-fou est juste ; sa portée est trop large. Un rôle système ne doit pas
disparaître **tant que son organization existe**. Quand elle disparaît, il n'a
plus d'objet.

## Comment ça a été découvert

En construisant la console, au moment de nettoyer les données d'un essai. Aucun
test ne l'avait signalé — voir [0011](0011-nettoyage-des-tests-avale-ses-erreurs.md),
qui explique pourquoi, et qui est la vraie raison pour laquelle ça a pu durer.

## Conséquence mesurée

La base de développement portait **305 organizations, 579 comptes et 231
invitations** au moment de la découverte, presque uniquement des restes de
suites de tests qui croyaient nettoyer derrière elles.

## Le remède retenu

**Demander à la base si l'organization existe encore.** C'est exactement ce que
`protect_last_owner` fait déjà dans le même fichier de départ — le mécanisme
existait, il n'avait pas été appliqué ici.

```sql
IF OLD.is_system
   AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id)
THEN RAISE EXCEPTION 'system roles cannot be deleted' …
```

L'action référentielle d'un `ON DELETE CASCADE` s'exécute **après** la
suppression de la ligne parente. Au moment où le trigger se déclenche pour une
cascade, l'organization est donc déjà partie et le garde-fou laisse faire ; sur
une suppression directe de rôle, elle est là et il refuse.

**Écarté** : un marqueur de transaction (`set_config('app.deleting_organization',
…)`), envisagé d'abord. Il aurait ajouté un mécanisme là où une question à la
base suffit — et un état à poser correctement, donc à oublier.

`protect_system_role_permissions` a été réécrite pour la même raison : elle
reposait déjà sur cet effet de bord sans le dire.

## Vérifié

- Une organization se supprime et emporte rôles, permissions de rôles,
  adhésions et invitations
- Un rôle système reste **impossible** à supprimer isolément
- Les deux ont leur test dans `src/services/organizations.test.ts`

## Ce qui n'a pas changé, et c'est voulu

`projects.organization_id` est en `ON DELETE RESTRICT` : une organization qui
porte encore des projets ne s'efface pas par mégarde. La règle métier complète
— plus aucun membre, plus aucun projet — appartient à la route `org.delete`,
qui reste à écrire.
