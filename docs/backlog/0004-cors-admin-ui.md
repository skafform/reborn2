# 0004 — CORS pour l'admin UI

**État** : ouvert
**Priorité** : 🟡 Quand l'admin UI existe
**Ouvert le** : 2026-08-20

## Pourquoi ce n'est pas fait

L'admin UI n'existe pas — il n'y a aucune origine à autoriser. Configurer du
CORS sans consommateur serait une configuration que personne n'a demandée.

## À faire le moment venu

- Middleware CORS de Hono sur `/api/auth/*` et sur les routes de gestion, avec
  l'origine de l'admin UI et `credentials: true`
- `trustedOrigins` dans la configuration Better-Auth, avec la même origine

## Rappel

L'API et l'admin UI partagent le **même domaine racine** (sous-domaines), pour
que les cookies de session soient partagés sans les complications des cookies
tiers. Des domaines distincts remettraient en cause la stratégie de session.

Voir [ADR 0005](../adr/0005-depots-separes-contrat-openapi.md) et
[architecture/admin-ui.md](../architecture/admin-ui.md).
