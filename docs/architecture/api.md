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

### Comment la console dérive son client — **fait**

La console déclarait ses types **à la main** : exactement l'alternative que
l'[ADR 0005](../adr/0005-depots-separes-contrat-openapi.md) écarte comme
« dérive garantie à moyen terme ». Elle avait déjà commencé — `Member` comptait
cinq champs quand le serveur en envoyait six.

Les schémas sont désormais **générés** depuis le contrat, et les types s'en
déduisent par `z.infer`. Plus une seule forme de réponse écrite à la main dans
la console.

**Ce qu'on ne peut pas avoir**, et qui rend le reste inutile de discuter : le
serveur ne peut **pas** mentir sur ce qu'il envoie. `@hono/zod-openapi`
contraint le retour de chaque handler à ce que sa route déclare — vérifié en
cassant volontairement un handler, le typecheck refuse. La spec dit donc la
vérité, ce que la plupart des équipes ne peuvent pas affirmer.

#### La chaîne

Le serveur ne fabrique pas le fichier de la console : il **publie une
description**, qu'un outil transforme.

```
Zod (routes du backend)
   ↓   @hono/zod-openapi — automatique, à chaque démarrage
GET /openapi.json
   ↓   Orval — une commande, lancée par un développeur
console/app/lib/openapi.json      (la spec, commitée)
console/app/lib/api-schemas.ts    (schémas Zod, commités)
```

⚠️ **Par HTTP, jamais par un chemin de fichier** vers `backend/`. C'est ce que
la console verrait si le backend tournait ailleurs, et c'est ce qui garde la
séparation vraie.

#### Les cinq étapes

**1. Décrire les trois routes muettes** — ✅ *fait*

`GET /organizations/{id}/invitations`, `POST /invitations/{token}/accept` et
`POST /inbox/{id}/accept` renvoyaient `z.any()`, donc `zod.unknown()` une fois
générées : aucune protection, là où la console s'en sert le plus. Elles ont
désormais leurs schémas (`PendingInvitation`, `AcceptedInvitation`).

⚠️ **Aucune route ne doit renvoyer `z.any()`.** Ce n'est plus seulement une
imprécision de documentation : c'est un trou dans la validation de la console.

**2. Générer** — ✅ *fait*

Orval en dépendance **de développement**, et une commande `pnpm api:sync` qui
récupère la spec et écrit les deux fichiers. Configuration : `version: 4`,
`variant: "mini"`, et ⚠️ **sans `strict`** (voir le piège plus bas).

**3. Supprimer les types écrits à la main** — ✅ *fait*

`type Member = z.infer<typeof MemberSchema>` dans chaque écran. Plus une seule
forme recopiée : c'est la recopie qui dérive, pas l'emplacement du fichier.

**4. Valider dans `api()`** — ✅ *fait*

Chaque réponse passe par son schéma avant d'être rendue, avec
`z.config(en())` — Zod Mini ne charge aucune locale, et sans elle tous les
messages se réduisent à `Invalid input` (le `path` reste néanmoins présent).

**5. Vérifier en CI** — ⏳ *reste à faire : il n'existe aucune CI aujourd'hui*

Régénérer, puis `git diff --exit-code`. La génération étant déterministe, un
écart signifie que quelqu'un a oublié `api:sync` — la PR échoue, et le `diff`
montre le champ en cause. La CI compare **deux fichiers commités**, donc ne
démarre ni backend ni base ; c'est pour ça que la spec est commitée, et pas
seulement les schémas.

⚠️ La CI **constate, elle ne corrige pas**. Un fichier régénéré à l'insu de
l'auteur apparaîtrait dans ses commits sans qu'il l'ait relu.

#### Ce que chaque pièce ferme

| Pièce | Ferme | Quand |
|---|---|---|
| Génération (2 + 3) | la recopie à la main | à la compilation |
| Validation (4) | la donnée reçue qui ne correspond pas | à l'exécution de l'écran |
| CI (5) | l'oubli de régénérer | dans la PR |

Les trois sont nécessaires : la CI ignore tout du backend réel, la validation
n'a lieu que sur les écrans ouverts, et sans génération il n'y a rien à
comparer ni à valider.

**Pourquoi valider et pas seulement typer.** Les types disparaissent à la
compilation. La validation confronte la donnée réelle — elle attrape donc aussi
le backend déployé plus récent que la console, et l'onglet resté ouvert pendant
un redéploiement. Aucune vérification à la compilation ne peut rien contre ces
deux-là.

⚠️ **`strict: { response: true }` est un piège.** Il paraît plus sûr :

| Le serveur… | avec `strict` | sans |
|---|---|---|
| **ajoute** un champ | ❌ refusé | ✅ accepté |
| **renomme** un champ | ✅ refusé | ✅ refusé |
| **change le type** d'un champ | ✅ refusé | ✅ refusé |

Il ferait casser la console sur un ajout de champ — rétrocompatible, et que la
console n'utilise même pas. Éprouvé sur la vraie spec ; aucune documentation ne
le mentionne.

⚠️ **Corollaire à assumer** : ça transforme une dégradation discrète en panne
visible. `api()` doit traiter l'échec de validation proprement — un message,
jamais un écran blanc.

#### Ce que ça ne ferme pas

1. **Les chemins** — `api("…/membres")` compilerait toujours
2. **Les corps de requête** — rien ne vérifie ce qu'on envoie
3. **Les écrans jamais ouverts** — la validation ne se déclenche que sur ce qui
   s'exécute

Un client Orval complet fermerait les deux premiers, au prix d'une réécriture
de tous les appels. Écarté : le chemin mal tapé n'a jamais causé de problème
ici, alors que la dérive des types, elle, s'est déjà produite.

#### Écarté, et pourquoi

**Importer les types du backend** (`import type { Member } from "../../backend/…"`).
Supprimerait la dérive d'un coup, sans outillage. Mais la console ne pourrait
plus se construire sans l'**arbre source** du backend — un couplage de build
réel, contraire à « deux serveurs distincts ». Et ça ne dispenserait **pas** de
Zod : le typage ne protège pas de l'onglet resté ouvert pendant un
redéploiement.

**Stocker la spec en base.** Elle n'est pas une donnée : c'est un dérivé du
code, recalculé à chaque démarrage. Une table serait une seconde copie,
susceptible de mentir si quelqu'un déploie sans la réécrire — le problème
qu'on élimine, réintroduit un cran plus loin. Pour de l'historique, un fichier
versionné dans git suffit.

**Un numéro de version comparé au démarrage** (le modèle d'une application
précédente). Il faut penser à l'incrémenter : le même oubli, remonté d'un cran.
Une empreinte de contenu ne s'oublie pas — mais la validation Zod fait mieux
encore, en nommant le champ plutôt qu'en signalant que « la copie date ».

Le détail de la recherche, la démonstration de la dérive et les essais :
[../research/derive-du-contrat-console-api.md](../research/derive-du-contrat-console-api.md).
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
