import { NavLink, Outlet, redirect, useNavigate } from "react-router";
import { api } from "../lib/api";
import { MembershipSchema, OrganizationsSchema } from "../lib/api-contract";
import { authClient } from "../lib/auth";
import { OrgSwitcher } from "../ui/org-switcher";
import type { Route } from "./+types/organization";

/**
 * Le cadre dans lequel tout écran d'organization s'inscrit.
 *
 * Il porte **le contrôle de session à un seul endroit** : aucun écran en
 * dessous n'a à s'en souvenir. Et il vérifie que l'organization du chemin en
 * est bien une de l'utilisateur — sans quoi la coque afficherait le nom d'une
 * organization à laquelle il n'a pas accès, pendant que l'API répondrait 404.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const { data: session } = await authClient.getSession();
  if (!session) throw redirect("/login");

  const organizations = await api("/organizations", OrganizationsSchema);
  const current = organizations.find((o) => o.id === params.organizationId);
  // Pas de 403 : une organization dont on n'est pas membre est indiscernable
  // d'une organization inexistante, ici comme dans l'API (ADR 0012).
  if (!current) throw redirect("/");

  // Ce que la personne peut faire ici, dit par le serveur. Le nom du rôle ne
  // suffirait pas : les rôles sont personnalisables par organization, donc
  // « viewer » ne garantit rien — et déduire les permissions d'un nom
  // recopierait la matrice RBAC hors de son unique source de vérité.
  const { permissions } = await api(
    `/organizations/${current.id}/me`,
    MembershipSchema,
  );

  return { user: session.user, organizations, current, permissions };
}

export default function OrganizationLayout({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { current, organizations, user, permissions } = loaderData;

  /**
   * ⚠️ Masquer une entrée est un **confort, jamais le garde-fou** : chaque
   * route reste gardée côté serveur. On peut toujours taper l'adresse, ou
   * garder un onglet ouvert pendant qu'on nous retire un rôle.
   */
  const sections = [
    // L'Inbox en premier : c'est ce qui attend une réponse, pas ce qu'on
    // consulte. Son contenu appartient à la personne, pas à l'organization
    // courante (voir routes.ts) — donc aucune permission ne la conditionne.
    { to: `/org/${current.id}/inbox`, label: "Inbox", end: false, needs: null },
    { to: `/org/${current.id}`, label: "Projects", end: true, needs: "content.read" },
    {
      to: `/org/${current.id}/team`,
      label: "Team",
      end: false,
      needs: "member.read",
    },
  ].filter((section) => section.needs === null || permissions.includes(section.needs));

  return (
    <div className="console console-shell">
      <header className="console-topbar">
        <div className="console-topbar-left">
          <span className="console-brand">Skafform</span>
          <span className="console-topbar-divider" aria-hidden="true">
            /
          </span>
          <OrgSwitcher
            organizations={organizations}
            currentId={current.id}
            onSelect={(id) => navigate(`/org/${id}`)}
            onCreate={() => navigate("/new-organization")}
          />
        </div>

        <div className="console-topbar-right">
          <span className="console-muted">{user.email}</span>
          <button
            type="button"
            className="console-button"
            onClick={async () => {
              await authClient.signOut();
              navigate("/login", { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="console-body">
        <nav className="console-sidebar">
          <ul>
            {sections.map((section) => (
              <li key={section.to}>
                <NavLink
                  to={section.to}
                  end={section.end}
                  className={({ isActive }) =>
                    isActive
                      ? "console-nav-link console-nav-link--active"
                      : "console-nav-link"
                  }
                >
                  {section.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="console-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
