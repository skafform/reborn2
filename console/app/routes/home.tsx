import { Form, Link, redirect, useNavigation } from "react-router";
import { ApiError, api, postJson } from "../lib/api";
import { authClient } from "../lib/auth";
import type { Route } from "./+types/home";

type Organization = { id: string; name: string; role: string };

/**
 * L'accueil exige une session, et c'est lui qui l'exige : aucun écran en
 * dessous n'a à s'en souvenir.
 *
 * L'identité vient de la session vérifiée par le backend, jamais d'une valeur
 * conservée par la console — c'est la règle des routes d'administration
 * (architecture/securite.md).
 */
export async function clientLoader() {
  const { data: session } = await authClient.getSession();
  if (!session) throw redirect("/login");

  return {
    user: session.user,
    organizations: await api<Organization[]>("/organizations"),
  };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();

  if (form.get("intent") === "sign-out") {
    await authClient.signOut();
    return redirect("/login");
  }

  try {
    const organization = await postJson<Organization>("/organizations", {
      name: String(form.get("name")),
    });
    // Qui crée une organization en devient `owner` — l'inviter est la suite
    // naturelle, et c'est le parcours qu'on cherche à éprouver.
    return redirect(`/org/${organization.id}/invite`);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";

  return (
    <div className="console console-centered">
      <div className="console-panel console-panel--wide">
        <div className="console-page-header">
          <h1>Organizations</h1>
          <Form method="post">
            <input type="hidden" name="intent" value="sign-out" />
            <button className="console-button" type="submit">
              Se déconnecter
            </button>
          </Form>
        </div>

        <p className="console-muted">
          Connecté comme {loaderData.user.name} — {loaderData.user.email}
        </p>

        {loaderData.organizations.length === 0 ? (
          <p>Aucune organization. La première se crée ci-dessous.</p>
        ) : (
          <ul className="console-list">
            {loaderData.organizations.map((organization) => (
              <li key={organization.id}>
                <Link
                  className="console-text-link"
                  to={`/org/${organization.id}/invite`}
                >
                  {organization.name}
                </Link>
                <span className="console-badge">{organization.role}</span>
              </li>
            ))}
          </ul>
        )}

        {actionData?.error && (
          <p className="console-banner console-banner--error">{actionData.error}</p>
        )}

        <Form method="post" className="console-inline-form">
          <label className="console-field">
            <span className="console-label">Nouvelle organization</span>
            <input className="console-input" name="name" required maxLength={200} />
          </label>
          <button
            className="console-button console-button--primary"
            type="submit"
            disabled={busy}
          >
            {busy ? "Création…" : "Créer"}
          </button>
        </Form>
      </div>
    </div>
  );
}
