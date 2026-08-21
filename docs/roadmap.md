# Roadmap

**Position actuelle : étapes 1 à 6a faites — le socle est complet — et
l'étape 8 (admin UI) devancée, en cours.** L'étape 6b, où le CMS commence,
n'est pas entamée. Voir [etat.md](etat.md) pour la marche à suivre en
reprenant le travail.

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

### 8 — Admin UI · **commencée avant son tour**

`console/` — un serveur distinct, réuni au backend dans un seul git par
commodité de sauvegarde. Voir [etat.md](etat.md) pour ce qu'elle fait
aujourd'hui.

**Devancée délibérément**, avant l'étape 6b : rien du socle n'avait jamais
servi à un humain, et les tests étaient écrits contre l'API telle qu'on l'avait
faite, pas contre ce dont une interface a besoin. Le pari a payé — construire
les écrans a révélé des routes manquantes, deux défauts que les tests ne
voyaient pas ([backlog 0010](backlog/0010-suppression-d-organization-bloquee.md)
et [0011](backlog/0011-nettoyage-des-tests-avale-ses-erreurs.md)), et un
découpage de permission trop grossier.

Le pari a payé une fois de plus sur le typage : la console tirait ses types à
la main, et la dérive annoncée par
l'[ADR 0005](adr/0005-depots-separes-contrat-openapi.md) avait commencé sans
que rien ne la signale. Le client généré depuis la spec — la partie la plus
incertaine de la disposition en deux serveurs — est désormais **en place et
éprouvé** ([architecture/api.md](architecture/api.md#comment-la-console-dérive-son-client--fait)).

## Plus tard

Assets, webhooks, environnements réels, localisation, recherche, SSO, quotas —
toutes ont leur **couture** déjà posée, aucune ne demande de travail
aujourd'hui. Voir
[architecture/evolutions-prevues.md](architecture/evolutions-prevues.md).
