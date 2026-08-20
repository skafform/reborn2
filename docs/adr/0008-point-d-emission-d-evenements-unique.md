# ADR 0008 — Point d'émission d'événements unique

**Statut** : Accepté
**Date** : 2026-08-19

## Contexte

Trois fonctionnalités consomment exactement les mêmes événements — les
écritures de contenu et les actions administratives :

1. le **journal d'audit**, nécessaire dès maintenant
2. les **webhooks**, prévus
3. la **purge de cache CDN**, prévue — Sanity recommande une invalidation
   pilotée par les événements, et chez Contentful ce sont littéralement les
   webhooks qui la déclenchent

Si les écritures ne passent par aucun point commun, brancher les deux
dernières imposerait de reparcourir tous les handlers.

## Décision

**Toute écriture passe par un point d'émission d'événement unique**, dont le
journal d'audit est le premier consommateur.

Le journal n'est **pas** écrit par des `INSERT` dispersés dans les handlers.

## Alternatives écartées

**Journaliser directement dans chaque handler.** Plus direct à écrire
aujourd'hui, mais chaque consommateur ultérieur exige de tout reprendre.

**Un bus d'événements complet.** Rejeté par défaut : aucun problème actuel ne
le justifie. Un point d'appel commun suffit.

## Conséquences

C'est la couture la moins coûteuse du projet : elle ne demande qu'une
discipline d'écriture, aucune logique métier.

Brancher webhooks et purge de cache reviendra à ajouter un consommateur, sans
toucher un seul handler.

Le journal a un **acteur polymorphe** — `user` ou `api_key` — ce qui se referme
sur le catalogue de permissions partagé entre humains et clés (ADR 0004).

Détail : [../architecture/audit.md](../architecture/audit.md) ·
[../architecture/cache.md](../architecture/cache.md).
