import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { env } from "./config/env.ts";
import { unsafePoolForIntrospection } from "./db/client.ts";
import { assertDatabasePreconditions } from "./db/preconditions.ts";

// Refuser de démarrer plutôt que servir avec une isolation inopérante : un
// rôle mal configuré rendrait RLS inerte sans le moindre signe.
await assertDatabasePreconditions(unsafePoolForIntrospection());

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
