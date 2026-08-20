# Où en est le projet

**Dernière mise à jour : 2026-08-20.** Point d'entrée pour reprendre le
travail : où on en est, ce qui reste, par quoi commencer.

## Le socle est complet et commité

Étapes 1 à 6a de la [feuille de route](roadmap.md). **89 tests au vert**,
typecheck et lint propres. Commit `de5e593`, marqué par le tag **`socle-v0`**.

| | |
|---|---|
| Serveur | Hono + `@hono/zod-openapi`, validation d'environnement au démarrage |
| Authentification | Better-Auth sur `pg.Pool`, confirmation d'adresse obligatoire, réinitialisation |
| Multi-tenant | 10 tables sous RLS **activé et forcé**, point de passage `withContext` |
| Autorisation | Rôles personnalisables par organization, 16 permissions, `can()`, garde-fous |
| Invitations | Jeton haché, email verrouillé, usage unique, plafond par organization |
| Emails | Gabarits maison sans dépendance, prévisualisation sur `/dev/emails` |
| Clés API | Publique · preview · secrète, par environnement |

⚠️ **8 commits et le tag attendent `git push --follow-tags`.**

## En cours : la console d'administration

**Décision prise avant l'étape 6b** : construire l'interface d'administration
d'abord, pour éprouver ce qui existe.

La raison n'est pas de « voir le résultat » : rien de ce qui a été construit
n'a jamais servi à un humain, et les tests ont été écrits contre l'API telle
qu'on l'a faite, pas contre ce dont une interface a besoin. Indice concret —
seules **quatre routes** existent, alors que le travail des étapes 4 à 6a
suppose d'en exposer bien davantage.

Ça éprouvera aussi l'[ADR 0005](adr/0005-depots-separes-contrat-openapi.md),
dont la stratégie OpenAPI → client typé n'a **jamais été essayée**.

### Décisions prises

| | |
|---|---|
| Emplacement | `console/` — **un serveur distinct**, réuni au backend dans un seul git par commodité de sauvegarde. Le dépôt est un contenant, pas une frontière d'architecture |
| Framework | React Router **8.3**, React 19.2.7+ |
| Rendu | **SPA** (`ssr: false`) — la session est un cookie que le navigateur envoie à l'API ; un serveur intermédiaire n'ajouterait qu'un relais de cookie |
| CORS | **Aucun en développement** : un proxy Vite renvoie `/api` vers `localhost:3000`, rendant chaque requête *same-origin*. Le CORS réel n'aura lieu qu'en production, entre sous-domaines ([backlog #0004](backlog/0004-cors-admin-ui.md)) |
| Design | Repris de `C:\Users\mario\Documents\projets\skafform-reborn\Console\app\console.css` — inspiré de Linear. Sans framework CSS, jetons portés par `.console` et non `:root`, mode sombre, accent ambre |
| Outillage | pnpm, Biome (même configuration que le backend), TypeScript strict |

⚠️ **Un seul git ne fait pas un dépôt commun.** Les deux projets sont
**agnostiques l'un de l'autre** : le backend ignore qu'une console existe, la
console ne connaît de lui qu'une adresse HTTP et un contrat. **Rien ne traverse
la frontière** — ni import, ni workspace, ni chemin de fichier, y compris pour
la spec OpenAPI. La conclusion de l'[ADR 0005](adr/0005-depots-separes-contrat-openapi.md)
est donc intacte ; **seule sa description de la disposition reste à corriger.**

### Où en est le scaffold

Installé, et **il sert une page** — vérifié : `GET /` répond 200, et
`GET /api/auth/get-session` traverse le proxy jusqu'au backend.

```
console/package.json             react-router 8, react 19, biome, vite 8
console/react-router.config.ts   ssr: false, avec sa justification
console/vite.config.ts           proxy /api -> API_PROXY_TARGET, validée
console/.env.example             API_PROXY_TARGET (.env n'est pas commité)
console/tsconfig.json            strict, jsx react-jsx, types RR générés
console/biome.json               du backend, plus l'exclusion de .react-router
                                 et l'interdiction d'importer hors de app/
console/app/root.tsx             Layout, ErrorBoundary, HydrateFallback
console/app/routes.ts            une seule route
console/app/routes/home.tsx      écran d'amorce : l'API répond-elle ?
console/app/console.css          jetons sur .console, et rien de plus
```

Corrections faites en chemin : `biome.json` lintait les types générés par
React Router ; `pnpm start` appelait `react-router-serve`, absent des
dépendances **et** inadapté à un build statique — remplacé par `pnpm preview` ;
`react-router typegen` a ajouté `isbot`, dont le mode SPA a réellement besoin
pour préfabriquer `index.html` ; et le proxy affirmait en dur où vit le
backend, ce qui violait à la fois l'agnosticisme et la règle « aucune valeur en
dur ».

**La frontière est tenue mécaniquement, pas par discipline** :
`noRestrictedImports` sur `../../**` refuse tout import sortant de `app/`.
Vérifié : la règle rejette `../../../backend/src/app.ts` et laisse passer
`../console.css`.

`API_PROXY_TARGET` est **exigée sans valeur de repli** — une cible par défaut
ferait démarrer la console en pointant silencieusement ailleurs. Cinq cas
vérifiés : `build` et `preview` passent sans elle, `dev` refuse sans elle,
`dev` refuse une URL malformée en la nommant, et `dev` avec elle joint le
backend de bout en bout.

`app/routes/home.tsx` est **temporaire par construction** : il ne sert aucun
parcours, il répond à la seule question qu'on ne peut pas trancher en lisant du
code — est-ce que la console joint l'API ? Il disparaît dès que le premier
parcours prend sa place.

### Le premier parcours est fait

**S'inscrire → confirmer l'adresse → créer une organization → inviter.** Choisi
parce qu'il traverse l'authentification, les rôles et les emails d'un coup.

Écrans : `signup`, `login`, `verify-email`, l'accueil (organizations),
`org/:organizationId/invite`. Le client d'authentification est
`better-auth/react` — les routes de Better-Auth sont **volontairement hors de
notre spec OpenAPI**, donc aucun client généré ne les couvrira jamais ; les
appeler au `fetch` nu reviendrait à recopier leur contrat à la main.

Vérifié de bout en bout, serveurs en marche : inscription 200 sans session
(`token: null`), lien de confirmation → 302 vers la console avec cookie
`HttpOnly; SameSite=Lax`, création d'organization, liste des rôles, invitation
201, invitation listée puis annulable.

**La route que l'écran a révélée** : `GET /organizations/{id}/roles`, gardée par
`member.manage` — elle sert à *attribuer* un rôle, pas à en définir un. Trois
tests l'accompagnent, dont le 404 réservé à l'étranger.

**Le contrôle d'origine de Better-Auth**, lui, a été vérifié plutôt que
supposé : origine déclarée → 200, origine inconnue → **403 `INVALID_ORIGIN`**.
D'où `TRUSTED_ORIGINS` côté backend. ⚠️ Le proxy Vite reporte le CORS du
navigateur, **pas** ce contrôle-là — ce sont deux mécanismes distincts.

### Par quoi continuer

1. **Accepter une invitation.** Le lien envoyé pointe sur
   `${PLATFORM_URL}/invitations/accept?token=…`, et `PLATFORM_URL` vaut
   aujourd'hui l'adresse du **backend**, qui n'a pas cette page. C'est la
   console qui doit l'avoir : `PLATFORM_URL` désigne l'endroit où vont les
   humains, donc `http://localhost:5173` en développement
2. Compléter l'API **au fil de l'eau**, quand un écran révèle un manque

### Deux défauts réparés en chemin

Découverts en voulant effacer les données d'un essai — pas par un test.

**[0010](backlog/0010-suppression-d-organization-bloquee.md)** : une
organization ne pouvait **pas** être supprimée, du tout. La cascade vers
`roles` heurtait le garde-fou des rôles système, qui ne distinguait pas « on
supprime un rôle » de « son organization disparaît ». Corrigé par la migration
`0019`, avec l'idiome que `protect_last_owner` employait déjà : demander si
l'organization existe encore. Aucun mécanisme nouveau.

**[0011](backlog/0011-nettoyage-des-tests-avale-ses-erreurs.md)** : les
`after()` des tests terminaient par `.catch(() => {})`. Le nettoyage échouait
depuis toujours, en silence — **305 organizations, 605 comptes, 230 invitations
et 98 projets** accumulés. Remplacé par `src/test-support/cleanup.ts`, partagé
et bruyant. Une suite complète laisse maintenant la base exactement comme elle
l'a trouvée, vérifié.

Le nettoyage **est** désormais le test de non-régression de 0010 : si la
suppression se recasse, les cinq suites tombent au lieu de se taire.

### Base de développement

Purgée. Il reste la table `permissions` — vocabulaire commun alimenté par
migration — dont les **16 clés correspondent exactement** au catalogue de
`src/config/permissions.ts`, vérifié par comparaison.

`roles` et `role_permissions` sont **par organization** : vides tant qu'il n'y
en a aucune, c'est leur état normal. Sur une organization neuve, les six rôles
système sont semés au complet — `owner` 16 permissions, `admin` 11, `viewer` 3,
`editor` 5, `contributor` 4, `guest` 3 — conformes à `SYSTEM_ROLES`.

### Routes API manquantes, déjà identifiées

Le service existe, la route non : lister les membres, changer un rôle, retirer
un membre, créer et modifier un rôle personnalisé, supprimer un projet,
renommer une organization, gérer les clés API.

## Étape 6b — là où le CMS commence

`schemas`, `documents`, API de livraison. **Trois décisions à prendre avant**,
détaillées dans [architecture/decisions-ouvertes.md](architecture/decisions-ouvertes.md) :
quand la validation s'applique, versionnage des schémas, références entre
documents.

Rappels structurants :

- `documents` porte déjà `locale` et `translation_group_id`
- Le contenu est rattaché à `environment_id`, jamais à `project_id`
- L'API de lecture reste en **GET avec paramètres d'URL** — sinon plus de cache
- Toute écriture passe par un **point d'émission d'événements unique**

## Backlog ouvert

| # | Item | Quand |
|---|---|---|
| [0004](backlog/0004-cors-admin-ui.md) | CORS pour l'admin UI | En production seulement — le proxy le règle en développement |
| [0008](backlog/0008-resolution-des-projets-d-un-membre.md) | Résolution des projets d'un membre | À mesurer avant d'agir |

Neuf items clos.

## Pièges à ne pas redécouvrir

- **Une policy RLS ne référence jamais une autre table sous RLS** — cycle
  refusé par Postgres, et `SECURITY DEFINER` n'y change rien puisque `FORCE`
  soumet aussi le propriétaire
- **Une migration de données sous RLS doit lever `FORCE`** — sinon elle ne
  touche aucune ligne, silencieusement, et si elle échoue entre-temps la table
  reste sans protection
- **`@better-auth/cli` génère un schéma périmé** — utiliser
  `scripts/migrate-auth.ts`
- **drizzle-kit génère parfois un ordre invalide** — contrainte unique après la
  clé étrangère qui en dépend
- **Définir `onError` sur Hono retire son traitement par défaut**
- **Les rôles Postgres appartiennent au cluster**, pas à la base
- **Le mailer réel ne s'installe qu'au démarrage du serveur** — un import ne
  doit jamais pouvoir expédier un email
- **En mode SPA, `react-router build` démarre un serveur `preview`** pour
  préfabriquer `index.html` : un `command === "serve"` a donc lieu au milieu
  d'un build. Et `isPreview` ne permet pas de les distinguer — Vite évalue
  `vite.config.ts` **deux fois par phase**, et la seconde évaluation ne reçoit
  pas le drapeau. Seul `mode` est stable sur les quatre appels

Détail dans [CLAUDE.md](../CLAUDE.md) et
[architecture/securite.md](architecture/securite.md).
