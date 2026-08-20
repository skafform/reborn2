# Cache

Pour un CMS headless, l'API de livraison **est** essentiellement un CDN. Le
cache n'est pas une optimisation tardive : il oriente la conception de la
couche de lecture, et deux de ses contraintes sont coûteuses à ajouter après
coup.

Rien n'est à construire au MVP — mais deux coutures sont à poser, et une règle
de sécurité à respecter dès la première ligne.

## L'invalidation consomme le flux d'événements déjà prévu

La purge de cache est le **troisième consommateur** du point d'émission décrit
dans [audit.md](./audit.md), après le journal d'audit et les webhooks.

C'est l'approche recommandée par Sanity — une invalidation précise, pilotée
par les événements, avec des purges ciblées quand un document change — et
c'est ce que fait Contentful, dont les webhooks déclenchent l'invalidation.

**Aucune couture supplémentaire n'est nécessaire de ce côté.**

## 🔴 Couture — l'API de livraison reste adressable par URL

Les CDN indexent leur cache **sur l'URL, paramètres de requête inclus**. Les
requêtes **POST ne sont pas mises en cache** — Sanity ne cache ni les requêtes
POST ni les datasets privés.

**Contrainte à respecter** : l'évolution mentionnée dans [api.md](./api.md)
(« vers un langage de requête dédié ») doit rester en **GET avec paramètres
d'URL**. Une API de lecture avec un corps de requête POST — façon GROQ ou
GraphQL — **supprime toute possibilité de cache CDN**.

## 🔴 Couture — savoir quels documents composent une réponse

Purger par joker (« tout ce qui commence par `/projet-x/` ») revient à vider le
cache entier à chaque publication : le CDN ne sert alors plus à rien. Sanity
recommande d'associer les identifiants de documents aux chemins d'URL et de
**purger par tag ou par clé**.

Cela suppose d'étiqueter chaque réponse avec les documents qu'elle contient
(`Surrogate-Key` chez Fastly, `Cache-Tag` chez Cloudflare).

**Couture** : le chemin de lecture doit **savoir quels documents ont composé
sa réponse**, pas seulement renvoyer des lignes. C'est le pendant, côté
lecture, du point d'émission côté écriture — et il est tout aussi coûteux à
ajouter après coup, puisqu'il faudrait retoucher chaque endpoint de lecture.

## 🟠 Règle de sécurité — les brouillons ne sont jamais mis en cache

Les réponses servies avec la clé **preview** ou la clé **secrète** contiennent
des brouillons. Elles ne doivent jamais être mises en cache sur une
infrastructure partagée : `Cache-Control: private, no-store`.

Seules les réponses de la **clé publique** (contenu publié uniquement, voir
[api.md](./api.md)) sont cachables à l'edge.

## Le piège de propagation, à connaître

Documenté par Sanity : le webhook part **avant** que la propagation à l'edge
soit terminée. Le système revalide, lit le CDN, y trouve encore l'ancienne
valeur — et **la remet en cache**. Le contenu périmé survit ainsi à sa propre
invalidation.

Parade : pendant une revalidation, lire l'**origine**, jamais le cache.

## Cache applicatif, distinct du CDN

À ne pas confondre avec le cache d'edge : la résolution
clé API → environnement → projet est sur le **chemin chaud** de chaque requête
publique (voir [environments.md](./environments.md)). Elle relève d'un cache
applicatif (mémoire ou Redis), pas du CDN.

## Ce que font les leaders

| | Infrastructure | Stratégie |
|---|---|---|
| **Contentful** | Fastly pour le JSON, CloudFront pour les médias | Purge quasi instantanée après publication, déclenchée par webhook. Options avancées : *stale-while-revalidate* pendant la minute suivant une publication, *stale-when-rate-limited* en cas de 429 |
| **Sanity** | `apicdn.sanity.io` | *Stale-while-revalidate* sur une fenêtre de 600 s. Cache indexé sur l'URL complète. Ni POST ni datasets privés |

## Sources

- [Advanced caching | Contentful Docs](https://www.contentful.com/developers/docs/platform/advanced-caching/)
- [API CDN | Sanity Docs](https://www.sanity.io/docs/content-lake/api-cdn)
- [Caching strategies and CDN integration for Enterprise CMS at scale](https://www.enterprisecms.org/guides/caching-strategies-and-cdn-integration-for-enterprise-cms-at-scale)
