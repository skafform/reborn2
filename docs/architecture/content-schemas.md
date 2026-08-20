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
arrière (`git revert`) et les branches. Nos schémas vivant dans une table,
rien de tout cela n'existe par défaut — voir la décision ouverte sur le
versionnage des schémas dans
[decisions-ouvertes.md](./decisions-ouvertes.md).

## Permissions

- **Créer/modifier un schéma** : `owner`/`admin` (organization) uniquement —
  volontairement exclu pour `editor`, même s'il peut être une personne
  externe au projet, car une modification de schéma peut casser des
  documents existants (changement structurel, pas juste du contenu)
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
