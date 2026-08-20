# Environnements

## Décision : poser la couture, pas la fonctionnalité

Les environnements (un bac à sable `staging` à côté de la production) **ne
sont pas construits au MVP**. Mais l'indirection qui les rendra faciles à
ajouter est posée dès le départ.

Raison : les trois concurrents directs ont tous ce mécanisme (*environments*
chez Contentful, *datasets* chez Sanity, *spaces* chez Storyblok). Le besoin
finira par se présenter, et le retrofit sur des données clients vivantes est
coûteux — il faudrait migrer trois tables et réécrire chaque requête de
contenu.

## À quoi ça sert

Permettre à un client de tester un changement de schéma **destructif**
(supprimer un champ, en renommer un, changer un type) contre son contenu réel,
sans casser son site en production.

À noter : ce n'est *pas* utile pour ajouter un champ facultatif — ce cas est
sans danger. Le besoin est plus étroit qu'il n'y paraît, mais c'est
précisément le moment où un client a le plus à perdre.

## Le modèle

```
projects → environments → { schemas, documents, api_keys }
```

```
environments
  id            uuid
  project_id    uuid  → projects.id
  name          text
  created_at
```

- Unicité sur `(project_id, name)`
- `schemas`, `documents` et `api_keys` portent un **`environment_id`** au lieu
  d'un `project_id` (colonne remplacée, pas ajoutée — le projet reste
  atteignable via `environments.project_id`)
- La création d'un projet insère **dans la même transaction** le projet et sa
  ligne `master`. Un projet sans environnement ne doit jamais exister

## Ce qui ne change pas

- **Les permissions.** `organization_members` et `project_members` restent
  attachés au projet. Un environnement est une subdivision *interne* au
  projet, pas un niveau de permission : un `editor` du projet l'est pour tous
  ses environnements
- **L'UI.** Aucun écran, aucun sélecteur — le mot « environnement »
  n'apparaît nulle part tant que la fonctionnalité n'est pas construite.
  L'admin UI résout `master` silencieusement

## Coût à l'exécution

Une résolution supplémentaire en début de requête (l'environnement `master` du
projet X), puis un filtre direct sur `environment_id`. Ce saut est aussi sur
le **chemin chaud** de l'API publique — chaque requête d'un site client résout
clé → environnement → projet. À mettre en cache.

## Règles reprises des leaders

| Règle | Origine |
|---|---|
| `master` immuable : ni suppression, ni renommage | Contentful |
| Plafond du nombre d'environnements par projet | Contentful en impose 11 par space — sans plafond, le clonage fait exploser le stockage |
| Nom en minuscules, chiffres, `-` et `_`, commençant et finissant par un alphanumérique | Sanity — le nom finit dans des URLs d'API |
| Les environnements autres que `master` sont **jetables** | Contentful les conçoit comme des ressources temporaires, pas des installations permanentes |

## Ce qui reste hors périmètre, même à terme

- **Le clonage inverse** (staging → production). Le constat de terrain chez
  Sanity : les équipes ne poussent pas le contenu de staging vers la
  production — elles y testent des changements de schéma, et le contenu réel
  est créé directement en production. Le flux est **à sens unique**, ce qui
  élimine la partie la plus difficile
- **Les alias** façon Contentful (un `master` échangeable pointant vers une
  cible interchangeable). C'est une couche d'indirection supplémentaire
  *au-dessus* de `environment_id`, réservée chez eux au Premium/Enterprise

Détail de la recherche :
[../research/comparaison-environnements.md](../research/comparaison-environnements.md)
