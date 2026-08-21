# Évolutions prévues

Fonctionnalités qu'on sait vouloir un jour, **non construites au MVP**. Pour
chacune : la couture posée dès maintenant pour que l'ajout n'impose aucun
retour en arrière.

Une couture n'est pas une fonctionnalité. Aucune de ces lignes ne demande
d'écrire de la logique métier aujourd'hui — seulement de placer une
indirection ou une discipline au bon endroit.

| Évolution | Profondeur de la couture | Couture posée |
|---|---|---|
| [Cache CDN](#cache-cdn) | 🔴 Profonde | Lecture adressable par URL + étiquetage des réponses |
| [Assets](#assets) | 🔴 Profonde | Stockage adressable par contenu (hash) |
| [Localisation](#localisation) | 🔴 Profonde | `locale` + `translation_group_id` sur `documents` |
| [Webhooks](#webhooks) | 🔴 Profonde | Point d'émission d'événements unique |
| [SSO d'entreprise](#sso-dentreprise) | 🟠 Moyenne | Portes d'entrée d'une organization non verrouillées |
| [Quotas / facturation](#quotas--facturation) | 🟠 Moyenne | Comptage de l'usage durable |
| [OAuth (Google, GitHub)](#oauth-google-github) | 🟠 Moyenne | Politique de liaison décidée, pas d'hypothèse « mot de passe » |
| [Environnements](#environnements) | 🟠 Moyenne | `environment_id` en place |
| [Extraction du socle](#extraction-du-socle) | 🟠 Moyenne | Répertoire `src/cms/` + règle d'import, au premier module de 6b |
| [2FA](#2fa) | 🟢 Nulle | Aucune |
| [Recherche plein texte](#recherche-plein-texte) | 🟢 Nulle | Aucune — mais dépend de la localisation |

## Cache CDN

Pour un CMS headless, l'API de livraison **est** essentiellement un CDN. Deux
coutures, coûteuses à ajouter après coup car elles touchent chaque endpoint de
lecture :

- **L'API de lecture reste adressable par URL** (GET + paramètres). Une
  évolution vers un langage de requête en POST supprimerait toute
  possibilité de cache CDN
- **Le chemin de lecture sait quels documents composent sa réponse**, pour
  pouvoir l'étiqueter et purger par tag plutôt que par joker

L'**invalidation**, elle, ne demande aucune couture supplémentaire : elle est
le troisième consommateur du point d'émission d'événements, après le journal
d'audit et les webhooks.

Détail, règles de sécurité et pièges connus : [cache.md](./cache.md).

## Assets

Fichiers (images, documents) référencés par le contenu.

**Couture** : l'identifiant et l'URL d'un asset dérivent du **hash de son
contenu**, pas d'un UUID aléatoire. Cela apporte d'un coup l'immuabilité des
URLs (donc aucune invalidation de cache), la déduplication par contenu, et des
URLs partageables sans précaution. Retrofit coûteux : re-hasher et déplacer
chaque fichier, puis réécrire chaque URL dans le JSONB de tous les documents.

Deux corollaires : un seul original conservé, les variantes dérivées à la
demande par paramètres d'URL ; et un enregistrement d'asset doit pouvoir
exister **avant** l'arrivée des octets, pour permettre l'envoi direct vers le
stockage.

Détail : [assets.md](./assets.md).

## Localisation

Contenu multilingue. Touche le modèle du document lui-même.

**Couture** : deux colonnes sur `documents` — `locale` (`"fr"` par défaut) et
`translation_group_id` (égal à `id` tant qu'il n'y a qu'une langue). Toute la
logique les ignore aujourd'hui.

Modèle retenu : une ligne par langue (structure **Sanity**), avec les
références visant le groupe de traduction plutôt qu'une ligne précise — ce qui
récupère l'indépendance des références à la langue, avantage natif de
**Contentful**.

Détail : [localisation.md](./localisation.md).

## Webhooks

Notifier un système externe quand du contenu change. Le coût n'est pas la
table `webhooks` — c'est **d'où partent les événements**.

**Couture** : toute écriture passe par un point d'émission unique, dont le
journal d'audit est le premier consommateur. Voir [audit.md](./audit.md).
Les webhooks deviennent alors un second consommateur, sans toucher un seul
handler.

À construire plus tard : tables `webhooks` et `webhook_deliveries`, signature
HMAC avec identifiant de clé (pour permettre la rotation avec période de
grâce), en-tête d'idempotence — la livraison est **au moins une fois**, donc
les doublons sont normaux et documentés comme tels chez Sanity — et relances
avec backoff.

## SSO d'entreprise

Plugin Better-Auth (SAML 2.0 + OIDC), configuration IdP par organization,
résolution par `organizationId` ou par domaine d'email vérifié.

**Couture** : ne jamais coder en dur que l'appartenance à une organization ne
peut naître que d'une invitation acceptée — le provisionnement à la volée du
SSO est une troisième porte d'entrée. Voir [auth.md](./auth.md).

## Quotas / facturation

**Couture** : rendre le comptage des requêtes API durable et agrégeable, et
non une simple fenêtre glissante en mémoire. On ne facture pas ce qu'on n'a
pas compté, et ce compteur ne se reconstitue pas après coup. Voir
[api.md](./api.md).

À construire plus tard : plan porté par l'organization, plafonds, tableau
d'usage.

## OAuth (Google, GitHub)

**Aucune couture de base de données** — la table `account` de Better-Auth
porte déjà plusieurs fournisseurs par utilisateur.

**Couture** : la politique de liaison de comptes (`disableImplicitLinking`)
est décidée dès maintenant car elle est pénible à changer une fois des comptes
liés ; et deux hypothèses ne doivent jamais être codées en dur — que
l'invitation implique un mot de passe, et que tout compte en possède un. Voir
[auth.md](./auth.md).

## Environnements

**Couture** : `schemas`, `documents` et `api_keys` pointent vers un
`environment_id` plutôt qu'un `project_id`, avec une table `environments`
contenant une seule ligne `master` par projet. Voir
[environments.md](./environments.md).

## Recherche plein texte

**Aucune couture nécessaire.** Postgres suffit : une colonne `tsvector`
générée sur `data` via `jsonb_to_tsvector`, plus un index GIN — ajoutables par
un `ALTER TABLE` à tout moment. Ni Algolia ni Elasticsearch pour démarrer.

Sa seule dépendance est la **localisation** : `to_tsvector` exige une
configuration linguistique, donc il faut connaître la langue d'un document
pour l'indexer correctement. Voir [recherche.md](./recherche.md) et
[localisation.md](./localisation.md).

## Extraction du socle

Le socle — authentification, multi-tenant, RBAC, invitations, adhésions, clés,
contrat — pourrait un jour servir à autre chose que ce CMS.

⚠️ **Il n'a jamais été conçu pour ça : il a émergé.** Chaque pièce existe parce
que Skafform en a eu besoin. C'est ce qui fait sa solidité — aucune abstraction
spéculative — mais ça veut dire qu'il n'est **pas prouvé réutilisable**, il en
a l'air. La seule preuve serait un second consommateur, et il n'existe pas.
Tant qu'il n'existe pas, « socle » est une hypothèse sur le code.

Le vocabulaire de CMS dans `config/permissions.ts` — `content.publish`,
`schema.write` — est le fossile de cette émergence : ces permissions sont là
parce qu'il fallait publier du contenu pendant la construction, pas parce qu'un
socle devrait en avoir.

### La couture, à poser au premier module de 6b

**`src/cms/`, et une règle d'import qui interdit à tout le reste de le
consulter.** La flèche de dépendance devient à sens unique, vérifiée par le
lint à chaque commit — la même mécanique que la frontière console ↔ backend,
où la discipline seule n'avait pas suffi.

Ce qui compte n'est pas de pouvoir extraire un jour, c'est de savoir **à tout
moment** si c'est encore possible. Un répertoire répond à « quels fichiers sont
le socle ? » à n'importe quel commit ; un tag ne répond qu'une fois, le jour où
on le pose.

⚠️ Cette règle empêche le socle de **dépendre** du CMS. Elle ne l'empêche pas
d'en **contenir** le vocabulaire : c'est le catalogue composable qui s'en
charge, seul vrai travail de conception des trois
([backlog 0014](../backlog/0014-frontiere-du-socle.md)).

### Ce qu'on ne fait pas

**Pas de second dépôt, pas de paquet publié.** Un socle avec un seul
consommateur n'est pas une bibliothèque, c'est un répertoire avec de la
cérémonie — et deux dépôts créeraient exactement le risque qu'on veut éviter :
une correction trouvée en construisant le CMS qu'il faudrait reporter, publier,
réinstaller. Avec une seule histoire, elle est simplement faite.

**Pas de système de plugins.** Les outils utilisés portent déjà leurs points de
montage — Hono monte des sous-applications (`app.route`), Drizzle lit un
schéma, les migrations sont numérotées. Un registre et une API d'extension
n'ajouteraient rien, et concevoir une API d'extension avant d'avoir un second
consommateur, c'est dessiner la couture avant la pièce — l'inverse de ce qui a
fonctionné jusqu'ici.

## 2FA

**Aucune couture nécessaire.** Le plugin Better-Auth ajoute un champ sur
`user` (`twoFactorEnabled`) et une table `twoFactor` (secret TOTP, codes de
secours, compteur d'échecs, expiration du verrouillage) — entièrement dans le
domaine de Better-Auth, aucune table applicative touchée.

Le seul aspect applicatif serait une politique d'organization (« cette
organization exige la 2FA de tous ses membres », comme GitHub) : un champ sur
`organizations` et une vérification dans le middleware, ajoutables proprement
n'importe quand.
