import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";

/**
 * Où joindre l'API, en développement.
 *
 * La console et le backend sont **deux serveurs agnostiques l'un de l'autre** :
 * elle ne connaît de lui qu'une adresse. Cette adresse est donc de la
 * configuration, pas une affirmation inscrite dans le code — le port 3000 n'est
 * pas plus garanti que le 5432 ne l'était pour Postgres.
 *
 * Pas de valeur de repli, volontairement : une cible par défaut ferait démarrer
 * la console en pointant silencieusement ailleurs. Mieux vaut refuser de
 * démarrer avec un message clair, comme le fait le backend pour son propre
 * environnement.
 *
 * La variable n'a **pas** le préfixe `VITE_` : elle sert au serveur de
 * développement, et ce préfixe l'exposerait dans le bundle envoyé au navigateur.
 */
function apiProxyTarget(mode: string): string {
  // Le fichier de configuration s'exécute avant que Vite ne charge `.env` —
  // d'où `loadEnv`, avec un préfixe vide pour lire aussi les variables sans
  // `VITE_`.
  const { API_PROXY_TARGET } = loadEnv(mode, process.cwd(), "");

  if (!API_PROXY_TARGET) {
    throw new Error(
      "API_PROXY_TARGET manquante. Copier .env.example vers .env dans console/.",
    );
  }
  try {
    new URL(API_PROXY_TARGET);
  } catch {
    throw new Error(`API_PROXY_TARGET n'est pas une URL valide : ${API_PROXY_TARGET}`);
  }
  return API_PROXY_TARGET;
}

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
export default defineConfig(({ command, mode }) => {
  /*
   * Le proxy — et donc la variable qu'il exige — n'appartient qu'au **serveur
   * de développement**. Ni un build ni une prévisualisation n'ont à connaître
   * une adresse de développement, et aucun des deux ne doit échouer faute de
   * la trouver.
   *
   * Deux pièges rendent ce test moins évident qu'il n'en a l'air :
   *
   * 1. `command === "build"` ne suffit pas. En mode SPA, `react-router build`
   *    démarre lui-même un serveur `preview` pour préfabriquer `index.html` —
   *    donc un `serve` a lieu au milieu d'un build.
   * 2. `isPreview` ne suffit pas non plus. Vite évalue ce fichier **deux fois
   *    par phase**, et la seconde évaluation ne reçoit pas le drapeau : on lit
   *    `{command: "serve", isPreview: true}` puis `{command: "serve"}`.
   *
   * `mode`, lui, est stable sur les quatre évaluations : `development` pour
   * `pnpm dev`, `production` pour le build comme pour la prévisualisation.
   *
   * Conséquence assumée : `pnpm preview` ne joint pas l'API. C'est exact — il
   * sert le build de production, qui s'adresse à l'API publique, pas à un
   * proxy.
   */
  const isDevServer = command === "serve" && mode !== "production";

  return {
    plugins: [reactRouter()],
    ...(isDevServer
      ? {
          server: {
            proxy: {
              "/api": { target: apiProxyTarget(mode), changeOrigin: true },
            },
          },
        }
      : {}),
  };
});
