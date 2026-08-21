import { Form, Link, redirect, useNavigation } from "react-router";
import { ApiError, apiErrorMessage, postJson } from "../lib/api";
import { authClient } from "../lib/auth";
import { Banner, Button, Field } from "../ui/controls";
import type { Route } from "./+types/new-organization";

type Organization = { id: string; name: string };

export async function clientLoader() {
  const { data: session } = await authClient.getSession();
  if (!session) throw redirect("/login");
  return null;
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  try {
    const organization = await postJson<Organization>("/organizations", {
      name: String(form.get("name")),
    });
    return redirect(`/org/${organization.id}`);
  } catch (error) {
    if (error instanceof ApiError) return { error: apiErrorMessage(error) };
    throw error;
  }
}

/**
 * Hors de la coque, délibérément : celle-ci se construit autour d'une
 * organization, et il n'y en a pas encore. C'est aussi l'écran d'arrivée d'un
 * compte neuf, qui n'a rien à voir avant d'avoir créé la sienne.
 */
export default function NewOrganization({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>New organization</h1>
        <p className="console-muted">
          It groups your projects and the people who work on them. You'll be its owner.
        </p>

        {actionData?.error && <Banner tone="error">{actionData.error}</Banner>}

        <Form method="post">
          <Field label="Name">
            <input className="console-input" name="name" required maxLength={200} />
          </Field>
          <Button type="submit" variant="primary" block disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </Form>

        <p className="console-form-footer">
          <Link to="/">Back</Link>
        </p>
      </div>
    </div>
  );
}
