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

Les **corps envoyés** passent par le même contrat, dans l'autre sens :
`postJson(chemin, schémaDuCorps, corps, schémaDeRéponse)`. Le typage y fait
l'essentiel — le corps est typé **par son schéma**, donc un champ renommé côté
serveur casse le typecheck de la console dès le prochain `api:sync`. La
validation ajoute ce que le type ne voit pas : `String(form.get("email"))` est
un `string` quoi qu'il contienne.

⚠️ **Un corps refusé s'affiche, une réponse hors contrat non.** Le premier cas
atteignable est une saisie que le navigateur a laissée passer — un bandeau.
Le second est un défaut à corriger, qui doit rester bruyant. `displayableError`
est le seul endroit qui tranche entre les deux.

**5. Vérifier en CI** — ✅ *fait* — [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

Relancer `api:sync`, puis `git diff --exit-code` sur les deux fichiers générés.
La génération étant déterministe, un écart signifie que quelqu'un a changé
l'API sans synchroniser — la PR échoue, et le `diff` montre le champ en cause.

⚠️ **Régénérer depuis la spec commitée ne suffirait pas.** Ça n'attraperait
qu'un `api-schemas.ts` édité à la main, ou une spec modifiée sans relancer
Orval. L'oubli d'`api:sync` — le cas pour lequel cette étape existe — passerait
au vert : `openapi.json` resterait périmé, Orval en régénérerait des schémas
identiques, et le `diff` serait propre.

La CI obtient donc la spec **du backend en marche**, par HTTP, comme le ferait
n'importe quel client. Ce n'est pas une rigueur gratuite :
l'[ADR 0005](../adr/0005-depots-separes-contrat-openapi.md) interdit nommément
le raccourci par chemin de fichier, spec comprise.

Conséquence assumée : le contrôle a besoin d'une base, puisque le serveur
refuse de démarrer sans elle. Elle est de toute façon nécessaire — les tests du
backend exercent RLS. Les deux vivent donc dans le même job, plutôt que
d'amorcer deux fois la même base. Effet de bord utile : `db:bootstrap` tourne à
chaque exécution, ce qui est la seule preuve automatique que le provisionnement
d'un environnement neuf fonctionne encore ([backlog 0007](../backlog/0007-amorcage-et-verification-db.md)).

**Éprouvé dans les deux sens** — la propriété qui compte n'est pas seulement
qu'un écart soit vu, c'est qu'une absence d'écart le reste :

| Situation | Résultat |
|---|---|
| Backend inchangé | `api:sync` réécrit les deux fichiers **à l'identique** — vert |
| `max(200)` → `max(150)` sur un corps de requête | échec, `diff` sur `maxLength` et `postApiOrganizationsBodyNameMax` |

Le second cas est délibérément choisi discret : une borne de validation
resserrée côté serveur, que personne ne verrait en revue.

⚠️ La CI **constate, elle ne corrige pas**. Un fichier régénéré à l'insu de
l'auteur apparaîtrait dans ses commits sans qu'il l'ait relu.

⚠️ Le `diff` est **limité aux deux fichiers générés**. Ce que `pnpm format`
aurait pu toucher par ailleurs regarde le lint, pas la dérive de contrat.

#### Ce que chaque pièce ferme

| Pièce | Ferme | Quand |
|---|---|---|
| Génération (2 + 3) | la recopie à la main | à la compilation |
| Typage du corps (4) | le champ renommé à l'envoi | à la compilation |
| Validation (4) | la donnée reçue ou envoyée qui ne correspond pas | à l'exécution de l'écran |
| CI (5) | l'oubli de régénérer | dans la PR |

Toutes sont nécessaires : la CI ignore tout du backend réel, la validation
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
2. **Les écrans jamais ouverts** — la validation ne se déclenche que sur ce qui
   s'exécute, et **la console n'a aucun test** : « exécuté » veut dire ouvert à
   la main dans un navigateur

Un client Orval complet fermerait le premier, au prix d'une réécriture de tous
les appels. Écarté : le chemin mal tapé n'a jamais causé de problème ici, alors
que la dérive des types, elle, s'est déjà produite — et un chemin faux échoue
en 404 tout de suite, bruyamment, jamais en silence.

Le second ne se ferme que par des tests de console. C'est une décision à part
entière, pas un morceau de cette chaîne.

**Les corps de requête y étaient**, et n'y sont plus : Orval générait déjà les
trois schémas de corps, ils dormaient inutilisés. Les brancher a coûté un
paramètre sur `postJson` et trois alias.

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

## Schémas et bibliothèque

Deux familles d'adresses, et la différence entre elles **est** la décision
d'[ADR 0018](../adr/0018-bibliotheque-de-schemas-table-separee.md) :

| | |
|---|---|
| `…/projects/{pid}/schemas` | Les types de contenu — sous un **projet** |
| `/organizations/{id}/library` | La bibliothèque — sous l'**organization**, sans projet |

⚠️ **Le mot « environnement » n'apparaît nulle part**, comme pour les clés API.
Le chemin nomme un projet, le serveur résout `master`
([environments.md](./environments.md)). Une entrée de bibliothèque, elle, n'a
tout simplement pas d'environnement : elle appartient à l'organization seule, et
l'adresse doit le dire.

Chacune porte les mêmes deux routes de lignée : `…/{id}/history` rend le journal
du plus récent au plus ancien, `…/{id}/restore` déplace le pointeur.

**Aucune permission n'a été ajoutée pour la lignée.** Lire un historique est une
lecture de schéma, restaurer en est une écriture — une fonctionnalité entière
est arrivée sans que le vocabulaire bouge. Seule la **curation** de la
bibliothèque a sa clé, `library.write` ; la **lire** reste `schema.read`.

### ⚠️ Le contrat ne grave pas l'algorithme de hachage

Une empreinte est validée comme `^[a-z0-9-]+:[0-9a-f]{64}$` — « un tag, puis un
condensé hexadécimal », **sans dire lequel**.

Écrire `sha256-1` dans la spec obligerait à republier le contrat le jour du
changement de tag — or ce tag existe précisément pour pouvoir changer
([ADR 0016](../adr/0016-versionnage-des-schemas-adresse-par-contenu.md)). La
borne reste réelle : elle refuse une chaîne arbitraire avant qu'elle atteigne
le service, et un test l'épingle en 400.

### `currentHash` voyage avec ce qu'il désigne

`GET …/history` rend `{ currentHash, entries }`, et une ligne de bibliothèque
porte son `currentHash`. Sans lui, un écran ne saurait pas quelle entrée est
l'état courant — et proposerait de restaurer celui où l'on est déjà.

## Clés API

Trois **types** de clés, et autant de clés qu'on veut de chaque type — chacune
portant un nom.

⚠️ Ce document a d'abord annoncé « 3 clés fixes par projet, un seul triplet ».
C'était une simplification de MVP, corrigée ici : elle empêche la **rotation
sans coupure**, qui est l'usage principal d'une clé après sa création.

Avec un seul emplacement par type, remplacer une clé impose de révoquer puis de
créer — et entre les deux le site est cassé : l'ancienne ne répond plus, la
nouvelle n'est pas encore déployée. Avec une liste, l'ordre s'inverse : créer,
déployer, vérifier, **puis** révoquer. Le second bénéfice suit — une clé par
consommateur (site, application, CI), donc une fuite se révoque sans casser les
autres.

C'est aussi ce que font Contentful et Sanity, et ce que le code faisait déjà :
`api_keys` porte une colonne `name` et aucune contrainte d'unicité sur
`(environment_id, kind)`. Imposer le triplet aurait coûté **plus** cher — un
index unique partiel — pas moins ; et sans lui la règle n'aurait vécu que dans
la console, ce que ce projet refuse.

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
n'a pas compté.

**Deux natures, un seul calendrier.** Contentful et Sanity mesurent les mêmes
choses, et le partage est net :

| Mesure | Nature | Ce qu'il faut |
|---|---|---|
| Requêtes, octets sortis | **flux** — non compté = perdu à jamais | un compteur durable |
| Documents, projets, assets | **état** — recalculable | une requête, une fois par mois |

⚠️ **Une requête en échec ne compte pas.** Sanity exclut les réponses `4xx` et
`5xx` ainsi que les `OPTIONS` — ce n'est pas un détail de facturation : le
compteur se branche **après** avoir connu le statut, pas à l'entrée.

⚠️ **Les mesures d'état sont des instantanés de fin de mois**, pas des
moyennes. Aucun historique à tenir.

**Le grain est la clé**, pas l'organization : une clé résout vers un
environnement → un projet → une organization, donc compter au plus fin donne
les trois vues. L'agrégation monte, elle ne descend pas.

⚠️ **L'écriture est le point coûteux** : un compteur par requête transforme
chaque lecture — l'opération qu'on veut la moins chère — en lecture *plus*
écriture. Un `UPSERT` sur la ligne (clé, jour), **hors de la transaction de
lecture et après la réponse** : un échec de comptage ne doit jamais faire
échouer une lecture.

À construire à l'**étape 7**, avec l'API de livraison — le seul endroit à fort
volume. Détail et sources :
[../research/comptage-de-l-usage.md](../research/comptage-de-l-usage.md).

### Où on les gère

`GET`/`POST /organizations/{id}/projects/{projectId}/api-keys`, et
`POST …/api-keys/{keyId}/revoke` puis `DELETE …/api-keys/{keyId}`.

**Adressées par projet, pas par environnement**, alors qu'une clé appartient à
un environnement ([ADR 0013](../adr/0013-cles-api-rattachees-a-un-environnement.md)).
Le serveur résout `master` lui-même : c'est le seul qui existe, et aucun écran
ne prononce le mot ([environments.md](./environments.md)). Exposer
`environmentId` obligerait la console à trouver une valeur qu'elle ne saurait
expliquer à personne.

Le jour où les environnements deviennent réels, un sélecteur apparaît et
l'adresse s'allonge en `…/projects/{pid}/environments/{eid}/api-keys` ;
l'actuelle en devient le raccourci vers `master`. C'est bon marché **parce que
la clé porte déjà son `environment_id`** — c'est exactement ce que l'ADR 0013
achetait.

L'écran range les clés en **trois sections**, une par type, chacune avec sa
propre action (`+ New public key`, etc.). Le type n'est donc jamais un champ à
remplir : il est déterminé par l'endroit où l'on clique.

⚠️ **Pas de lecture seule sur cette page.** `listApiKeys` exige `apikey.manage`,
et c'est juste : les clés publique et preview sont stockées **en clair**, donc
les voir c'est les avoir. La section est tout ou rien — sans la permission,
l'entrée de barre latérale n'apparaît pas et la route refuse. Aujourd'hui seuls
`owner` et `admin` la détiennent ; aucun rôle de projet.

### Révocation & suppression

- Une clé peut être **révoquée** (elle cesse immédiatement de fonctionner,
  mais son enregistrement subsiste — le journal d'audit continue de référencer
  son id)
- Une clé peut ensuite être **supprimée**
- **La suppression d'une clé encore active est interdite** : il faut d'abord
  la révoquer. Cela évite qu'une clé disparaisse du système sans qu'on sache
  si elle était encore en circulation, et préserve la traçabilité

Une clé révoquée **reste donc dans la liste**, inactive, jusqu'à ce qu'on la
supprime. L'écran doit la montrer comme telle plutôt que de la faire
disparaître : c'est la trace de ce qui a circulé.

Le **nom est obligatoire**. Sans lui, révoquer devient aveugle — on ne saurait
pas laquelle des trois clés publiques est celle du site qu'on veut couper.

⏳ **Pas de colonne « dernière utilisation »** pour l'instant. `last_used_at`
existe en base, mais rien ne l'écrit tant qu'aucune route ne s'authentifie par
clé. Une colonne qui ne peut dire qu'une seule chose est du bruit ; elle
apparaîtra avec l'API de livraison (étape 7).
