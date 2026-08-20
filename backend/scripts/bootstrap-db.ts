import { Client } from "pg";

/**
 * Crée les rôles et les droits sur lesquels repose tout le modèle de sécurité.
 * À exécuter **une fois par environnement**, avant les migrations.
 *
 * Pourquoi un script plutôt qu'une procédure documentée : les instructions les
 * plus faciles à sauter — le `REVOKE`, les `ALTER DEFAULT PRIVILEGES` — sont
 * précisément celles dont l'oubli ne fait aucun bruit. Un environnement sans
 * elles fait tourner l'application avec un rôle trop puissant, et **RLS
 * devient inerte silencieusement**.
 *
 * Ces opérations ne peuvent pas vivre dans une migration : elles créent les
 * rôles que les migrations utilisent.
 *
 * Idempotent : relançable sans effet de bord.
 *
 *   node --env-file=.env scripts/bootstrap-db.ts
 *
 * Requiert `DATABASE_ADMIN_URL` — une connexion administrateur, utilisée
 * uniquement ici, jamais par le serveur.
 */
const adminUrl = process.env.DATABASE_ADMIN_URL;
const ownerPassword = process.env.DATABASE_OWNER_PASSWORD;
const appPassword = process.env.DATABASE_APP_PASSWORD;

if (!adminUrl || !ownerPassword || !appPassword) {
  console.error(
    "Variables requises : DATABASE_ADMIN_URL, DATABASE_OWNER_PASSWORD, DATABASE_APP_PASSWORD",
  );
  process.exit(1);
}

/**
 * ⚠️ **Les rôles Postgres appartiennent au cluster, pas à la base.**
 *
 * Amorcer une seconde base sur la même instance avec les noms par défaut
 * réécrirait les mots de passe des rôles de la première — et la casserait
 * silencieusement. Vérifié à nos dépens.
 *
 * Sur une instance partagée entre plusieurs environnements, donner des noms
 * distincts via `DATABASE_OWNER_ROLE` et `DATABASE_APP_ROLE`.
 */
const OWNER = process.env.DATABASE_OWNER_ROLE ?? "skafform_owner";
const APP = process.env.DATABASE_APP_ROLE ?? "skafform_app";

const client = new Client({ connectionString: adminUrl });
await client.connect();

const database = (
  await client.query<{ current_database: string }>("SELECT current_database()")
).rows[0]?.current_database;
if (!database) throw new Error("impossible de résoudre la base courante");

/**
 * `CREATE ROLE` n'a pas de `IF NOT EXISTS`, et un bloc `DO` n'accepte pas de
 * paramètres liés. On laisse donc Postgres composer l'instruction avec
 * `format`, qui échappe identifiant et littéral, puis on l'exécute.
 */
async function ensureRole(name: string, password: string) {
  const { rows } = await client.query<{ statement: string }>(
    `SELECT format(
       CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
            THEN 'ALTER ROLE %I LOGIN PASSWORD %L'
            ELSE 'CREATE ROLE %I LOGIN PASSWORD %L'
       END, $1::text, $2::text) AS statement`,
    [name, password],
  );
  const statement = rows[0]?.statement;
  if (!statement) throw new Error(`impossible de composer le rôle ${name}`);

  await client.query(statement);
  console.log(`  rôle ${name}`);
}

const steps: [string, () => Promise<unknown>][] = [
  [
    "Rôles",
    async () => {
      await ensureRole(OWNER, ownerPassword);
      await ensureRole(APP, appPassword);
    },
  ],
  [
    "Propriété du schéma public",
    () => client.query(`ALTER SCHEMA public OWNER TO ${OWNER}`),
  ],
  [
    "Accès du rôle applicatif au schéma",
    () => client.query(`GRANT USAGE ON SCHEMA public TO ${APP}`),
  ],
  [
    "Aucun autre rôle ne crée d'objets dans public",
    () => client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC"),
  ],
  [
    // drizzle-kit place son journal de migrations dans un schéma `drizzle`.
    "Le rôle de migration peut créer des schémas",
    () => client.query(`GRANT CREATE ON DATABASE "${database}" TO ${OWNER}`),
  ],
  [
    // Sans cela, chaque migration exigerait un GRANT manuel — et un oubli
    // passerait inaperçu jusqu'à la première requête en production.
    "Droits par défaut sur les objets à venir",
    async () => {
      await client.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public
           GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP}`,
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public
           GRANT USAGE, SELECT ON SEQUENCES TO ${APP}`,
      );
    },
  ],
];

console.log(`Amorçage de « ${database} » — rôles ${OWNER} / ${APP}`);
console.log(
  "Rappel : les rôles sont partagés par tout le cluster. Sur une instance\n" +
    "hébergeant plusieurs environnements, utiliser DATABASE_OWNER_ROLE et\n" +
    "DATABASE_APP_ROLE pour éviter d'écraser ceux d'un autre.\n",
);
for (const [label, run] of steps) {
  await run();
  console.log(`✓ ${label}`);
}

await client.end();

console.log(
  "\nTerminé. Migrations ensuite, dans cet ordre :\n" +
    "  pnpm auth:migrate:apply\n" +
    "  pnpm db:migrate",
);
