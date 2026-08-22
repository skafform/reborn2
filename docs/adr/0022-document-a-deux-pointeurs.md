# ADR 0022 — Un document, deux pointeurs : l'état de publication est dérivé

**Statut** : Accepté
**Date** : 2026-08-22

## Contexte

La forme prévue pour `documents` portait un champ `status` (`draft` /
`published`). Ce modèle ne peut pas exprimer le cas central du travail
éditorial : **un document publié qui porte des modifications en attente**. Avec
une seule ligne et un seul statut, éditer un document en production, c'est soit
modifier ce que le public voit, soit inventer une danse de copie.

Aucun acteur établi ne livre « une ligne, un statut » :

- **Contentful** expose quatre états visibles, dont **Changed** — publié *et*
  portant des modifications ; l'API de livraison sert la dernière version
  publiée pendant que les changements attendent
- **Sanity** duplique le document (`drafts.abc` / `abc`). Coût documenté : la
  logique « quelle variante lire ? » fuit dans chaque requête, assez pour
  qu'ils construisent *Perspectives* afin de la réparer

Même concept, deux implémentations. Sanity paie en deux lignes et en logique de
sélection ; Contentful paie en magasin de versions et en états dérivés.

## Décision

**Le modèle de Contentful, sur la machinerie qu'on a déjà** : une seule ligne
`documents`, **deux pointeurs** vers un magasin de versions adressé par contenu
— la mécanique d'[ADR 0016](0016-versionnage-des-schemas-adresse-par-contenu.md),
appliquée au `data` d'un document.

```
documents
  …colonnes prévues (environment_id, schema_id, locale, …)
  data             JSONB      -- dénormalisé : ce que la console édite
  current_hash     NOT NULL   -- ce que la console édite
  published_hash   NULL       -- ce que l'API de livraison sert
```

**Les états sont dérivés, jamais stockés** :

| État | Condition |
|---|---|
| Draft | `published_hash IS NULL` |
| Published | `published_hash = current_hash` |
| Changed | `published_hash IS NOT NULL` et `≠ current_hash` |

Chaque consommateur a **un champ et zéro conditionnelle** : la livraison lit
`published_hash`, toujours ; la console lit `current_hash`, toujours. C'est ce
que Sanity a dû rattraper avec Perspectives, obtenu ici par la forme.

Les opérations sont des déplacements de pointeur, en une transaction :

| Geste | Effet |
|---|---|
| **Enregistrer** | version si l'empreinte est inconnue → `current_hash` bouge. No-op complet si rien n'a changé — l'isomorphe du geste des schémas |
| **Publier** | les deux portes (voir plus bas) → `published_hash := current_hash` |
| **Dépublier** | l'autre porte de la clôture → `published_hash := NULL` |
| **Abandonner les modifications** | `current_hash := published_hash` — la restauration qu'on a déjà, gratuite |

### ⚠️ Le nettoyage est synchrone, jamais un « GC plus tard »

Chaque enregistrement rend une version orpheline, et le contenu change des
ordres de grandeur plus souvent que les schémas — l'argument même qui a écarté
le journal. L'accumulation des versions de schémas était bornée par le journal
et la rareté des éditions ; celle-ci serait **non bornée dès le premier jour**.
Un « GC plus tard » sur une croissance non bornée n'est pas un report, c'est
une dette qui grossit au rythme de l'usage.

Donc : quand `current_hash` bouge, la transaction tente de **supprimer
l'ancienne version si plus aucun pointeur de l'organization ne la référence** —
un `NOT EXISTS` sur deux index partiels (`current_hash`, `published_hash`),
deux lookups qui font disparaître une politique de rétention entière. L'état
stationnaire est de 1 à 2 payloads par document.

⚠️ **La course perdue est un succès.** Les pointeurs portent une clé étrangère
vers le magasin : si un autre document reprend l'empreinte pendant qu'on la
supprime, la suppression échoue sur la contrainte — la version est référencée,
donc elle doit vivre. Ce refus s'avale silencieusement ; c'est le système qui
fonctionne, pas une erreur. L'invariant est tenu par la structure, pas par la
vigilance, et le test de concurrence qui le prouve vaut la peine d'exister.

### Le périmètre de l'empreinte : `data` seul

**L'adressage dit *où* est le contenu, pas *ce qu'il est*.** `locale` et
`translation_group_id` sont des colonnes de la ligne ; les mettre dans
l'empreinte re-hacherait un contenu inchangé au premier changement de locale.
Même famille que `label ?? null` : le périmètre est une connaissance du
domaine, il vit dans une fonction `documentFingerprint` **distincte de celle
des schémas** — mais sous le même tag, voir *Conséquences* — et
`normalise.ts`, gelé, ne bouge pas.

### ⚠️ `data` sur la ligne et la version pointée sont le même contenu

Le courant est dénormalisé sur la ligne (la console lit sans jointure, et c'est
elle qui enchaîne écritures et lectures rapprochées) ; la livraison joint le
magasin par `published_hash` — jointure sur clé primaire, derrière un cache de
toute façon. Dénormaliser les deux doublerait le stockage que la déduplication
vient d'économiser : le cas majoritaire — publié, sans modification — stocke
**un** payload.

L'invariant silencieux que crée ce dédoublement — `data` ≡ version pointée par
`current_hash` — est tenu par **une seule fonction d'écriture** dans la
transaction, et mérite son assertion dans les tests : c'est le genre de
dédoublement qui dérive si deux chemins d'écriture apparaissent un jour.

## Alternatives écartées

**Une colonne `status`.** Le modèle esquissé au départ. Ne peut pas exprimer
*Changed* : éditer un document en production modifierait ce que le public voit,
ou exigerait une copie. Aucun leader ne le livre, pour cette raison.

**Les deux lignes de Sanity.** La logique de sélection de variante fuit dans
chaque requête et chaque synchronisation externe — ce que Perspectives a été
construit pour réparer. Ici, chaque consommateur a son champ.

**Un journal des documents.** Le contenu change trop souvent : seules les
versions **atteignables par un pointeur** doivent exister. Pas de lignée, pas
de restauration vers un passé arbitraire — deux pointeurs de stockage, pas une
archive. Si l'historique complet devient un besoin produit, il arrive comme sa
propre décision, avec sa propre analyse de croissance.

**Archived.** Hors v1 : c'est une dépublication plus un filtre de liste —
additif plus tard.

## Conséquences

**Un magasin `document_versions`**, de la forme de `schema_versions` — cadré
`(organization_id, hash)`, dédupliqué par organization pour la même raison de
canal auxiliaire.

⚠️ **Une table à part, et non `schema_versions` réutilisée**, alors que les
deux ont la même forme et la même empreinte. La raison est le nettoyage : une
version de schéma est retenue **pour toujours** par un journal en ajout seul ;
une version de document n'est retenue que par deux pointeurs, et disparaît dès
qu'ils la lâchent. Dans une table commune, le nettoyage des documents
buterait sur les clés du journal des schémas — donc ne s'exécuterait jamais,
en silence. Deux durées de vie, deux tables.

⚠️ Une collision d'empreintes entre les deux est donc sans effet : les mêmes
octets dans deux tables sont deux lignes, et rien ne les confond.

**L'empreinte d'un document et celle d'un schéma partagent le tag**, et le même
fichier : les deux sont SHA-256 sur la même forme canonique, donc elles
s'incrémentent ensemble. Ce qui les distingue est le **périmètre**, qui est du
domaine — la raison pour laquelle ni l'une ni l'autre ne vit dans
`normalise.ts`.

**Publier est le moment des deux vérifications** — complétude des champs
([ADR 0017](0017-validation-a-l-ecriture-seulement.md), raffiné en même temps
que cette décision) et clôture des références
([ADR 0021](0021-ensemble-publie-clos-par-reference.md)) — les deux refus
nommant ce qui manque. Un seul moment, deux portes, mêmes manières. C'est aussi
là que la synchronisation de l'index de références contre le graphe **publié**
a sa place ([ADR 0020](0020-references-entre-documents.md)).

**Le badge de liste est une comparaison de deux champs**, exactement comme la
divergence de bibliothèque. Le même modèle mental partout : deux pointeurs
comparés = un état.
