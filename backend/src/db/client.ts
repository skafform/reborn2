import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.ts";
import * as schema from "./schema.ts";

/**
 * Accès aux tables applicatives.
 *
 * Le pool utilise `DATABASE_URL`, donc le **rôle applicatif** : ni superuser,
 * ni propriétaire des tables, sans `BYPASSRLS`. Il est soumis aux policies.
 * Les migrations passent par `DATABASE_MIGRATION_URL` et drizzle-kit.
 */
const pool = new Pool({ connectionString: env.DATABASE_URL });

/**
 * Volontairement **non exporté**. Une requête émise en dehors de
 * `withContext` s'exécuterait sans contexte : les policies renverraient zéro
 * ligne et les écritures échoueraient. L'échec serait visible, mais le
 * contournement doit rester impossible par construction.
 */
const db = drizzle(pool, { schema });

export type QueryContext = {
  /** Identité de l'acteur humain. Absente pour une clé API. */
  userId?: string;
  /** Organization à laquelle la requête est cadrée. */
  organizationId?: string;
  /**
   * Hachage d'un jeton d'invitation. La possession du jeton **est**
   * l'autorisation : elle rend visible exactement la ligne correspondante,
   * ce qui permet d'accepter une invitation avant d'être membre.
   */
  invitationTokenHash?: string;
};

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Ouvre une transaction, y pose le contexte RLS, et exécute `fn`.
 *
 * `set_config(…, true)` limite la portée à la transaction. Un `SET` simple
 * persisterait sur la connexion et fuiterait vers la requête suivante du pool
 * — la façon la plus courante de casser l'isolation multi-tenant (ADR 0003).
 *
 * Une valeur absente est posée à la chaîne vide, que les fonctions SQL
 * `app_current_*` convertissent en `NULL` : les policies échouent alors en
 * *fail-closed*.
 */
export function withContext<T>(
  context: QueryContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${context.userId ?? ""}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.current_organization_id', ${context.organizationId ?? ""}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.invitation_token_hash', ${context.invitationTokenHash ?? ""}, true)`,
    );
    return fn(tx);
  });
}

/** À n'appeler qu'à l'arrêt du serveur ou en fin de suite de tests. */
export function closePool(): Promise<void> {
  return pool.end();
}

/**
 * Exposé pour les contrôles de préconditions et les tests, qui interrogent le
 * catalogue système — pas les tables applicatives. Toute requête métier passe
 * par `withContext`.
 */
export function unsafePoolForIntrospection(): Pool {
  return pool;
}
