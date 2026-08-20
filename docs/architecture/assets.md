# Assets

Gestion des fichiers (images, documents) référencés par le contenu. **Non
construit au MVP**, mais la couture centrale est profonde et doit être posée
dès le départ.

## 🔴 Couture — stockage adressable par contenu

**L'identifiant et l'URL d'un asset dérivent du hash de son contenu**
(SHA-256), pas d'un UUID aléatoire ni du nom de fichier.

C'est le mécanisme de Sanity, et il produit trois bénéfices en cascade :

- **Aucune invalidation de cache n'est jamais nécessaire** — un fichier
  modifié produit une URL différente ; les assets sont donc cachés
  indéfiniment (voir [cache.md](./cache.md))
- **Déduplication par contenu** — le même fichier envoyé deux fois renvoie le
  même asset, sans stockage supplémentaire. Deux `hero.jpg` d'octets
  différents restent deux assets distincts
- **URLs immuables**, donc partageables et cachables sans précaution

Retrofit coûteux : il faudrait re-hasher et déplacer chaque fichier stocké,
puis réécrire chaque URL dans le JSONB de tous les documents.

**Portée de la déduplication** : par projet. Une déduplication globale entre
organizations ouvrirait un canal auxiliaire — un envoi instantané révélerait
que quelqu'un d'autre possède déjà ce fichier.

## Transformations à la volée, jamais stockées

Un seul original conservé ; les variantes (redimensionnement, recadrage,
conversion de format) sont **dérivées à la demande par paramètres d'URL** et
cachées à l'edge.

Stocker des variantes générées multiplierait le stockage et rendrait
impossible l'ajout d'un nouveau format plus tard — le jour où un format
d'image succède au WebP, les originaux suffisent.

Contentful le formule à l'envers, et c'est la même idée : **ne jamais ajouter
de paramètre anti-cache** à une URL d'image, cela annule le bénéfice du CDN.

## Envoi direct, en deux temps

Faire transiter un fichier volumineux par le serveur Hono est du gaspillage.
Le flux visé est celui de Contentful :

1. Envoi du fichier (idéalement **direct vers le stockage**, par URL
   pré-signée)
2. Association à un enregistrement d'asset
3. Traitement

**Couture** : un enregistrement d'asset doit pouvoir exister **avant** que les
octets arrivent — donc un état « en attente ». Contentful supprime
automatiquement les fichiers non associés après 24 h ; prévoir le même
nettoyage.

## Validations à l'envoi

Contentful recommande de valider explicitement plutôt que de laisser un
repli silencieux : rejeter au niveau applicatif les images trop grandes
(ils citent 4000 × 4000) plutôt que de découvrir après coup que les
transformations ne s'appliquent pas.

## Référence depuis un document

Un asset est référencé depuis `data` par le même mécanisme que les références
entre documents — voir
[content-schemas.md](./content-schemas.md#références-entre-documents--à-trancher).

## Sources

- [Assets | Sanity Docs](https://www.sanity.io/docs/content-lake/assets)
- [Asset CDN | Sanity Docs](https://www.sanity.io/docs/apis-and-sdks/asset-cdn)
- [Image transformations | Sanity Docs](https://www.sanity.io/docs/apis-and-sdks/image-urls)
- [Images API Overview | Contentful Docs](https://www.contentful.com/developers/docs/references/images-api/overview/)
- [Uploads | Contentful Docs](https://www.contentful.com/developers/docs/references/content-management-api/uploads/)
