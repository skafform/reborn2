# Où en est le projet

**Dernière mise à jour : 2026-08-21.** Point d'entrée pour reprendre le
travail : où on en est, ce qui reste, par quoi commencer.

## Le socle est complet et commité

Étapes 1 à 6a de la [feuille de route](roadmap.md). **113 tests au vert**,
typecheck et lint propres des deux côtés. Le tag **`socle-v0`** marque la
frontière du socle réutilisable (commit `de5e593`).

| | |
|---|---|
| Serveur | Hono + `@hono/zod-openapi`, validation d'environnement au démarrage |
| Authentification | Better-Auth sur `pg.Pool`, confirmation d'adresse obligatoire, réinitialisation |
| Multi-tenant | 10 tables sous RLS **activé et forcé**, point de passage `withContext` |
| Autorisation | Rôles personnalisables par organization, 17 permissions, `can()`, garde-fous |
| Invitations | Jeton haché, email verrouillé, usage unique, plafond par organization, Inbox |
| Emails | Gabarits maison sans dépendance, prévisualisation sur `/dev/emails` |
| Clés API | Publique · preview · secrète, par environnement |

⚠️ **14 commits et le tag attendent `git push --follow-tags`.**

## En cours : la console d'administration

**Décision prise avant l'étape 6b** : construire l'interface d'administration
d'abord, pour éprouver ce qui existe.

La raison n'est pas de « voir le résultat » : rien de ce qui a été construit
n'a jamais servi à un humain, et les tests ont été écrits contre l'API telle
qu'on l'a faite, pas contre ce dont une interface a besoin. Indice concret —
seules **quatre routes** existent, alors que le travail des étapes 4 à 6a
suppose d'en exposer bien davantage.

Ça a aussi éprouvé l'[ADR 0005](adr/0005-depots-separes-contrat-openapi.md) :
sa stratégie OpenAPI → client généré est désormais **en place**, après avoir
été la partie jamais essayée de la décision.

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
la spec OpenAPI, qui se récupère par HTTP. La conclusion de
l'[ADR 0005](adr/0005-depots-separes-contrat-openapi.md) est intacte, et sa
description de la disposition a été corrigée.

### Ce que la console fait aujourd'hui

**Écrans d'entrée**, hors coque — `signup`, `login`, `verify-email`,
`invitations/accept` (où mène le lien du courriel), `new-organization`.

**La coque**, sous `org/:organizationId` — barre du haut avec le sélecteur
d'organization, barre latérale (`Inbox`, `Projects`, `Team`), panneau flottant.
Elle porte le **contrôle de session à un seul endroit** et vérifie que
l'organization du chemin est bien une des siennes.

Le client d'authentification est `better-auth/react` : les routes de
Better-Auth sont **volontairement hors de notre spec OpenAPI**, donc aucun
client généré ne les couvrira jamais — les appeler au `fetch` nu reviendrait à
recopier leur contrat à la main.

**Langue** : l'interface est **entièrement en anglais**. Le backend, lui,
répond en français (message développeur) — jamais affiché tel quel : la console
traduit par le code `reason`, stable, via `apiErrorMessage()`.

**Design** : repris de `skafform-monday-server/console`. Inter auto-hébergée
(48 Ko), échelle typographique resserrée à la Linear — un titre de page se
distingue par le **poids**, pas par la taille. Boutons de texte discrets pour
les actions de ligne et d'en-tête, jamais l'accent. Modales sur `<dialog>`
natif, qui apporte piège de focus et fermeture sur Échap sans code.

**Ce que masquer veut dire** : la coque cache les entrées dont la personne n'a
pas la permission, mais ⚠️ **c'est un confort, jamais le garde-fou** — chaque
route reste vérifiée côté serveur, et les écrans attrapent les refus au lieu de
planter.

### Les routes que les écrans ont révélées

| Route | Garde |
|---|---|
| `GET /organizations/{id}/me` | session — dit à la console ce que la personne peut faire |
| `GET /organizations/{id}/members` | `member.read` |
| `GET /organizations/{id}/roles` | `member.manage` — sert à *attribuer*, pas à définir |
| `GET /inbox`, `POST /inbox/{id}/accept` | session — par adresse, tous locataires confondus |

`/me` existe parce que **le nom du rôle ne suffit pas** : les rôles sont
personnalisables par organization, donc « viewer » ne garantit rien — et
déduire les permissions d'un nom côté client recopierait la matrice RBAC hors
de son unique source de vérité.

### Deux mécanismes vérifiés plutôt que supposés

**Le contrôle d'origine de Better-Auth** : origine déclarée → 200, origine
inconnue → **403 `INVALID_ORIGIN`**. D'où `TRUSTED_ORIGINS`. ⚠️ Le proxy Vite
reporte le CORS du navigateur, **pas** ce contrôle-là — deux mécanismes
distincts.

**`API_PROXY_TARGET` est exigée sans valeur de repli** — une cible par défaut
ferait démarrer la console en pointant silencieusement ailleurs. Cinq cas
vérifiés : `build` et `preview` passent sans elle, `dev` refuse sans elle,
`dev` refuse une URL malformée en la nommant, et `dev` avec elle joint le
backend de bout en bout.

**La frontière entre les deux projets est tenue mécaniquement** :
`noRestrictedImports` sur `../../**` refuse tout import sortant de `app/`.
Vérifié — la règle rejette `../../../backend/src/app.ts` et laisse passer
`../console.css`.

### Routes API manquantes, déjà identifiées

Le service existe, la route non : changer un rôle, retirer un membre, créer et
modifier un rôle personnalisé, supprimer un projet, renommer une organization,
gérer les clés API.

### Le contrat est généré, plus recopié

La console tirait ses types **à la main** — et la dérive avait commencé sans
que rien ne la signale : `Member` y comptait cinq champs quand le serveur en
envoyait six. Reproduit pour de vrai — renommer un champ côté serveur laissait
les deux typechecks **au vert** et vidait une colonne à l'écran.

Désormais : `pnpm api:sync` récupère `/openapi.json` **par HTTP**, Orval en
génère des schémas **Zod 4 Mini**, les types viennent de `z.infer`, et `api()`
**valide chaque réponse**. Plus une seule forme de réponse écrite à la main.

Les deux filets, éprouvés en rejouant le renommage :

| Situation | Ce qui se passe |
|---|---|
| Fichier à jour | le typecheck de la console **échoue**, en nommant le champ |
| Fichier périmé | la validation échoue à l'exécution, en nommant le champ |

⚠️ **Aucune route ne doit renvoyer `z.any()`** — les trois qui le faisaient ont
été décrites. Ce n'est plus une imprécision de documentation, c'est un trou
dans la validation de la console.

⏳ **Reste à faire** : la vérification en CI (régénérer + `git diff
--exit-code`), qui attraperait l'oubli de `api:sync` dans la PR. Il n'existe
aucune CI aujourd'hui. Détail dans
[architecture/api.md](architecture/api.md#comment-la-console-dérive-son-client--fait).

### Par quoi continuer

**1. Les clés API** — les services existent tous (`listApiKeys`,
`createApiKey`, `revokeApiKey`, `deleteApiKey`), seules les routes HTTP
manquent. C'est là que le **bloc `.env`** de la console de référence prend son
sens : trois clés à recopier dans le fichier d'un frontend.

**2. Compléter l'API au fil de l'eau**, quand un écran révèle un manque.

**3. La vérification en CI** du contrat généré (voir plus haut).

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
