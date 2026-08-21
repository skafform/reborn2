import { Outlet, redirect, useNavigate } from "react-router";
import { api } from "../lib/api";
import { OrganizationsSchema } from "../lib/api-contract";
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
 *
 * Il ne rend **que la barre du haut**. La barre latérale est contextuelle : ce
 * qu'on y voit dans un projet n'a rien à voir avec ce qu'on y voit au niveau
 * de l'organization, et chaque coque en dessous charge ce dont la sienne a
 * besoin. Les mélanger obligerait ce cadre à connaître le projet courant,
 * c'est-à-dire à lire l'état de son enfant.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const { data: session } = await authClient.getSession();
  if (!session) throw redirect("/login");

  const organizations = await api("/organizations", OrganizationsSchema);
  const current = organizations.find((o) => o.id === params.organizationId);
  // Pas de 403 : une organization dont on n'est pas membre est indiscernable
  // d'une organization inexistante, ici comme dans l'API (ADR 0012).
  //
  // ⚠️ Une organization **hôte** en fait partie : quelqu'un membre d'un seul
  // projet la voit ici sans y appartenir (architecture/multi-tenant.md).
  if (!current) throw redirect("/");

  return { user: session.user, organizations, current };
}

/** Ce que la coque transmet, déjà chargé — plutôt qu'une seconde requête. */
export type OrganizationContext = {
  user: { id: string; email: string };
  currentId: string;
};

export default function OrganizationLayout({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { current, organizations, user } = loaderData;

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

      <Outlet context={{ user, currentId: current.id } satisfies OrganizationContext} />
    </div>
  );
}
