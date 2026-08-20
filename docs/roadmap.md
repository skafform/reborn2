# Roadmap

**Position actuelle : étapes 1 à 6a faites — le socle est complet.**
Voir [etat.md](etat.md) pour la marche à suivre en reprenant le travail.

Le détail des décisions techniques vit dans
[architecture/overview.md](architecture/overview.md).

## Le socle réutilisable

Rien dans ces étapes ne parle de CMS. C'est la partie extractible, dont la
frontière se marque par le tag `socle-v0`.

### 1 — Squelette ✅

Hono, TypeScript exécuté nativement, `@hono/zod-openapi`, validation
d'environnement au démarrage.

### 2 — Authentification ✅

Better-Auth sur `pg.Pool` direct. Confirmation d'adresse obligatoire,
réinitialisation de mot de passe.

### 3 — Multi-tenant et autorisation ✅

Organizations, projets, environnements, rôles personnalisables par
organization, catalogue de permissions. Tables sous RLS **activé et forcé**,
point de passage `withContext`.

### 4 — Permissions appliquées ✅

`can()`, garde-fous d'escalade de privilèges, middleware, routes de gestion.
Refus en 404 quand ça cache quelque chose, 403 sinon.

### 5 — Invitations et emails ✅

Jeton haché, email verrouillé, usage unique, annulation, plafond par
organization. Gabarits d'email maison, prévisualisation sur `/dev/emails`.

### 6a — Clés API ✅

Publique, preview et secrète, **par environnement** ([ADR 0013](adr/0013-cles-api-rattachees-a-un-environnement.md)).
Stockage asymétrique : les deux premières consultables, la secrète hachée.

**C'est ici que se pose le tag `socle-v0`.**

## Le CMS

### 6b — Schémas de contenu et documents

La prochaine étape. Trois décisions à prendre d'abord, listées dans
[architecture/decisions-ouvertes.md](architecture/decisions-ouvertes.md) :
quand la validation s'applique, versionnage des schémas, références entre
documents.

### 7 — API de livraison de contenu

Lecture publique façon CDN. **En GET avec paramètres d'URL uniquement**, sous
peine de perdre toute possibilité de cache ([cache.md](architecture/cache.md)).

### 8 — Admin UI

Dépôt séparé ([ADR 0005](adr/0005-depots-separes-contrat-openapi.md)), client
typé généré depuis la spec OpenAPI.

## Plus tard

Assets, webhooks, environnements réels, localisation, recherche, SSO, quotas —
toutes ont leur **couture** déjà posée, aucune ne demande de travail
aujourd'hui. Voir
[architecture/evolutions-prevues.md](architecture/evolutions-prevues.md).
