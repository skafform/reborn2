import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

/**
 * La console appelle l'API à travers un proxy plutôt qu'à son adresse
 * complète, ce qui rend chaque requête *same-origin*.
 *
 * C'est la raison d'être du proxy : un appel de 5173 vers 3000 serait
 * cross-origin et exigerait des en-têtes CORS que l'API ne renvoie pas —
 * les ajouter reviendrait à modifier le backend pour une commodité de
 * développement. Le CORS réel n'aura lieu qu'en production, entre
 * sous-domaines (voir docs/backlog #0004).
 */
export default defineConfig({
  plugins: [reactRouter()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
