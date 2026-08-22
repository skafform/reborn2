# Base de données : deux propriétaires de schéma

Pour éviter les frictions connues entre Better-Auth et l'adapter Drizzle
(incompatibilité avec Drizzle v1/Effect-TS, comptage de lignes affectées
incorrect, erreurs de schéma après mise à jour — détail et sources dans
[../research/better-auth-drizzle.md](../research/better-auth-drizzle.md)), la
même base Postgres est gérée par deux systèmes distincts, sans adapter entre
les deux :

- **Tables Better-Auth** (`user`, `session`, `account`, `verification`) :
  gérées nativement par Better-Auth via un `pg.Pool` direct (son moteur Kysely
  interne), sans passer par Drizzle. Migrations par
  `backend/scripts/migrate-auth.ts` — voir ci-dessous.
- **Tables applicatives** (`organizations`, `projects`, `environments`,
  `organization_members`, `project_members`, `invitations`, `api_keys`,
  `roles`, `permissions`, `role_permissions`, `schemas`, `schema_versions`,
  `schema_history`, et à venir `documents`, `audit_log`) : gérées via
  **Drizzle ORM**, avec des colonnes `user_id` en clé étrangère vers `user.id`
  (table Better-Auth).

  ⚠️ Les trois dernières construites vivent dans `backend/src/cms/schema.ts`,
  pas dans `db/schema.ts` : le socle n'a aucune raison de porter les tables du
  CMS, et `drizzle.config.ts` nomme les deux fichiers.

Compromis accepté : pas de join SQL unique entre une table Better-Auth et une
table applicative — deux requêtes séparées, assemblées en code applicatif.
C'est le pattern recommandé par Better-Auth lui-même (garder les tables
d'auth sous sa propre gestion, les tables produit ne font que référencer
`user_id`).

Ce découplage permet aussi de rebrancher l'adapter Drizzle officiel plus tard
(quand sa compatibilité avec Drizzle v1 sera stabilisée) sans toucher aux
tables applicatives : il suffira de changer la config `database` de
Better-Auth.

## Le plugin `organization` de Better-Auth n'est pas utilisé

Better-Auth propose un plugin `organization` qui implémente organizations,
membres, rôles et invitations clé en main. **On ne l'utilise pas** — cette
logique est codée côté applicatif (Drizzle), pour deux raisons :

- Le plugin ne connaît qu'**un seul niveau** (organization) ; il ne couvre pas
  le second niveau `project_members` avec `editor`/`contributor`/`guest` (voir
  [roles-permissions.md](./roles-permissions.md))
- Ses tables vivraient sous la gestion de Better-Auth, ce qui éclaterait le
  modèle applicatif entre les deux systèmes — exactement l'inverse de la règle
  posée ci-dessus

Better-Auth reste donc cantonné à l'authentification pure (identité, session,
mot de passe, vérification d'email).

## Clés étrangères vers `user.id`

Les tables applicatives portent de **vraies contraintes de clé étrangère**
vers `user.id` (pas de simple colonne `user_id` non contrainte) : les lignes
concernées *sont* les permissions du système, et une ligne orpheline pointant
vers un utilisateur inexistant serait un membre fantôme — un risque de
sécurité.

Comportement à la suppression d'un utilisateur :

| Table | Comportement | Raison |
|---|---|---|
| `organization_members` | `CASCADE` | Le membre disparaît avec le compte |
| `project_members` | `CASCADE` | Idem |
| `invitations.invited_by` | `SET NULL` | L'invitation survit à la suppression de son émetteur |
| `documents` (auteur) | `SET NULL` | Le contenu ne disparaît jamais avec un compte |

## Provisionnement d'un environnement

⚠️ **Ce qui suit n'est dans aucune migration.** Les migrations créent les
tables, policies, fonctions et triggers — mais pas les **rôles ni les droits**,
qui existent forcément avant elles.

C'est pourtant ce sur quoi repose tout le modèle de sécurité. Un environnement
provisionné sans ces rôles fera tourner l'application avec le rôle par défaut,
souvent `postgres` : **RLS devient alors inerte, silencieusement**. Tout
fonctionne, les tests passent, et chaque locataire voit les données de tous les
autres.

### La marche à suivre

```bash
pnpm db:bootstrap         # rôles et droits — une fois par environnement
pnpm auth:migrate:apply   # tables Better-Auth
pnpm db:migrate           # tables applicatives, policies, triggers
```

L'ordre des migrations n'est pas indifférent : les clés étrangères applicatives
pointent vers `user.id`.

`scripts/bootstrap-db.ts` est idempotent et requiert `DATABASE_ADMIN_URL` — une
connexion administrateur, utilisée uniquement là, jamais par le serveur. Il
fait, dans l'ordre :

| Étape | Ce qu'elle achète |
|---|---|
| `CREATE ROLE` × 2 | Le propriétaire du schéma, et le rôle applicatif — ni superuser, ni propriétaire, sans `BYPASSRLS` |
| `ALTER SCHEMA public OWNER TO` | Les tables appartiennent au propriétaire, pas à l'application |
| `GRANT USAGE ON SCHEMA` | L'application peut atteindre le schéma |
| `REVOKE CREATE ON SCHEMA public FROM PUBLIC` | Personne d'autre n'y crée d'objets |
| `GRANT CREATE ON DATABASE` | drizzle-kit peut créer son schéma de journal |
| `ALTER DEFAULT PRIVILEGES` | Toute table future est accessible à l'application **sans lui appartenir** — évite un `GRANT` manuel après chaque migration |

### ⚠️ Les rôles appartiennent au cluster, pas à la base

Amorcer une **seconde base sur la même instance** avec les noms par défaut
réécrit les mots de passe des rôles de la première et la casse silencieusement.
Constaté en testant le script.

Sur une instance hébergeant plusieurs environnements, donner des noms
distincts : `DATABASE_OWNER_ROLE` et `DATABASE_APP_ROLE`.

### Préconditions à vérifier

Une configuration *absente* échoue bruyamment ; une configuration *fausse* ne
fait aucun bruit. D'où l'intérêt de contrôler explicitement :

| Précondition | Contrôle |
|---|---|
| Le rôle applicatif n'est ni superuser ni porteur de `BYPASSRLS` | `pg_roles.rolsuper`, `rolbypassrls` |
| Il ne possède aucune table applicative | `pg_tables.tableowner` |
| RLS est **activé et forcé** sur chaque table applicative | `pg_class.relrowsecurity`, `relforcerowsecurity` |

## Row Level Security

Les tables applicatives portent des policies RLS cadrant la **frontière
multi-tenant** (`organization_id` / `environment_id`). Le modèle de rôles
reste en TypeScript. Voir [securite.md](./securite.md) pour la décision et son
raisonnement.

Trois contraintes de mise en place, à respecter dès la création des tables :

- **Rôle applicatif dédié, non-propriétaire** des tables, plus
  `FORCE ROW LEVEL SECURITY` sur chacune — sans quoi RLS ne fait rien,
  silencieusement. À créer **avant** la première table : le faire après impose
  de transférer les droits sur tout le schéma
- **Chaque requête dans une transaction explicite**, avec
  `set_config('app.…', $1, true)` — le troisième argument à `true` limite la
  portée à la transaction. Un `SET` simple fuiterait vers la requête suivante
  du pool
- **Colonne de cadrage en tête de chaque index** des tables concernées — RLS
  ajoute un `WHERE` implicite que Postgres ne peut satisfaire autrement qu'en
  balayage complet

**Pas de RLS sur les tables Better-Auth** : il doit pouvoir lire n'importe quel
utilisateur au moment du login, avant qu'une session existe — et ces tables ne
sont pas cadrées par locataire.

## Portabilité — Postgres nu, sans helper propriétaire

**Choix délibéré : Postgres standard, aucune dépendance à un fournisseur.**
L'objectif est de pouvoir changer d'hébergeur sans rien réécrire.

Ce qui garantit cette latitude :

- Postgres nu, sans extension propriétaire
- RLS par `set_config` standard, et non par `auth.uid()` (convention Supabase)
- Better-Auth sur un `pg.Pool` quelconque
- Drizzle, sans import spécifique à un fournisseur

**Ce qui la détruirait** — et c'est facile à faire sans y penser, car ces
helpers simplifient à court terme :

- les imports `drizzle-orm/supabase` ou `drizzle-orm/neon` avec leurs rôles
  prédéfinis
- Neon Authorize
- `auth.uid()` et les conventions RLS de Supabase

### Compatibilité vérifiée des hébergeurs

Notre motif `SET LOCAL` dans une transaction explicite conditionne cette
portabilité — il dépend du mode de pooling.

| Hébergeur | Compatible | Détail |
|---|---|---|
| **Neon** | ✅ | PgBouncer en mode transaction ; `SET LOCAL` y est documenté comme sûr avec des policies RLS |
| **Supabase** (comme hébergeur) | ✅ | Même famille de pooler, mode transaction |
| **AWS RDS**, sans proxy | ✅ | Postgres nu ; seule la chaîne de connexion change |
| **AWS RDS + RDS Proxy** | ⚠️ | Fonctionne, mais `SET LOCAL` **épingle** la connexion sous PostgreSQL : le proxy ne mutualise plus rien |

⚠️ **Ne jamais activer `EXCLUDE_VARIABLE_SETS` sur RDS Proxy.** Cette option
évite l'épinglage, mais AWS avertit qu'elle peut faire fuiter les variables de
session d'une connexion vers une autre — soit exactement la fuite
inter-locataires que RLS est censée empêcher. Elle transformerait notre défense
en faille.

⚠️ **Le pooling en mode *statement* est incompatible** : il casse entièrement
les variables de session.

### La latitude porte sur la base, pas sur l'authentification

Utiliser Supabase comme **hébergeur Postgres** est simple. Adopter **Supabase
Auth** signifierait abandonner Better-Auth et tout ce qui repose dessus
(invitations, magic link, politique de liaison OAuth — voir
[auth.md](./auth.md)). Deux décisions distinctes, dont seule la première est
réversible à bas coût.

Sources : [Connection pooling — Neon](https://neon.com/docs/connect/connection-pooling)
· [Avoiding pinning an RDS Proxy — AWS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html)

## Migrations Better-Auth : pas via son CLI

⚠️ **`@better-auth/cli` n'est pas utilisable ici.** Il épingle `better-auth` en
**dépendance dure** (1.4.x au moment de l'écriture), pas en peer — il génère
donc le schéma de *sa* version, pas de celle qu'on a installée. Vérifié
empiriquement : avec `better-auth` 1.7.1, le CLI omettait `account.issuer` et
l'inscription échouait en 500.

À la place, `backend/scripts/migrate-auth.ts` appelle `getMigrations` depuis
**le paquet installé** — impossible qu'il dérive de la version en usage. Il
diffe contre le schéma vivant et n'émet que le nécessaire.

```bash
pnpm auth:migrate         # affiche le SQL, n'applique rien
pnpm auth:migrate:apply   # applique
```

Le script se connecte avec `DATABASE_MIGRATION_URL`, donc le rôle
propriétaire.

## Ordre des migrations

Conséquence directe des FK ci-dessus : **les migrations Better-Auth doivent
toujours tourner avant celles de Drizzle** (la table `user` doit exister avant
les tables qui la référencent).

**Détail pratique** : `user` est un mot réservé en SQL. Better-Auth nomme sa
table `user` (singulier) et la quote systématiquement — les définitions
Drizzle qui la référencent doivent la quoter aussi.

Voir aussi [multi-tenant.md](./multi-tenant.md) et
[roles-permissions.md](./roles-permissions.md) pour le détail des tables
applicatives concernées.
