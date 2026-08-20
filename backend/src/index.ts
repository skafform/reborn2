import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { env } from "./config/env.ts";

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
