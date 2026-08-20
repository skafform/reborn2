# Admin UI

- Application séparée de l'API Hono (probablement React/Next.js ou Vue), dans
  son propre répertoire, avec son propre serveur/instance — Hono reste une API
  pure, l'admin UI (console) en est un client qui communique exclusivement par
  API
- **Même domaine racine** que l'API, via sous-domaines (ex: `api.tonapp.com` /
  `admin.tonapp.com`) — permet aux cookies de session Better-Auth (voir
  [auth.md](./auth.md), *Sessions*) d'être partagés simplement entre les deux
  (`Domain=.tonapp.com`), sans les complications des cookies cross-domain
- CORS configuré côté Hono pour autoriser l'origine de l'admin UI
- Formulaires générés dynamiquement à partir des définitions de schéma — voir
  [content-schemas.md](./content-schemas.md)

## À définir (reporté à la construction de l'application)

- Écrans de gestion administrative (membres, rôles, invitations, clés API) —
  découle directement de [roles-permissions.md](./roles-permissions.md),
  [invitations.md](./invitations.md) et [api.md](./api.md)
- Écrans de contenu (éditeur de documents, formulaires dynamiques par schéma)
