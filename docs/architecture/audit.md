# Journal d'audit

⚠️ **Rien de ce document n'est construit.** Ni la table `audit_log`, ni le point
d'émission. Ce qui suit est une conception, écrite au présent parce qu'elle
décrit ce que le système *sera* — le vérifier avant de s'y fier.

C'est le manque le plus structurant du socle : l'[ADR 0011](../adr/0011-roles-personnalises-par-organization.md)
annonçait ce journal comme la contrepartie des rôles personnalisés, et son
absence a forcé l'[ADR 0014](../adr/0014-creation-de-roles-reservee-au-owner.md)
à compenser autrement. Aujourd'hui, retirer quelqu'un, suspendre une adhésion
ou changer un rôle ne laisse **aucune trace**.

À concevoir **avec l'étape 6b**, pas avant : le concevoir sur les seules
écritures de gestion reviendrait à dessiner la couture avant la pièce.

Un **journal unique** couvre les actions faites par des humains (admin UI) et
par des clés API. Sans cela, l'asymétrie serait absurde : un script écrivant
via l'API serait tracé, mais un `admin` changeant le rôle de quelqu'un ou
publiant un document ne le serait pas — alors que ce sont justement les
actions sensibles d'un système de permissions.

## Table `audit_log`

```
id, organization_id, project_id (nullable),
actor_type ('user' | 'api_key'), actor_id,
action, target_type, target_id,
created_at
```

L'acteur est **polymorphe** : soit un utilisateur authentifié (`user_id`),
soit une clé API (`api_key_id`). Une clé API n'étant pas une personne, c'est
le seul moyen de retracer une écriture faite par un script.

## Étendue

Sont journalisés :

- **Écritures de contenu** : création, modification, suppression, publication
  d'un document ; création/modification/suppression d'un schéma
- **Actions administratives** : invitations envoyées et annulées, changements
  de rôle, ajouts et retraits de membres, révocation et suppression de clés
  API

## Point d'émission unique — couture à poser dès le départ

**Toute écriture passe par un point d'émission d'événement unique**, dont le
journal d'audit est le premier consommateur. Le journal n'est pas écrit par
des `INSERT` dispersés dans chaque handler.

Raison : les **webhooks** (prévus, non construits — voir
[evolutions-prevues.md](./evolutions-prevues.md)) consomment exactement les
mêmes événements que ce journal. Avec ce point d'émission, les brancher plus
tard revient à ajouter un second consommateur, sans toucher un seul handler.
Sans lui, il faudra reparcourir tous les endroits qui écrivent.

C'est la couture la plus rentable du lot : elle ne coûte qu'une discipline
d'écriture aujourd'hui.

## Rétention

Les entrées survivent à la disparition de leur acteur : une clé API révoquée
puis supprimée reste référencée par son id dans le journal (voir
[api.md](./api.md)), et `invitations.invited_by` passe à `NULL` sans effacer
les traces (voir [database.md](./database.md)).
