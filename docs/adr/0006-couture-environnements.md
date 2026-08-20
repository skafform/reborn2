# ADR 0006 — Couture d'environnements : `environment_id` dès le départ

**Statut** : Accepté
**Date** : 2026-08-19

## Contexte

Les trois concurrents directs disposent tous d'un mécanisme d'environnements :
*environments* chez Contentful, *datasets* chez Sanity, *spaces* séparés chez
Storyblok. Il sert à tester un changement de schéma **destructif** (supprimer
un champ, en renommer un, changer un type) contre du contenu réel, sans casser
un site en production.

Le rattachement du contenu est difficile à changer après coup : il faudrait
migrer plusieurs tables sur des données clients vivantes et réécrire chaque
requête de contenu ainsi que la résolution des clés API.

## Décision

**La fonctionnalité n'est pas construite, mais l'indirection est posée.**

```
projects → environments → { schemas, documents, api_keys }
```

Ces trois tables portent un `environment_id` au lieu d'un `project_id`. La
table `environments` ne contient qu'une ligne `master` par projet, créée
automatiquement dans la même transaction que le projet, et jamais exposée dans
l'UI.

## Alternatives écartées

**Rattacher le contenu à `project_id` et migrer plus tard.** Défendable tant
qu'il n'y a pas de clients en production, mais le coût croît avec l'usage.

**Construire la fonctionnalité maintenant.** Aucun besoin exprimé ; elle ne
sert qu'aux changements destructifs, plus rares.

## Conséquences

Coût permanent : une résolution supplémentaire en début de requête, sur le
**chemin chaud** de l'API publique — à mettre en cache.

Les permissions ne changent pas : un environnement est une subdivision interne
au projet, pas un niveau d'autorisation.

Le constat de terrain chez Sanity — *les équipes testent des changements de
schéma en staging, mais créent le contenu réel directement en production* —
élimine la partie la plus difficile : **le clonage inverse (staging →
production) n'aura pas à être construit**. Le flux est à sens unique.

Les alias façon Contentful restent hors périmètre : c'est une indirection
supplémentaire *au-dessus* d'`environment_id`.

Détail : [../architecture/environments.md](../architecture/environments.md) ·
[../research/comparaison-environnements.md](../research/comparaison-environnements.md).
