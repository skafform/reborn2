import { KeyRound, LayoutDashboard, Settings, Shapes, Users } from "lucide-react";
import { Link, Outlet, useOutletContext } from "react-router";
import type * as z from "zod/mini";
import { api } from "../lib/api";
import { ProjectMembershipSchema, ProjectSchema } from "../lib/api-contract";
import { Sidebar } from "../ui/sidebar";
import type { Route } from "./+types/project";
import type { OrganizationContext } from "./organization";

/** Ce que la coque transmet à ses écrans, déjà chargé et validé. */
export type ProjectContext = {
  organizationId: string;
  /** L'utilisateur connecté, relayé par la coque du dessus. */
  session: OrganizationContext["user"];
  project: z.infer<typeof ProjectSchema>;
  permissions: string[];
};

/**
 * La coque d'un projet. Entrer dedans **remplace** la barre latérale : on n'y
 * voit plus les sections de l'organization, mais celles du projet.
 *
 * Le retour se fait par le lien en tête de la barre, pas par le bouton du
 * navigateur : on peut arriver ici par une adresse collée.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}`;

  // Les deux ensemble : le projet répond 404 si on ne l'atteint pas, ce qui
  // remonte en écran d'erreur plutôt qu'en coque vide.
  const [project, membership] = await Promise.all([
    api(base, ProjectSchema),
    // ⚠️ Le jumeau par projet de `/me`, et pas `/me` lui-même : pour une
    // portée projet, `can()` exige la cible, donc la réponse dépend du projet
    // regardé. Un membre d'organization obtient ici les mêmes permissions
    // partout, un membre de projet seulement celles de celui-ci.
    api(`${base}/me`, ProjectMembershipSchema),
  ]);

  return {
    organizationId: params.organizationId,
    project,
    permissions: membership.permissions,
  };
}

export default function ProjectLayout({ loaderData }: Route.ComponentProps) {
  const { organizationId, project, permissions } = loaderData;
  const { user } = useOutletContext<OrganizationContext>();
  const base = `/org/${organizationId}/projects/${project.id}`;

  const sections = [
    { to: base, label: "Overview", end: true, needs: null, icon: LayoutDashboard },
    // Le premier écran de CMS. Il vit sous `schema.read`, que tout rôle
    // système détient — voir ce qu'un projet peut contenir n'est pas le
    // modifier.
    {
      to: `${base}/content-types`,
      label: "Content types",
      end: false,
      needs: "schema.read",
      icon: Shapes,
    },
    {
      to: `${base}/team`,
      label: "Team",
      end: false,
      needs: "member.read",
      icon: Users,
    },
    // ⚠️ Tout ou rien : les clés publique et preview sont stockées en clair,
    // donc les voir c'est les avoir. Il n'existe pas de lecture seule ici, et
    // `listApiKeys` exige la même permission côté serveur.
    {
      to: `${base}/api-keys`,
      label: "API keys",
      end: false,
      needs: "apikey.manage",
      icon: KeyRound,
    },
    {
      to: `${base}/settings`,
      label: "Settings",
      end: false,
      needs: "project.settings",
      icon: Settings,
    },
  ].filter((section) => section.needs === null || permissions.includes(section.needs));

  return (
    <div className="console-body">
      <Sidebar
        sections={sections}
        header={
          <div className="console-sidebar-header">
            <Link className="console-sidebar-back" to={`/org/${organizationId}`}>
              ← Projects
            </Link>
            <span className="console-sidebar-title">{project.name}</span>
          </div>
        }
      />
      <main className="console-main">
        {/* Le projet est déjà chargé ici : le passer plutôt que le redemander
            évite une seconde requête pour la même chose. */}
        <Outlet
          context={
            {
              organizationId,
              session: user,
              project,
              permissions,
            } satisfies ProjectContext
          }
        />
      </main>
    </div>
  );
}
