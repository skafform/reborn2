# ADR 0012 — Résolution des permissions par requête, et codes de refus

**Statut** : Accepté
**Date** : 2026-08-20

## Contexte

L'[ADR 0004](0004-rbac-catalogue-de-permissions.md) pose un point de
vérification unique `can(acteur, permission, ressource)`, et
l'[ADR 0011](0011-roles-personnalises-par-organization.md) place la
correspondance rôle → permissions en base. Restait à décider **où** et **à
quelle fréquence** ces permissions sont lues, et **ce que renvoie un refus**.

## Décision

### Une résolution par requête HTTP, aucun cache inter-requêtes

- Le middleware effectue **une seule requête** ramenant appartenance et
  permissions
- Le jeu de permissions vit sur le contexte de la requête ; `can()` n'accède
  jamais à la base
- **Refus par défaut** : l'absence de permission refuse

Conséquence directe et recherchée : **un retrait de rôle prend effet à la
requête suivante**, sans invalidation à orchestrer.

### Codes de refus : 404 par défaut, 403 seulement quand rien n'est caché

| Situation | Réponse |
|---|---|
| L'acteur n'a **aucun accès** à la ressource | **404** |
| Il **voit** la ressource mais n'a pas le droit pour cette action | **403** |

Un 403 sur une ressource invisible confirmerait son existence — de
l'énumération offerte. À l'inverse, répondre 404 à un `viewer` qui tente de
publier un document qu'il a sous les yeux ne cache rien et transforme un refus
légitime en rapport de bug.

Cela s'aligne naturellement avec RLS : une ressource invisible renvoie déjà
zéro ligne en base, donc un 404 sans effort. La base et l'API disent la même
chose par construction, pas par une règle maintenue en double.

## Alternatives écartées

**Cache inter-requêtes (Redis, TTL).** C'est là que naissent les bugs
d'autorisation : un `allow` mis en cache devient faux quand les permissions
changent, et un contexte de locataire absent de la clé fait fuiter des accès
entre organizations — précisément la classe de faille que l'[ADR 0003](0003-rls-frontiere-tenant-roles-en-code.md)
ferme. Optimisation à ajouter **une fois mesurée**, avec les règles connues :
clé incluant tout le contexte de décision, TTL court, échec fermé, refus mis en
cache plus volontiers que les autorisations.

**Une requête par appel de `can()`.** Correct mais multiplie les
allers-retours : la source ne change pas au cours d'une requête.

**Transaction ouverte pendant toute la requête**, pour que permissions et
données partagent le même instantané MVCC. Plus cohérent en théorie, mais
mobiliser une connexion du pool pendant tout le traitement HTTP est un
anti-patron reconnu. La fenêtre de course se compte en microsecondes.

**403 partout.** Simple, mais offre l'énumération des ressources.

## Conséquences

Les refus d'accès sont un événement **normal** dans une application sécurisée
(CWE-280) : leur traitement est centralisé, avec un seul chemin de code, afin
qu'aucun échec ne laisse l'application dans un état imprévisible.

Le middleware devient le point de passage obligé — il produit à la fois le jeu
de permissions et le `QueryContext` que `withContext` consomme.

Détail et sources :
[../research/resolution-des-permissions.md](../research/resolution-des-permissions.md).
