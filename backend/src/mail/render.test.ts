import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { app } from "../app.ts";
import { createMemoryMailer, mailer } from "./mailer.ts";
import { escapeHtml, heading, paragraph } from "./render.ts";
import { render } from "./template.ts";
import { invitationEmail } from "./templates/invitation.ts";

describe("rendu des emails", () => {
  it("échappe les valeurs venant de l'extérieur", () => {
    const rendered = render(invitationEmail, {
      ...invitationEmail.sample,
      organizationName: '<script>alert("xss")</script>',
    });

    assert.ok(
      !rendered.html.includes("<script>"),
      "un nom d'organization ne doit jamais devenir du balisage",
    );
    assert.ok(rendered.html.includes("&lt;script&gt;"));
  });

  it("échappe aussi dans le sujet des liens", () => {
    assert.equal(escapeHtml(`a"b'c<d>e&f`), "a&quot;b&#39;c&lt;d&gt;e&amp;f");
  });

  it("produit toujours une version texte", () => {
    const rendered = render(invitationEmail, invitationEmail.sample);
    assert.ok(rendered.text.length > 0);
    assert.ok(
      !rendered.text.includes("<"),
      "la version texte ne doit contenir aucun balisage",
    );
    assert.ok(rendered.text.includes(invitationEmail.sample.acceptUrl));
  });

  it("compose un document HTML complet", () => {
    const rendered = render(invitationEmail, invitationEmail.sample);
    assert.ok(rendered.html.startsWith("<!doctype html>"));
    assert.ok(rendered.html.includes(invitationEmail.sample.acceptUrl));
    assert.ok(
      rendered.html.includes('role="presentation"'),
      "la mise en page passe par des tables, seule structure fiable en email",
    );
  });

  it("l'échappement est fait par les composants, pas par leur appelant", () => {
    assert.ok(heading("<b>x</b>").html.includes("&lt;b&gt;"));
    assert.ok(paragraph("<b>x</b>").html.includes("&lt;b&gt;"));
  });
});

describe("mailer", () => {
  it("n'envoie rien à l'import", () => {
    // Garde-fou : le mailer part sur la console, jamais sur Resend. Sans
    // cela, charger un service depuis un test expédie de vrais emails —
    // c'est arrivé, et ça a épuisé le quota d'envoi.
    assert.doesNotThrow(() => mailer.send);
  });

  it("le double de test capture au lieu d'envoyer", async () => {
    const mailer = createMemoryMailer();
    const rendered = render(invitationEmail, invitationEmail.sample);

    await mailer.send({ ...rendered, to: "destinataire@skafform.test" });

    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0]?.to, "destinataire@skafform.test");
    mailer.clear();
    assert.equal(mailer.sent.length, 0);
  });
});

describe("prévisualisation", () => {
  it("liste les gabarits hors production", async () => {
    const response = await app.request("/dev/emails");
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("invitation"));
  });

  it("rend un gabarit avec ses données d'exemple", async () => {
    const response = await app.request("/dev/emails/invitation");
    assert.equal(response.status, 200);
    assert.ok((await response.text()).startsWith("<!doctype html>"));
  });

  it("rend aussi la version texte", async () => {
    const response = await app.request("/dev/emails/invitation?format=text");
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes("<!doctype"));
  });

  it("expose aussi les gabarits d'authentification", async () => {
    const list = await (await app.request("/dev/emails")).text();
    assert.ok(list.includes("verify-email"));
    assert.ok(list.includes("reset-password"));
  });

  it("répond 404 sur un gabarit inconnu", async () => {
    const response = await app.request("/dev/emails/inexistant");
    assert.equal(response.status, 404);
  });
});
