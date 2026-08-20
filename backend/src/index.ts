import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { env } from "./config/env.ts";
import { unsafePoolForIntrospection } from "./db/client.ts";
import { assertDatabasePreconditions } from "./db/preconditions.ts";
import { installConfiguredMailer } from "./mail/mailer.ts";

// Refuser de démarrer plutôt que servir avec une isolation inopérante : un
// rôle mal configuré rendrait RLS inerte sans le moindre signe.
await assertDatabasePreconditions(unsafePoolForIntrospection());

// L'envoi réel s'installe ici, et nulle part ailleurs : importer un module ne
// doit jamais suffire à expédier un email.
installConfiguredMailer();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
