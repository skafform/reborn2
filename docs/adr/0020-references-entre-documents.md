# ADR 0020 — Références entre documents : `data` fait foi, un index dérivé porte les contraintes

**Statut** : Accepté
**Date** : 2026-08-22

## Contexte

Permettre à un document d'en pointer un autre était la **dernière décision
ouverte** avant la couche de contenu. Deux pistes étaient posées
([content-schemas.md](../architecture/content-schemas.md)) : la référence
uniquement dans `documents.data`, ou `data` plus une table d'index dérivée.

⚠️ **Ceci est une décision, pas un ordre de travail.** Rien ne se construit
avant son consommateur : la table naît **avec `documents`**, à l'étape 4. Une
table de références sans documents à indexer est exactement l'erreur d'un
projet précédent — créée, jamais remplie.

## Décision

### Un sixième type de champ

```json
{ "name": "author", "type": "reference", "to": "author",
  "validation": { "required": false } }
```

⚠️ **`to` désigne un schéma par son *nom*, jamais par son identifiant**, et ce
n'est pas une commodité. Un schéma de bibliothèque copié dans trois projets
doit rester portable : par nom, chaque copie résout contre l'`author` de **son**
environnement ; par identifiant, chaque copie pointerait vers le schéma d'un
autre environnement, ce que le cadrage interdit structurellement
([ADR 0018](0018-bibliotheque-de-schemas-table-separee.md)).

`name` est déjà contraint comme identifiant et gelé après création : il est
fait pour ce rôle.

Périmètre serré : **une référence, un schéma cible**. Ni listes, ni unions
multi-cibles — les deux s'ajouteront sans invalider d'empreinte.

### `data` fait foi, l'index est dérivé

La valeur stockée est l'UUID du document cible, dans `documents.data`. La table
`document_references` est **reconstructible** en rebalayant les documents,
jamais autoritaire.

⚠️ C'est ce qui rend le motif peu risqué : un défaut de synchronisation est une
dette réparable, jamais une perte de données.

```
document_references
  organization_id      dénormalisé, en tête de chaque index
  environment_id       la colonne de cadrage
  source_document_id   FK composite → documents (id, environment_id), ON DELETE CASCADE
  target_document_id   FK composite → documents (id, environment_id), ON DELETE RESTRICT
  field_name           quel champ de la source porte cette référence
```

⚠️ **Les clés composites font un travail silencieux** : les deux extrémités
portent le **même** `environment_id` dans une seule ligne, donc une référence
ne peut pas traverser les environnements. Interdit par la forme, pas par la
discipline — le motif d'`api_keys` et de `schemas`.

### La synchronisation vit dans la transaction d'écriture

À chaque écriture d'un document : supprimer ses lignes d'index, les réinsérer
depuis `data` — **dans la même transaction**. Les deux réussissent ou aucune.

Aucune tâche de fond, aucune cohérence à terme, aucune synchronisation entre
systèmes. C'est ce qu'un seul Postgres achète, et on le prend.

Une routine de reconstruction accompagne l'étape 4, pour que la propriété
« dette réparable » soit réelle et pas théorique.

### Supprimer une cible référencée est refusé

`ON DELETE RESTRICT`, et le refus **nomme ce qui pointe**.

C'est déjà la règle partout ici — clé API, rôle, adhésion, projet,
organization : rien ne se supprime tant que ça tient quelque chose, et le refus
compte ce qui reste. L'index rend cette liste triviale à produire.

⚠️ **Un 409 nu serait `RESTRICT` sans ses manières.**

## Alternatives écartées

**La référence uniquement dans `data`.** Répondre à « qu'est-ce qui pointe vers
ce document ? » imposerait de fouiller le JSON de tous les documents — or la
question se pose à chaque suppression.

**L'index faisant autorité.** Deux écritures à garder d'accord, donc la dérive
classique. `data` est ce que l'API de livraison sert : c'est lui le document.

**Les références faibles** façon Sanity, tolérant le pendant. Écarté : ça
déplace le travail de tolérance sur chaque rendu et chaque consommateur du SDK.
Le public visé — développeurs seuls, petites agences — est mieux servi par un
refus clair que par un site qui doit survivre à des trous. Reste possible plus
tard **en option par champ** : un ajout, pas une migration.

## ⚠️ Ce que cette décision ne tranche pas

*« Faut-il bloquer la publication d'un document qui référence un brouillon non
publié ? »* — le point que
[decisions-ouvertes.md](../architecture/decisions-ouvertes.md) désignait comme
méritant débat.

Une clé étrangère garantit l'**existence**, jamais l'**état de publication**.
Le `status` vit sur la ligne cible, et aucune contrainte de base ne l'exprime :
c'est une règle applicative, au point d'émission d'événements
([ADR 0008](0008-point-d-emission-d-evenements-unique.md)).

La question ouverte se réduit donc de « les références entre documents » à
cette seule phrase — et elle ne bloque pas l'étape 4, elle s'y décide.

## Hors périmètre de la v1

- **L'expansion côté SDK** : le champ se type en `string`, l'identifiant. Le
  peuplement automatique est un raffinement de l'API de livraison
- **Listes, cibles multiples**, et tout ce qui ressemblerait à un graphe de
  contenu interrogeable
- **Toute UI** au-delà de l'éditeur de champs gagnant `reference` dans sa liste
  de types — ce que le typage du contrat imposera de lui-même
