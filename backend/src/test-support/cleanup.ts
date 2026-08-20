import { eq, sql } from "drizzle-orm";
import { withContext } from "../db/client.ts";
import { organizations, projects } from "../db/schema.ts";

/**
 * Nettoyage de fin de suite. Rien ici n'est utilisé par le serveur.
 *
 * ⚠️ **Aucune de ces fonctions n'avale son erreur.** La version précédente
 * terminait chaque `after()` par `.catch(() => {})`, ce qui a caché pendant
 * toute la construction du socle un défaut bien réel : la suppression d'une
 * organization était impossible (docs/backlog #0010). La base de développement
 * avait accumulé 305 organizations, 579 comptes et 231 invitations sans que
 * rien ne le signale.
 *
 * Un nettoyage qui échoue doit faire échouer la suite. C'est le seul moyen que
 * ça se sache.
 */

/**
 * Supprime une organization et tout ce qu'elle porte.
 *
 * L'ordre n'est pas indifférent : `projects.organization_id` est en
 * `ON DELETE RESTRICT` — volontairement, une organization qui porte encore des
 * projets ne doit pas s'effacer par mégarde. Il faut donc retirer les projets
 * d'abord, ce qui emporte en cascade leurs environnements puis leurs clés API.
 *
 * La suppression de l'organization emporte ensuite invitations, adhésions,
 * rôles et permissions de rôles. Le garde-fou du dernier `owner` est un
 * trigger **différé** qui ne s'indigne que si l'organization existe encore —
 * elle n'existe plus, il laisse passer.
 */
export async function destroyOrganization(
  userId: string,
  organizationId: string,
): Promise<void> {
  await withContext({ userId, organizationId }, async (tx) => {
    await tx.delete(projects).where(eq(projects.organizationId, organizationId));
    await tx.delete(organizations).where(eq(organizations.id, organizationId));
  });
}

/**
 * Supprime les comptes créés par une suite.
 *
 * Une seule instruction suffit : les tables de Better-Auth ne sont pas sous
 * RLS, et `account`, `session`, `organization_members` et `project_members`
 * disparaissent en cascade avec le compte. Les invitations, elles, gardent
 * leur trace — leur `invited_by` passe à `NULL`, ce qui est le comportement
 * voulu : une invitation reste vraie quand celui qui l'a envoyée s'en va.
 */
export async function destroyUsers(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;

  // `= any($1)` obligerait à annoter le type du tableau côté SQL ; une liste de
  // paramètres reste paramétrée sans rien supposer.
  const ids = sql.join(
    userIds.map((id) => sql`${id}`),
    sql`, `,
  );

  await withContext({}, (tx) =>
    tx.execute(sql`delete from "user" where id in (${ids})`),
  );
}
