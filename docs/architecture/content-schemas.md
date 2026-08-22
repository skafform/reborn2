# Schémas dynamiques & documents

## Schémas dynamiques

- Table `schemas` : stocke la définition des types de contenu (champs, types,
  règles de validation) en JSONB, créée/éditée via l'admin UI par l'utilisateur
  final — pas besoin de toucher au code pour ajouter un type de contenu
- Table `documents` générique :

  ```
  id, environment_id, schema_id, status, data (JSONB), created_at, updated_at,
  locale, translation_group_id
  ```

  - `environment_id` plutôt que `project_id` — voir
    [environments.md](./environments.md)
  - `locale` et `translation_group_id` : couture pour le multilingue,
    ignorées tant qu'il n'y a qu'une langue — voir
    [localisation.md](./localisation.md)

- La validation d'un document se fait côté API via un schéma Zod généré
  dynamiquement à partir de la définition stockée dans `schemas`
- ⚠️ **À l'écriture seulement, jamais à la lecture**
  ([ADR 0017](../adr/0017-validation-a-l-ecriture-seulement.md)) — une lecture
  rend ce qui est stocké

## Le schéma vit en base, pas dans le code

Choix structurant, aligné sur **Contentful** et non sur Sanity.

Chez Sanity, le schéma est un fichier de code dans le dépôt du Studio ; la
base est *schemaless* et ne valide rien (la validation se fait côté client, à
la saisie). Chez Contentful — et chez nous — le schéma est une donnée en base,
rattachée à l'environnement, et la plateforme valide contre lui.

**Pourquoi ce choix** : l'objectif produit est qu'un `admin` crée un type de
contenu depuis un formulaire, sans développeur ni déploiement. Le modèle
Sanity exige les deux. Avantage supplémentaire : notre validation étant à
l'API, elle est autoritaire — chez Sanity, un script mal écrit peut insérer du
contenu non conforme sans que rien ne l'arrête.

**Le prix à payer** : en mettant le schéma dans le code, Sanity obtient
gratuitement l'historique des changements, la revue de code, le retour en
arrière (`git revert`) et les branches. Nos schémas vivant dans une table, rien
de tout cela n'existe par défaut. C'est ce trou que comble le versionnage
adressé par contenu, décrit plus bas.

## Versionnage : l'identité d'une version est son contenu

Décidé par [ADR 0016](../adr/0016-versionnage-des-schemas-adresse-par-contenu.md),
qui porte le raisonnement complet. Ce qu'il faut en retenir ici :

| Table | Nature |
|---|---|
| `schema_versions` | Contenu immuable, dédupliqué. Clé `(organization_id, hash)` |
| `schema_history` | Journal par schéma, en ajout seul |

`schemas.current_hash` désigne la version courante. Enregistrer une définition
au hachage déjà courant est un **no-op**. Restaurer, c'est **déplacer le
pointeur** et ajouter une ligne d'historique — jamais réécrire le journal.

⚠️ **Trois choses qui se perdent facilement**, et qui sont chacune un piège
plutôt qu'un détail :

1. La lignée vit dans le journal, **jamais** en `parent_hash` sur la version —
   une ligne partagée par deux schémas mêlerait deux lignées
2. La déduplication est **par organization**, jamais globale — sinon le
   `created_at` d'une ligne partagée révèle qu'une autre organization détient
   le même schéma, et une table globale échapperait à RLS
3. Le hachage porte un **tag d'algorithme** (`sha256-1:`) — geler la
   normalisation sans lui est une décision qui ne peut être fausse qu'une fois

### Ce qui entre dans l'empreinte

**Les trois : `name`, `label`, `definition`.** Ce document disait « sa
définition normalisée », ce qui laissait entendre le seul JSONB — c'était un
trou, et le combler n'est pas une préférence : les deux fonctions du
versionnage l'exigent chacune.

**La restauration.** Le motif fondateur est *« quelqu'un a cassé quelque chose
par erreur, on restaure l'état exact »*. Or `label` est le champ conçu pour
être modifié — il a été séparé de `name` exactement pour ça. Un versionnage qui
ne couvre pas le champ le plus édité protège le moins ce qui bouge le plus. Une
version qui ne peut pas restaurer le libellé n'est pas une version de l'état,
c'est une version d'un fragment.

**La divergence**, et c'est l'argument décisif. Le diagnostic à trois états lit
l'égalité de hachage comme « identique ». Une copie de bibliothèque dont
l'agence a localisé un libellé — `"Author"` devenu `"Auteur"`, le geste le plus
banal qui soit — se lirait « identique » avec la définition seule. Un
instrument aveugle à la personnalisation légitime la plus courante est faussé
dès la première mesure.

⚠️ **Ne pas confondre deux questions.** `definition.ts` porte le commentaire
« ce schéma est hachable » : il parle de la **forme** d'une définition — pas de
`Date`, pas de trou de tableau, pas deux écritures pour un sens — jamais du
**périmètre** d'une version. Le commentaire répond à la première question ; ce
paragraphe-ci répond à la seconde.

### Où ça vit, et ce que le tag versionne

| Fichier | Rôle |
|---|---|
| `src/cms/normalise.ts` | La forme canonique, **RFC 8785 (JCS)**. Générique, gelée, ignorante du CMS |
| `src/cms/fingerprint.ts` | Le périmètre, la canonisation du libellé, le condensé et son tag |

⚠️ **`label` est ramené à `null` dans `fingerprint.ts`, jamais dans
`normalise.ts`.** L'API dit `string | undefined`, la colonne dit
`string | null` : deux écritures d'un sens, donc deux empreintes si l'une ne
l'emporte pas avant le hachage. Et « un libellé absent vaut `null` » est une
connaissance du domaine schéma — l'apprendre à la forme canonique est
exactement ce qui la rendrait particulière.

⚠️ **Le tag `-1` versionne les deux ensemble.** Il ne nomme pas SHA-256, il
nomme SHA-256 **et** la forme canonique. Si l'un ou l'autre change de sens,
c'est le même incrément. Les deux fichiers sont séparés pour garder
`normalise.ts` générique ; ce qui les tient d'accord n'est pas la cohabitation
mais les **vecteurs littéraux** de `fingerprint.test.ts` — une entrée écrite en
clair, un condensé écrit en clair, vérifiables hors du code :

```
printf '%s' '{"definition":{"fields":[]},"label":null,"name":"article"}' | sha256sum
```

Un vecteur qui rougit est un **changement de format**, donc un nouveau tag —
jamais une attente corrigée.

### Ce que le modèle rend structurel

Chaque invariant conçu est devenu une contrainte, pas une discipline :

| Invariant | Ce qui le tient |
|---|---|
| Le courant pointe toujours sur une version réelle | `schemas.current_hash` **`NOT NULL`** + clé étrangère composite vers `schema_versions` |
| L'historique ne nomme jamais une version fantôme | Clé étrangère composite `(organization_id, hash)` sur le journal |
| L'identité est le contenu | **Pas d'`id`** sur `schema_versions` : la clé primaire est `(organization_id, hash)` |
| Rien ne traverse deux cadrages | `schemas (id, organization_id)` en unicité, cible de la clé du journal |

⚠️ **Les deux tables n'ont que des policies `SELECT` et `INSERT`.** Une version
est immuable, un journal est en ajout seul — l'absence de policy `UPDATE` ou
`DELETE` le rend vrai plutôt que promis. La cascade fonctionne quand même :
l'intégrité référentielle contourne RLS, et c'est **vérifié par un test**, pas
supposé.

⚠️ **`seq`, une colonne d'identité, porte l'ordre du journal** — pas
`created_at`, qui vaut `now()`, l'horodatage de *début de transaction* que deux
enregistrements concurrents peuvent partager. Elle n'est **jamais renvoyée** :
une séquence globale dirait le volume d'écriture de la plateforme.

### Trois conséquences à connaître

**Restaurer, c'est remettre un état que *ce* schéma a eu.** Les versions étant
dédupliquées par organization, une empreinte peut exister sans avoir jamais
appartenu au schéma visé ; y aller serait une **affectation**, pas une
restauration. Le service exige donc que le journal du schéma la nomme. Copier
le modèle d'un autre est le rôle de la bibliothèque, avec sa propre notion de
copie.

⚠️ **Le nom fait partie de la version**, donc une restauration peut être
refusée en 409 : un schéma créé entre-temps sous l'ancien nom occupe la place.

**Le journal enregistre les changements d'état, pas les gestes.** Enregistrer
une définition inchangée est un **no-op complet** — ni version, ni ligne, ni
déplacement, et `updated_at` ne bouge pas. Quelqu'un qui clique « enregistrer »
sans rien modifier ne laisse aucune trace dans la lignée. C'est voulu : un
journal de gestes vides est du bruit, et la trace du geste appartient au
journal d'audit ([ADR 0008](../adr/0008-point-d-emission-d-evenements-unique.md)).

**Les versions survivent à leur schéma.** Supprimer un schéma emporte son
journal en cascade, jamais ses versions : elles sont du contenu partagé par
l'organization, et un autre schéma peut pointer sur la même ligne. C'est ce que
Git fait de ses blobs.

### L'acteur, et pourquoi il recoupe l'audit

`schema_history` porte `actor_user_id`, ce qui recoupe le journal d'audit. Le
recoupement est **assumé** : l'historique répond « quel état, dans quel ordre »,
l'audit « qui a fait quoi » — mais un écran de lignée incapable de dire qui a
restauré est inutilisable, et une jointure applicative vers l'audit par ligne
d'écran paierait la pureté conceptuelle en complexité réelle. C'est de la
dénormalisation d'usage, pas une duplication de responsabilité.

`ON DELETE SET NULL` : l'histoire survit aux comptes. ⚠️ **L'écran doit donc
afficher « utilisateur supprimé » plutôt qu'un blanc** — sinon le `SET NULL`
ressemblera à un bug la première fois qu'il servira.

## Bibliothèque de schémas de l'organization

Une organization tient une bibliothèque de schémas que ses projets copient.
`library_schemas` est une **table à part**, cadrée par `organization_id`
([ADR 0018](../adr/0018-bibliotheque-de-schemas-table-separee.md)) — et non un
`environment_id` nullable, qu'une policy *fail-closed* rendrait invisible.

- L'opération est **copier dans un environnement cible**, jamais « dans un
  projet » : un projet ne contient pas de schéma
- La copie est indépendante ensuite. Elle porte `copied_from`, une clé
  étrangère composite `(organization_id, copied_from)` — le seul lien du modèle
  qui traverse deux niveaux de cadrage
- La divergence se lit par **comparaison de hachages**, en trois états, sans
  moteur de diff. ⚠️ Le troisième, `locally_modified`, confond « seule la copie
  a bougé » et « les deux ont bougé »

## Permissions

- **Créer/modifier un schéma** : `owner`/`admin` (organization) uniquement —
  volontairement exclu pour `editor`, même s'il peut être une personne
  externe au projet, car une modification de schéma peut casser des
  documents existants (changement structurel, pas juste du contenu)
- **Éditer la bibliothèque** : `library.write`, une clé **distincte** de
  `schema.write`, aux mêmes détenteurs par défaut (`owner`, `admin`). Distincte
  parce que ce défaut sera probablement revisité, et que le restreindre doit
  rester un ajustement de rôle ([ADR 0018](../adr/0018-bibliotheque-de-schemas-table-separee.md))
- **Créer/modifier du contenu (brouillon)** : `owner`/`admin`/`editor`/
  `contributor`
- **Publier** (`draft` → `published`) : `owner`/`admin`/`editor` —
  `contributor` ne peut pas publier

Voir [roles-permissions.md](./roles-permissions.md) pour la définition
complète des rôles.

## Draft / publish

- Champ `status` (`draft` / `published`) sur les documents
- Évolution possible vers un système de versions/révisions plus complet dans une
  phase ultérieure

## Références entre documents — À TRANCHER

Permettre à un document d'en pointer un autre (un `Article` référence un
`Author`) plutôt que de dupliquer l'information : une seule source de vérité,
et modifier l'auteur met à jour tous les articles qui le référencent.

### Ce que fait Sanity (vérifié, août 2026)

- Le lien vit **dans le document** : `{"auteur": {"_ref": "id-du-document"}}`
- **Références fortes** (défaut) : intégrité référentielle appliquée —
  impossible de supprimer un document référencé par d'autres, l'API renvoie
  une erreur
- **Références faibles** (`weak: true`) : aucune contrainte, la cible peut
  disparaître
- La publication d'un document est **bloquée** tant qu'il référence un
  brouillon non publié — sauf si la référence est faible

### Les deux options

| Option | Description | Limite |
|---|---|---|
| **A** — inline seulement | Le `_ref` vit uniquement dans `documents.data` | Répondre à « qu'est-ce qui pointe vers ce document ? » impose de fouiller le JSON de tous les documents — or la question se pose à chaque suppression |
| **B** — inline + index dérivé | `data` reste la source de vérité, plus une table `document_references (from_document_id, to_document_id, field_path)` reconstruite à chaque écriture | Une table à maintenir, mais recalculée depuis `data` donc sans risque de divergence |

**Piste privilégiée : B.** L'index sert uniquement à répondre vite à
« qu'est-ce qui pointe ici ? » et « ai-je le droit de supprimer ? ».

### Règles qui en découleraient

1. **Portée** — une référence ne peut viser qu'un document du **même projet**
   (sinon l'isolation multi-tenant est percée), et du même environnement si
   la couture d'environnements est retenue
2. **Suppression bloquée** sur un document référencé — cohérent avec les
   règles déjà retenues ailleurs (révoquer une clé avant de la supprimer,
   vider une organization avant de la supprimer)
3. **Publication bloquée** si le document référence un brouillon non publié —
   *c'est la seule des trois qui mérite débat*

Sources : [Reference type | Sanity Docs](https://www.sanity.io/docs/studio/reference-type)
· [Connected Content | Sanity Docs](https://www.sanity.io/docs/studio/connected-content)

Voir [database.md](./database.md) pour l'emplacement de ces tables (gérées via
Drizzle) et [multi-tenant.md](./multi-tenant.md) pour l'isolation par projet.
