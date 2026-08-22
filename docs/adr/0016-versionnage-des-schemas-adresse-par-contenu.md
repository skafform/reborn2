# ADR 0016 — Versionnage des schémas adressé par contenu

**Statut** : Accepté
**Date** : 2026-08-21

## Contexte

Le schéma d'un type de contenu vit **en base**, pas dans le code
([content-schemas.md](../architecture/content-schemas.md)). C'est ce qui permet
à un client d'ajouter un type sans toucher au dépôt — et c'est aussi ce qui
crée le trou : si quelqu'un supprime un champ par erreur, il n'existe

- aucun historique de l'état antérieur,
- aucun retour en arrière,
- et le journal d'audit ([audit.md](../architecture/audit.md)) enregistre
  *qu'il y a eu* une modification, pas *ce qui a changé*.

⚠️ **Les environnements ne comblent pas ce trou.** Un `staging` protège
**pendant** un test ; il ne restaure rien **après** une erreur en production.

S'ajoute un second besoin, qui n'a l'air d'être qu'une commodité et gouverne en
fait tout le reste : une bibliothèque de schémas au niveau de l'organization
([ADR 0018](0018-bibliotheque-de-schemas-table-separee.md)) sera copiée dans
des projets, et il faudra savoir **quelles copies ont divergé de leur source**.

## Décision

**L'identité d'une version est le hachage de sa définition normalisée**, pas un
numéro d'ordre.

Deux tables, et la séparation est le cœur de la décision :

| Table | Nature | Analogue Git |
|---|---|---|
| `schema_versions` | Contenu immuable, dédupliqué. Aucune lignée. | *blob* |
| `schema_history` | Journal par schéma, en ajout seul, ordonné. | *commit* |

`schemas.current_hash` pointe vers la version courante.

⚠️ **La lignée ne peut pas vivre sur la ligne de version.** Les versions sont
dédupliquées : si le schéma A évolue de v1 vers v2, et que le schéma B
enregistre indépendamment une définition identique à v2, les deux partagent
**une seule ligne**. Un `parent_hash` posé dessus mêlerait deux lignées qui
n'ont rien à voir. Le contenu est partagé, l'histoire est propre à chaque
schéma — c'est exactement pourquoi Git sépare le blob du commit.

**Enregistrer** : normaliser → hacher → insérer la version si ce hachage est
inconnu → ajouter une ligne d'historique → déplacer `current_hash`. Le tout
dans une transaction. Enregistrer une définition dont le hachage est déjà le
courant est un **no-op** : ni version, ni ligne d'historique, ni déplacement.

**Restaurer** : remettre `current_hash` sur un hachage plus ancien, et ajouter
une ligne d'historique qui enregistre ce déplacement. ⚠️ **L'historique n'est
jamais réécrit** — il montre l'aller-retour, qui est un fait, pas du bruit.

### ⚠️ La déduplication est par organization, jamais globale

Une déduplication globale a été proposée, et écartée pour la raison qui avait
déjà écarté la même idée sur les assets
([assets.md](../architecture/assets.md)) : la ligne partagée porte un
`created_at` **antérieur** à ma première sauvegarde, ce qui m'apprend qu'une
autre organization détient exactement ce schéma. Sur un modèle de contenu,
c'est une structure métier qui fuit.

Structurellement, c'est pire : une table globale **n'a pas de colonne de
cadrage**, donc RLS ne s'y applique pas. Ce serait la première table
applicative hors du modèle sur lequel repose toute la sécurité
([securite.md](../architecture/securite.md)).

La clé primaire est donc `(organization_id, hash)`. Tout le bénéfice recherché
— comparer des copies à leur source — vit de toute façon dans une seule
organization.

### ⚠️ Le hachage porte un tag d'algorithme

`sha256-1:<hex>`, jamais `<hex>` nu.

Le hachage n'a de sens que si la normalisation est déterministe, et geler cette
fonction est **une décision qui ne peut être fausse qu'une fois**. Un cas
Unicode, un flottant, une clé vide découverts au sixième mois laissent deux
issues sans le tag : corriger et invalider tous les hachages de tous les
clients, ou ne pas corriger et vivre avec pour toujours.

Avec le tag, les anciennes lignes gardent le leur, les nouvelles prennent le
suivant, et **la comparaison n'a de sens qu'à l'intérieur d'un tag**. Une
classe de bug irrattrapable devient une migration.

Git fait la même chose avec son format d'objet, pour la même raison.

## Alternatives écartées

**Des numéros de version** (`v1`, `v2`…). C'est ce à quoi on pense d'abord.
Écarté parce que deux définitions identiques recevraient des numéros
différents : la question « cette copie a-t-elle divergé ? » redeviendrait un
diff, alors qu'elle doit être une comparaison d'égalité.

**Un tableau JSONB de révisions sur `schemas`.** Deux tables de moins, et ça
répond entièrement au besoin de restauration. Écarté pour la même raison : sans
identité de contenu, la comparaison entre une copie et sa bibliothèque redevient
un diff — or c'est le seul motif du mécanisme.

**Enrichir le journal d'audit pour qu'il stocke le diff.** Écarté : un diff
stocké répond à « qu'est-ce qui a changé ? » et pas à « quel était l'état
exact ? ». Restaurer imposerait de rejouer les diffs à l'envers, ce qui est
faux dès qu'il en manque un.

## Conséquences

**La normalisation canonique est gelée par tag** : tri profond des clés,
sérialisation stable, **ordre des tableaux préservé** — c'est de la donnée. Sa
suite de tests est ce qui protège tous les hachages déjà écrits.

**Un retour accidentel à une définition antérieure produit le même hachage.**
L'historique montre alors A → B → A, et le `created_at` de la version reste
celui de sa **première** apparition. C'est voulu : la version est un contenu,
pas un événement.

⚠️ **Le jour où le tag change**, réenregistrer une définition *inchangée*
produira une nouvelle ligne de version sous le nouveau tag. Pendant un cycle,
une copie se lira « la bibliothèque a bougé ». Ça se résorbe seul au
réenregistrement suivant — anticipé, pas un défaut.

**Rien à rattraper.** Aucun schéma n'existe : la version initiale et sa ligne
d'historique font partie de la création d'un schéma, il n'y a pas de
remplissage rétroactif à écrire.

**Ça ne concerne que les schémas.** Les documents ne sont pas versionnés par ce
mécanisme, et [ADR 0017](0017-validation-a-l-ecriture-seulement.md) explique
pourquoi ils n'ont pas à l'être.
