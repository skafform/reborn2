# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## État du projet

👉 **[docs/etat.md](docs/etat.md) dit où on en est, ce qui reste, et par quoi
commencer.** À lire en premier en reprenant le travail.


Le **socle est complet** — étapes 1 à 6a :

- Squelette Hono + `@hono/zod-openapi`, validation d'environnement
- Better-Auth sur Postgres (`pg.Pool`), confirmation d'adresse obligatoire,
  réinitialisation de mot de passe
- Tables applicatives sous RLS forcé, point de passage `withContext`
- Rôles personnalisables par organization, catalogue de permissions, `can()`,
  garde-fous d'escalade, routes de gestion
- Invitations et emails (gabarits maison, prévisualisation sur `/dev/emails`)
- Clés API : publique, preview, secrète — par environnement

**Pas encore** : schémas de contenu et documents (étape 6b) — c'est là que le
CMS commence, tout ce qui précède est réutilisable.

## Commandes

Toutes depuis `backend/` (gestionnaire : **pnpm**) :

```bash
pnpm dev                  # serveur en rechargement automatique (node --watch)
pnpm start                # serveur
pnpm auth:migrate         # migrations Better-Auth : écrit le SQL, n'applique pas
pnpm auth:migrate:apply   # migrations Better-Auth : écrit et applique
pnpm db:generate          # génère une migration Drizzle depuis le schéma
pnpm db:migrate           # applique les migrations Drizzle
pnpm test                 # node:test — touche la base locale
pnpm typecheck            # tsc --noEmit
pnpm lint                 # biome check
pnpm format               # biome check --write
```

Tests : **`node:test` natif**, pas de Vitest — aucune dépendance, et Node
exécute déjà le TypeScript. Les fichiers sont en `src/**/*.test.ts`, à côté du
code testé. Les tests d'intégration touchent la vraie base locale et nettoient
derrière eux.

Chaque migration Better-Auth produisant un changement écrit son SQL dans
`backend/migrations/auth/`, versionné avec le code.

⚠️ **Ne pas utiliser `@better-auth/cli`.** Il épingle `better-auth` en
dépendance dure et génère le schéma de *sa* version, pas de la nôtre — vérifié,
il produit un schéma incomplet qui fait échouer l'inscription en 500.
`scripts/migrate-auth.ts` appelle `getMigrations` depuis le paquet installé, il
ne peut pas dériver.

Node exécute le TypeScript **nativement** (effacement de types) — pas de `tsx`,
pas d'étape de build en développement. En contrepartie, la syntaxe non
effaçable est interdite : ni `enum`, ni paramètres-propriétés, ni `namespace`.
`erasableSyntaxOnly` dans `tsconfig.json` le fait échouer au typecheck.

Les variables d'environnement sont chargées par `--env-file=.env`, sans
`dotenv`.

**Ce n'est pas un monorepo.** Deux projets **indépendants** dans ce dépôt :

- `backend/` — l'API Hono
- `console/` — l'interface d'administration (React Router 8, SPA)

Ils ne partagent **ni workspace, ni package, ni outillage de build**, et se
déploient séparément. Ne jamais en introduire : c'est ce qui rend le mode RPC
de Hono impraticable et impose le contrat OpenAPI
([ADR 0005](docs/adr/0005-depots-separes-contrat-openapi.md)).

Ils communiquent par HTTP. En développement, un proxy Vite renvoie `/api` vers
`localhost:3000`, ce qui rend chaque requête *same-origin* — **aucun CORS n'est
donc nécessaire en local**, et le backend n'a pas à être modifié pour une
commodité de développement.

## Stack

- **PostgreSQL nu** — la seule base. Accès direct, sans couche d'abstraction
  au-delà de Drizzle, et **sans helper propriétaire** (voir *Portabilité*)
- **Hono** pour le serveur HTTP, sur Node.js
- **Better-Auth** pour l'authentification — via un `pg.Pool` direct, **jamais**
  via Drizzle (voir *Décisions faciles à casser*)
- **Drizzle** pour les tables applicatives uniquement
- **Zod** pour la validation, et `@hono/zod-openapi` dès la première route
- **TypeScript strict**

## Langue

- **Code, commentaires, messages de commit, noms de variables et tests en
  anglais.** Jamais de français dans le code
- **Documentation d'architecture (`docs/`) en français** — c'est la convention
  établie de ce projet

## Avant d'écrire du code

**Demander avant d'implémenter.** La rédaction dans `docs/` est en revanche
attendue une fois une décision validée en discussion.

Énoncer en 3 lignes maximum :
1. L'approche retenue
2. L'alternative plus simple envisagée, et pourquoi elle est écartée

Si la complexité supplémentaire ne se justifie pas, prendre le chemin le plus
simple. Demander avant d'ajouter la moindre dépendance.

## Vérifier, ne jamais déduire

Sur toute décision non triviale — authentification, accès aux données, gestion
d'erreurs, conception d'API, migrations, cache — **vérifier avant
d'improviser** :

- La **documentation officielle** de la bibliothèque concernée. En cas de
  désaccord entre la doc officielle et un billet de blog, suivre la doc
- **Ce que font les acteurs établis du domaine** (Contentful, Sanity,
  Storyblok) et les bonnes pratiques en vigueur. C'est sur cette base que
  l'architecture de ce projet a été fondée ; [docs/research/](docs/research/)
  en garde la trace avec les sources
- Références privilégiées : docs Hono, Better-Auth, Drizzle et PostgreSQL ;
  OWASP ASVS et OWASP API Top 10 pour la sécurité ; Twelve-Factor App pour la
  configuration et le déploiement

Citer en une ligne ce qui a été vérifié.

**Garde-fou** : une pratique n'est adoptée que si elle résout un problème que
ce projet a réellement. « Les gros le font » n'est pas une raison. Les patrons
d'entreprise (conteneurs d'injection de dépendances, bus d'événements, CQRS,
couche repository par-dessus SQL) sont rejetés par défaut — ne les proposer
qu'avec le problème concret qu'ils règlent ici.

## Viser la solution la plus propre, sans dette

L'objectif est la solution **la plus propre et la plus robuste**, pas la plus
rapide à écrire. Un raccourci qui impose une reprise plus tard est un coût
différé, pas de la simplicité.

Simplicité veut dire **aucun code qui ne serve un problème réel et actuel** —
pas le moins de code possible. Un mécanisme qui résout un vrai problème n'est
pas de la complexité à éviter.

- Livrer la plus petite solution qui règle **entièrement** le problème posé
- Pas d'abstraction spéculative, pas de « future-proofing », pas de drapeau de
  configuration que personne n'a demandé
- Pas de wrapper, helper ou factory tant qu'il n'est pas utilisé deux fois
  aujourd'hui
- Préférer le code explicite au code astucieux

**Note** : les *coutures* documentées dans
[evolutions-prevues.md](docs/architecture/evolutions-prevues.md) ne sont pas
des exceptions à cette règle. Chacune est justifiée par un coût de refactor
concret et chiffré, pas par une intuition — et aucune ne demande d'écrire de la
logique métier aujourd'hui.

## Portabilité — aucun verrouillage fournisseur

Postgres nu est un choix délibéré : pouvoir passer à Neon, Supabase ou AWS RDS
sans rien réécrire. Cette latitude se perd par petites commodités, pas par
grandes décisions.

**Interdits**, même s'ils simplifient à court terme :

- les imports `drizzle-orm/supabase` et `drizzle-orm/neon` avec leurs rôles
  prédéfinis
- Neon Authorize
- `auth.uid()` et les conventions RLS de Supabase
- toute extension Postgres propriétaire

Le contexte RLS se pose toujours par `set_config` standard. Voir
[database.md](docs/architecture/database.md) pour la compatibilité vérifiée des
hébergeurs — dont deux réglages à ne jamais activer (`EXCLUDE_VARIABLE_SETS`
sur RDS Proxy, pooling en mode *statement*).

## Aucune valeur en dur

Aucun littéral significatif dans un handler : ni durée, ni plafond, ni URL, ni
clé. Mais tout ne va pas au même endroit — le critère est celui de
Twelve-Factor : **la configuration, c'est ce qui varie d'un déploiement à
l'autre.**

| Catégorie | Où | Exemples |
|---|---|---|
| **Varie par déploiement** | `backend/.env` | `DATABASE_URL`, `RESEND_API_KEY`, `PORT`, `PLATFORM_URL` |
| **Identique partout**, mais ne doit pas être éparpillée | `backend/src/config/constants.ts` | expiration d'invitation (7 j), durée d'un lien de réinitialisation (1 h), plafonds de rate limiting, nombre max d'environnements, taille max d'un fichier |
| **Règle métier** | Du code, pas de la configuration | matrice de permissions RBAC, noms de rôles, types de clés API |

```
backend/
  .env                  secrets et valeurs par déploiement (jamais commité)
  .env.example          le modèle, commité
  src/config/
    env.ts              lecture + validation Zod du .env
    constants.ts        expirations, plafonds, limites
    permissions.ts      matrice RBAC (règle métier)
```

**Trois règles :**

1. **Validation de l'environnement au démarrage**, par un schéma Zod. Une
   variable manquante ou malformée fait **échouer le démarrage** avec un
   message clair — jamais un plantage à la première requête en production
2. **Rien dans `.env` qui ne soit un secret ou une adresse.** Si une valeur
   pourrait raisonnablement être identique partout, elle va dans
   `constants.ts`. Une expiration d'invitation configurable par environnement,
   c'est un bug qui ne se reproduit jamais en local
3. **Ne jamais sortir une règle métier en configuration.** La matrice de
   permissions perdrait son typage et ses tests pour un bénéfice nul —
   personne ne « configure » qu'un `contributor` peut publier

## Zéro dette

- Aucun `TODO`, `FIXME` ou code commenté laissé derrière. Une tâche différée
  devient un item de [docs/backlog/](docs/backlog/), référencé depuis le code
  par son numéro — jamais un marqueur perdu dans un fichier
- **Aucun code mort** : après chaque changement, vérifier qu'il ne reste ni
  export inutilisé, ni branche inatteignable, ni fichier orphelin, ni import
  hérité de l'implémentation précédente. Signaler ce qui a été supprimé
- Aucune logique dupliquée — si on copie-colle, on s'arrête et on refactorise

## Robustesse

- Traiter les chemins d'erreur explicitement, jamais de `catch` silencieux
- Valider toute entrée externe à la frontière (Zod au niveau de la route)
- Les types doivent être réels : pas de `any`, pas de `as` pour faire taire le
  compilateur
- Toute requête SQL brute utilise des valeurs paramétrées — jamais de
  concaténation ni de littéral de gabarit pour une valeur

## Sécurité

L'autorisation est vérifiée **côté serveur sur chaque route**, jamais déduite
de l'UI. Détail complet dans [securite.md](docs/architecture/securite.md).

**Deux couches, délibérément.** La menace visée est BOLA (risque n°1 du OWASP
API Top 10) : en multi-tenant, un client accédant aux données d'un autre.

- **Frontière multi-tenant → RLS Postgres.** Une policy par table sur la
  colonne de cadrage (`organization_id` / `environment_id`). Un `WHERE` oublié
  renvoie zéro ligne au lieu des données d'un autre locataire
- **Modèle de rôles → TypeScript, en RBAC.** Un catalogue de permissions
  atomiques (`content.publish`, `schema.write`…), une correspondance rôle →
  permissions dans une constante versionnée, et **un seul point de
  vérification** `can(acteur, permission, ressource)`. Ne pas le pousser dans
  des policies RLS

⚠️ **Jamais de `if (role === 'editor')` dans un handler.** Toute décision
d'autorisation passe par `can()` (`src/auth/authorization.ts`) ou par
`requirePermission()` (`src/auth/escalation.ts`), qui lève une
`AuthorizationError` traitée en un seul endroit.

Les permissions sont résolues **une fois par requête** dans le middleware et
tenues en mémoire ; `can()` n'accède jamais à la base. Aucun cache ne survit à
la requête — c'est ce qui fait qu'un retrait de rôle prend effet à la suivante.
Ne pas y ajouter de cache sans lire l'[ADR 0012](docs/adr/0012-resolution-des-permissions-par-requete.md).

⚠️ **On n'accorde jamais une permission qu'on ne détient pas.** À vérifier
aux **deux** moments où des permissions changent de mains : création ou
modification d'un rôle, **et** assignation. Vérifier seulement à la création
laisserait assigner un rôle préexistant plus puissant que soi.

Les **clés API partagent ce catalogue** : un seul `can()` sert les acteurs
humains et machines. Ne pas créer de second chemin d'autorisation pour les clés.

**Deux modèles d'accès.** Se tromper de modèle produit une route qui
fonctionne — mais faussement.

- **Routes de contenu**, authentifiées par clé API (publique / preview /
  secrète). L'appelant est une machine, sans identité utilisateur ; le contexte
  RLS est l'`environment_id` que la clé résout
- **Routes d'administration**, authentifiées par session Better-Auth.
  L'identité vient **toujours** de la session vérifiée, jamais d'un `user_id`
  ou `organization_id` envoyé par l'appelant

⚠️ **Toute requête applicative passe par `withContext`** (`src/db/client.ts`).
L'objet `db` de Drizzle n'est **pas exporté** : c'est ce qui rend le
contournement impossible par construction. `withContext` ouvre la transaction
et y pose le contexte RLS.

⚠️ **Une policy ne référence jamais une autre table sous RLS.** Deux policies
qui se consultent mutuellement forment un cycle que Postgres refuse, et
`SECURITY DEFINER` n'y change rien puisque `FORCE` soumet aussi le
propriétaire. Chaque table porte donc sa colonne de cadrage, dénormalisée et
garantie par une clé étrangère composite.

⚠️ **Une migration de données sous RLS doit lever `FORCE` le temps de
l'opération** — sinon le remplissage ne touche aucune ligne, silencieusement.
Et si elle échoue entre les deux, la table reste **sans FORCE** : le contrôle
de préconditions l'attrape au démarrage suivant. Voir
[securite.md](docs/architecture/securite.md).

⚠️ **Trois règles RLS dont la violation est silencieuse** — on se croit protégé
sans l'être :

1. Se connecter avec le **rôle applicatif dédié**, jamais avec le propriétaire
   des tables ni un superuser ; `FORCE ROW LEVEL SECURITY` sur chaque table
2. **Toute requête dans une transaction explicite**, contexte posé par
   `set_config('app.…', $1, true)`. Un `SET` simple fuite vers la requête
   suivante du pool
3. **Aucune valeur de repli dans une policy.** `current_setting('app.x', true)`
   renvoie `NULL` si absent, donc aucune ligne — *fail-closed*. Un `COALESCE`
   de confort ouvrirait tout

RLS ne dispense de rien : requêtes paramétrées toujours obligatoires, elle en
limite seulement la portée. Et elle ne protège pas des erreurs de rôle **à
l'intérieur** d'un locataire.

- Aucun secret, clé ou identifiant dans le code ou les logs

## Où vit l'architecture

**Point d'entrée : [docs/architecture/overview.md](docs/architecture/overview.md)**
— il indexe un document par aspect (auth, rôles, invitations, cache, assets,
localisation…).

**[docs/adr/](docs/adr/)** enregistre *pourquoi* chaque décision structurante a
été prise et ce qui a été écarté — à lire avant de remettre l'une d'elles en
question. Les critères pour ouvrir un nouvel ADR sont dans son
[README](docs/adr/README.md).

**[docs/backlog/](docs/backlog/)** porte les items de travail numérotés, à
identifiant stable. C'est **le seul endroit référençable depuis le code** — un
commentaire écrit `docs/backlog #0001`, jamais un `TODO`. À consulter avant de
commencer quoi que ce soit : plusieurs items sont bloquants pour l'étape en
cours.

Deux documents à consulter avant toute décision technique :

- [evolutions-prevues.md](docs/architecture/evolutions-prevues.md) — les
  fonctionnalités non construites et les **coutures** posées pour les
  accueillir. Une couture n'est pas une fonctionnalité : c'est une indirection
  ou une discipline placée maintenant pour éviter un refactor coûteux
- [decisions-ouvertes.md](docs/architecture/decisions-ouvertes.md) — les
  **questions** non tranchées. **Ne pas trancher seul** ce qui s'y trouve

## Décisions faciles à casser sans le savoir

Ces contraintes ne se devinent pas en lisant le code. Les violer se paie par un
refactor, pas par un bug immédiat.

**Better-Auth n'utilise pas Drizzle.** La base a *deux propriétaires de
schéma* : Better-Auth accède à Postgres par un `pg.Pool` direct pour ses
propres tables (`user`, `session`, `account`, `verification`), Drizzle gère
uniquement les tables applicatives. L'adapter Drizzle de Better-Auth a des bugs
de compatibilité documentés. Ne pas « harmoniser » les deux. Voir
[database.md](docs/architecture/database.md).

**Les migrations Better-Auth tournent avant celles de Drizzle** — les clés
étrangères vers `user.id` en dépendent. Et `user` est un mot réservé SQL, à
quoter.

**Pas de RLS sur les tables Better-Auth.** Il doit pouvoir lire n'importe quel
utilisateur au moment du login, avant qu'une session existe — et ces tables ne
sont pas cadrées par locataire. RLS s'applique aux tables applicatives
uniquement.

**La colonne de cadrage est en tête de chaque index** des tables sous RLS —
sinon le `WHERE` implicite ajouté par les policies force un balayage complet.

**Le plugin `organization` de Better-Auth n'est pas utilisé.** Organizations,
membres, rôles et invitations sont codés côté applicatif : le plugin ne couvre
pas le second niveau (`project_members`).

**Toute écriture passe par un point d'émission d'événements unique**, dont le
journal d'audit est le premier consommateur — jamais des `INSERT` d'audit
dispersés dans les handlers. Webhooks et purge de cache sont les deux autres
consommateurs prévus. Voir [audit.md](docs/architecture/audit.md).

**L'API de lecture publique reste en GET avec paramètres d'URL.** Un langage de
requête en POST supprimerait toute possibilité de cache CDN. Voir
[cache.md](docs/architecture/cache.md).

**Le contenu est rattaché à `environment_id`, pas à `project_id`.** Une table
`environments` ne contient qu'une ligne `master` par projet, invisible dans
l'UI. Voir [environments.md](docs/architecture/environments.md).

**`documents` porte `locale` et `translation_group_id`** dès le départ, ignorés
tant qu'il n'y a qu'une langue. Voir
[localisation.md](docs/architecture/localisation.md).

**`@hono/zod-openapi` dès la première route.** L'admin UI vivant dans un dépôt
séparé, le mode RPC de Hono est inutilisable et le client typé est généré
depuis la spec OpenAPI. L'ajouter après coup impose de réécrire toute la couche
de routing. Voir [api.md](docs/architecture/api.md).

## Environnement local

Postgres tourne dans un conteneur dédié — **`psql` n'est pas installé sur la
machine**, il faut passer par Docker :

```bash
docker exec skafform_db psql -U postgres -d skafform -c "\dt"
```

| | |
|---|---|
| Conteneur | `skafform_db` (PostgreSQL 17) |
| Port | **5433** (5432 est occupé par autre chose) |
| Base | `skafform`, volume `skafform_pgdata` |
| Config | `backend/.env`, modèle dans `backend/.env.example` |

**Deux rôles Postgres, et il faut utiliser le bon** — c'est ce qui rend RLS
opérante (voir *Sécurité*) :

| Rôle | Usage | Variable |
|---|---|---|
| `skafform_app` | Le serveur. Ni superuser, ni propriétaire, sans `BYPASSRLS` → **soumis aux policies** | `DATABASE_URL` |
| `skafform_owner` | Propriétaire du schéma, **réservé aux migrations** | `DATABASE_MIGRATION_URL` |

⚠️ Connecter le serveur avec `skafform_owner` ne suffirait pas à contourner
RLS — `FORCE ROW LEVEL SECURITY` y soumet aussi le propriétaire — mais lui
donnerait le droit de modifier le schéma en pleine exécution.

Conséquence pratique : **aucun rôle disponible ne peut lire ou purger les
tables applicatives sans contexte**, y compris pour nettoyer après un test.
Les tests passent donc par `withContext`, ce qui est plus fidèle de toute
façon.

⚠️ **Ces rôles et leurs droits ne sont dans aucune migration.** Ils existent
avant elles. Un environnement provisionné sans eux ferait tourner
l'application en `postgres` et **RLS serait inerte, silencieusement**. La
marche à suivre est dans
[database.md](docs/architecture/database.md#provisionnement-dun-environnement) ;
l'automatisation et son contrôle sont au [backlog #0007](docs/backlog/0007-amorcage-et-verification-db.md).

**Supabase a été abandonné.** Une pile Supabase (conteneurs
`supabase_*_Backend`) subsiste à l'arrêt, vestige d'une itération précédente.
Ne pas la redémarrer ni s'appuyer dessus.

## « Terminé » signifie

- Tests au vert, typecheck propre, lint propre
- Si aucun test n'a été ajouté pour une nouvelle logique, le dire explicitement
