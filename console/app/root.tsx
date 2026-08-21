import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import "./console.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Préchargée : sans ça le navigateur ne découvre la police qu'après
            avoir analysé la feuille de style, et la première peinture se fait
            dans la pile système avant de basculer. */}
        <link
          rel="preload"
          href="/fonts/inter-latin-wght-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <title>Skafform Console</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * En mode SPA, rien n'est rendu au serveur : au premier affichage les
 * `clientLoader` n'ont pas encore répondu, et React Router demande de quoi
 * occuper cet instant. Le mode SPA n'accepte ce repli que sur la route
 * racine — c'est pourquoi il vit ici et non dans l'écran concerné.
 */
export function HydrateFallback() {
  return (
    <div className="console console-centered">
      <div className="console-panel">
        <p className="console-muted">Loading…</p>
      </div>
    </div>
  );
}

/**
 * Le dernier filet : une erreur qu'aucun écran n'a rattrapée arrive ici plutôt
 * que sur une page blanche.
 *
 * La pile n'est montrée qu'en développement — en production elle décrit la
 * structure interne à qui n'a pas à la connaître.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Not found" : "Error";
    details =
      error.status === 404 ? "This page doesn't exist." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>{message}</h1>
        <p>{details}</p>
        {stack !== undefined && <code className="console-code">{stack}</code>}
      </div>
    </div>
  );
}
