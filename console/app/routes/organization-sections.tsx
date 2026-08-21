import { Outlet, useOutletContext } from "react-router";
import { api } from "../lib/api";
import { MembershipSchema } from "../lib/api-contract";
import { Sidebar } from "../ui/sidebar";
import type { Route } from "./+types/organization-sections";
import type { OrganizationContext } from "./organization";

/**
 * Les sections de l'organization elle-même. Entrer dans un projet quitte cette
 * coque pour la sienne — d'où deux mises en page sœurs plutôt qu'une barre
 * latérale qui saurait tout faire.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  // Ce que la personne peut faire ici, dit par le serveur. Le nom du rôle ne
  // suffirait pas : les rôles sont personnalisables par organization, donc
  // « viewer » ne garantit rien — et déduire les permissions d'un nom
  // recopierait la matrice RBAC hors de son unique source de vérité.
  //
  // ⚠️ Un membre de projet n'a **aucune** permission ici : les siennes ne
  // valent que dans son projet. La barre latérale se réduit alors à l'Inbox et
  // aux projets, ce qui est exactement ce qu'il peut atteindre.
  const { permissions } = await api(
    `/organizations/${params.organizationId}/me`,
    MembershipSchema,
  );
  return { organizationId: params.organizationId, permissions };
}

export default function OrganizationSections({ loaderData }: Route.ComponentProps) {
  const { organizationId, permissions } = loaderData;
  // Relayé tel quel : cette coque n'ajoute rien à ce que la précédente sait,
  // elle ne fait que s'intercaler pour porter sa propre barre latérale.
  const parent = useOutletContext<OrganizationContext>();

  /**
   * ⚠️ Masquer une entrée est un **confort, jamais le garde-fou** : chaque
   * route reste gardée côté serveur. On peut toujours taper l'adresse, ou
   * garder un onglet ouvert pendant qu'on nous retire un rôle.
   */
  const sections = [
    // L'Inbox en premier : c'est ce qui attend une réponse, pas ce qu'on
    // consulte. Son contenu appartient à la personne, pas à l'organization
    // courante (voir routes.ts) — donc aucune permission ne la conditionne.
    { to: `/org/${organizationId}/inbox`, label: "Inbox", end: false, needs: null },
    // Aucune permission non plus : la liste **est** le filtre côté serveur.
    // Quelqu'un qui n'atteint aucun projet y voit une page vide, ce qui est
    // plus honnête qu'une entrée absente.
    { to: `/org/${organizationId}`, label: "Projects", end: true, needs: null },
    {
      to: `/org/${organizationId}/team`,
      label: "Team",
      end: false,
      needs: "member.read",
    },
  ].filter((section) => section.needs === null || permissions.includes(section.needs));

  return (
    <div className="console-body">
      <Sidebar sections={sections} />
      <main className="console-main">
        <Outlet context={parent} />
      </main>
    </div>
  );
}
