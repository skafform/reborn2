# Couche API

- **API de gestion** : CRUD des schémas, des documents, des projets
- **API de lecture publique** : façon CDN Contentful, requêtes filtrées par type
  de contenu avec pagination (REST + query params pour commencer, évolution
  possible vers un langage de requête dédié — **qui devra rester en GET avec
  paramètres d'URL**, sous peine de perdre toute possibilité de cache CDN, voir
  [cache.md](./cache.md))

## Contrat d'API et typage client

L'admin UI vit dans un **dépôt séparé** (voir [overview.md](./overview.md)),
donc le mode RPC de Hono (`hc`, qui importe directement les types du serveur)
n'est pas praticable — il suppose un monorepo.

**Décision : OpenAPI**, via `@hono/zod-openapi`. Les schémas Zod déjà retenus
pour la validation servent aussi à générer la spec ; l'admin UI génère son
client typé à partir de cette spec. Bénéfice secondaire : la spec fait office
de documentation publique de l'API, dont un CMS a de toute façon besoin.

À décider **avant** d'écrire les routes : `@hono/zod-openapi` change la
signature de chaque route, l'ajouter après coup impose de réécrire toute la
couche de routing.

### Portée du typage : deux moitiés distinctes

| Moitié | Formes | Typage |
|---|---|---|
| **API de gestion** (organizations, projets, membres, invitations, clés, définitions de schémas) | Fixes, connues à la compilation | OpenAPI — couvre 100 % de ce que consomme l'admin UI |
| **API de livraison de contenu** (documents) | **Dynamiques** — dépendent des schémas créés par les utilisateurs, inexistants au moment de générer la spec | OpenAPI décrit seulement l'enveloppe (pagination, métadonnées, `data` en `unknown`) |

Le typage fin du contenu est un problème distinct, reporté : il se règle par
génération de types à partir des schémas d'un projet donné, façon Sanity
TypeGen. Il vise les frontends des clients, pas l'admin UI. Voir
[../research/comparaison-typage-cms.md](../research/comparaison-typage-cms.md)
pour la comparaison qui a mené à ce découpage.
- **Auth** :
  - Clés API par projet (header `Authorization`) — voir *Clés API* ci-dessous
  - Auth utilisateur (email/password via Better-Auth) pour l'admin UI — voir
    [auth.md](./auth.md)

## Clés API

Approche façon Contentful : 3 clés fixes par projet, MVP = un seul triplet
par projet (pas de clés multiples du même type pour le MVP — reporté à une
version future pour distinguer environnements/intégrations).

| Clé | Lecture | Écriture | Contenu visible |
|---|---|---|---|
| **Publique** (Delivery) | ✅ | ❌ | Publié seulement |
| **Preview** | ✅ | ❌ | Publié + brouillons |
| **Secrète** (Management) | ✅ | ✅ | Publié + brouillons, accès complet |

Ces capacités sont exprimées dans le **même catalogue de permissions** que les
rôles humains — voir [roles-permissions.md](./roles-permissions.md). Un seul
`can(acteur, permission, ressource)` sert les deux types d'acteurs. La clé
secrète dispose notamment de `schema.write`, nécessaire aux scripts de
migration.

- **Scope** : chaque clé est liée à un `environment_id` précis (donc à un seul
  projet, voir [environments.md](./environments.md)) — jamais à un utilisateur
  ni à toute une organization (contrairement au Content Management API de
  Contentful, dont les tokens héritent de tout ce que l'utilisateur peut
  atteindre à travers ses organizations/espaces — un risque de sécurité connu
  qu'on évite ici par design)
- **Clé publique** : conçue pour être utilisée directement par les sites
  consommateurs (SSR/build ou fetch client) — risque faible car lecture
  seule + contenu déjà destiné à être public. Rate limiting par clé prévu
  pour limiter l'abus/scraping (voir *Comptage de l'usage* ci-dessous)
- **Clé secrète** : lecture/écriture complète. Chaque écriture est
  journalisée (clé utilisée, action, horodatage) — voir
  [audit.md](./audit.md)
- Scopes d'écriture plus granulaires (ex: distinguer création/modification de
  suppression) : pas pour le MVP, à réévaluer si un besoin réel apparaît

### Stockage

| Clé | Stockage | Reconsultable |
|---|---|---|
| Publique | En clair | ✅ — destinée à être recopiée dans les sites consommateurs |
| Preview | En clair | ✅ |
| Secrète | **Hashée** | ❌ — affichée une seule fois à la création (façon token GitHub) |

La clé secrète étant la seule à donner un droit d'écriture, elle est la seule
hashée : si la base fuit, elle reste inutilisable. Les clés publique et
preview sont en lecture seule sur du contenu destiné à être diffusé, leur
exposition n'ouvre pas de droit d'écriture.

### Comptage de l'usage — couture pour les quotas

Le rate limiting par clé est prévu dès le MVP. La couture consiste à rendre ce
comptage **durable et agrégeable**, plutôt qu'une simple fenêtre glissante en
mémoire.

Raison : on ne facture pas — et on ne plafonne pas rétroactivement — ce qu'on
n'a pas compté. Le nombre de requêtes API est un compteur à forte volumétrie,
**impossible à reconstituer après coup**. Les autres mesures (nombre de
projets, d'environnements, de documents) se recomptent à tout moment par une
requête, donc aucune urgence les concernant.

Voir [evolutions-prevues.md](./evolutions-prevues.md).

### Révocation & suppression

- Une clé peut être **révoquée** (elle cesse immédiatement de fonctionner,
  mais son enregistrement subsiste — le journal d'audit continue de référencer
  son id)
- Une clé peut ensuite être **supprimée**
- **La suppression d'une clé encore active est interdite** : il faut d'abord
  la révoquer. Cela évite qu'une clé disparaisse du système sans qu'on sache
  si elle était encore en circulation, et préserve la traçabilité
