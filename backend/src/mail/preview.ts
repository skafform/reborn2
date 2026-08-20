import { Hono } from "hono";
import { type Rendered, render, type Template } from "./template.ts";
import { resetPasswordEmail, verifyEmail } from "./templates/auth.ts";
import { invitationEmail } from "./templates/invitation.ts";

/**
 * Prévisualisation des emails dans le navigateur, sans en envoyer aucun.
 * Idée reprise de React Email, qui fournit un serveur pour ça — ici une route,
 * puisque les gabarits sont des fonctions pures.
 *
 * **Montée uniquement hors production** : elle expose la structure des emails
 * et n'a aucune raison d'être publique.
 */

/**
 * Lie chaque gabarit à ses propres données d'exemple. Sans cette étape, un
 * tableau de gabarits aux propriétés différentes forme une union que le
 * compilateur ne peut pas rapprocher de son échantillon.
 */
function bind<Props>(template: Template<Props>): {
  name: string;
  render: () => Rendered;
} {
  return { name: template.name, render: () => render(template, template.sample) };
}

const templates = [bind(invitationEmail), bind(verifyEmail), bind(resetPasswordEmail)];

export const previewRoutes = new Hono();

previewRoutes.get("/", (c) => {
  const items = templates
    .map((t) => `<li><a href="/dev/emails/${t.name}">${t.name}</a></li>`)
    .join("");
  return c.html(
    `<h1>Gabarits d'email</h1><ul>${items}</ul>` +
      `<p>Ajouter <code>?format=text</code> pour la version texte.</p>`,
  );
});

previewRoutes.get("/:name", (c) => {
  const template = templates.find((t) => t.name === c.req.param("name"));
  if (!template) return c.notFound();

  const rendered = template.render();

  if (c.req.query("format") === "text") {
    return c.text(`${rendered.subject}\n\n${rendered.text}`);
  }
  return c.html(rendered.html);
});
