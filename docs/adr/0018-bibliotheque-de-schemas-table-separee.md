# ADR 0018 — La bibliothèque de schémas est une table à part

**Statut** : Accepté
**Date** : 2026-08-21

## Contexte

Un schéma appartient aujourd'hui à un **environnement** — `schemas` porte un
`environment_id`, jamais un `project_id`
([ADR 0006](0006-couture-environnements.md)).

Le besoin ajouté : des schémas qui appartiennent à l'**organization** seule,
une bibliothèque partagée dans laquelle les projets viennent copier. Un
troisième niveau, donc, au-dessus des deux existants.

La modélisation d'abord envisagée était une **convention sur la table
existante** : `environment_id` à `NULL` signifiant « appartient à
l'organization ».

## Décision

**Une table distincte, `library_schemas`, cadrée par `organization_id`.**

⚠️ **La convention par `NULL` ne survit pas à nos policies.** Une colonne de
cadrage nulle se lit `NULL` dans `current_setting`, ce qui ne rend **aucune
ligne** — le *fail-closed* voulu ([securite.md](../architecture/securite.md)).
Une ligne de bibliothèque serait invisible de toutes les policies, et le
contourner demanderait une seconde branche dans une policy, sur une table
critique pour la sécurité. Chaque table garde **exactement une** colonne de
cadrage, comme partout ailleurs.

### Ce que la séparation achète

**L'invariant devient impossible à violer.** « Un document ne référence qu'un
schéma de projet » n'est plus une règle à faire respecter : la clé étrangère de
`documents` ne peut tout simplement pas pointer vers `library_schemas`. Une
bibliothèque ne porte aucun contenu, par construction.

**La copie devient explicite dans sa portée.** L'opération est *copier un
schéma de bibliothèque dans un environnement cible*, jamais « dans un projet » —
un projet ne contient pas de schéma. La copie n'existe que dans
l'environnement où elle a été faite : si le projet gagne un `staging` plus
tard, **rien ne s'y propage**, y copier est un geste délibéré de plus.

### La provenance, et pourquoi pas le nom

`schemas.copied_from` pointe vers la ligne de bibliothèque dont il est issu,
`NULL` pour un schéma créé directement.

Apparier par le **nom** casserait le jour où quelqu'un renomme un schéma — or
c'est précisément la question « quels projets utilisent une version modifiée de
ce schéma ? » qui doit rester fiable.

⚠️ **C'est le seul lien du modèle qui traverse deux niveaux de cadrage** :
`schemas` est cadrée par environnement, `library_schemas` par organization. La
clé étrangère composite est donc `(organization_id, copied_from)`, et ça doit
se lire comme délibéré dans le schéma.

### La divergence, en trois états

Par comparaison de hachages uniquement ([ADR 0016](0016-versionnage-des-schemas-adresse-par-contenu.md)),
sans aucun moteur de diff :

| Situation | État |
|---|---|
| Hachage de la copie = hachage courant de la bibliothèque | **identique** |
| Hachage de la copie présent dans l'historique de la bibliothèque, mais pas courant | **copie intacte, bibliothèque avancée** |
| Hachage de la copie absent de l'historique de la bibliothèque | **copie modifiée localement** |

⚠️ **Le troisième état en confond deux** : « seule la copie a bougé » et « les
deux ont bougé ». Le diagnostic reste juste, il est seulement moins précis que
son nom ne le suggère — d'où `locally_modified` et non `diverged_from_library`,
pour qu'aucun écran ne le survende. Distinguer les sous-cas imposerait de
comparer des plages d'historique : hors périmètre.

## Alternatives écartées

**`environment_id` nullable sur `schemas`.** Une table de moins, et le modèle
que proposait la première esquisse. Écarté par le *fail-closed* décrit
ci-dessus : ce n'est pas une gêne d'écriture de requêtes, c'est une ligne
invisible sous RLS.

**Une table de liaison** entre bibliothèque et copies, plutôt qu'une colonne de
provenance. Écarté : une copie a exactement une source ou aucune, donc une
table pour une cardinalité 0..1 n'ajoute qu'une jointure.

**Une synchronisation** bibliothèque → copies. Écarté du périmètre, pas de
l'avenir : la copie est indépendante par construction, et un flux
« proposer la mise à jour » se construira sur le deuxième état de divergence
s'il devient nécessaire.

## Conséquences

**Deux tables de forme voisine**, et c'est le coût assumé. Elles divergeront de
toute façon : une bibliothèque n'a ni statut de publication, ni documents, ni
environnement.

**Une bibliothèque se versionne comme le reste.** Elle est modifiable après que
des copies existent, donc elle a son `current_hash` et son propre journal —
sans quoi le deuxième état de divergence ne serait pas calculable.

⚠️ **Éditer la bibliothèque a sa propre permission**, `library.write`, et non
`schema.write`. Le risque réel est plus faible qu'il n'en a l'air — les copies
étant indépendantes, une édition de bibliothèque ne casse rien d'existant — d'où
un défaut à `owner` **et** `admin`. Mais c'est une clé distincte parce que ce
défaut sera probablement revisité : le restreindre au `owner` doit rester un
ajustement de rôle, pas une chirurgie du catalogue. Voir
[roles-permissions.md](../architecture/roles-permissions.md).
