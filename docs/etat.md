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

⚠️ **Le tag se pousse avec `git push --follow-tags`** — `git push` seul le
laisse derrière.

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
| `GET …/projects/{pid}` | visibilité du projet — 404 sinon |
| `GET …/projects/{pid}/me` | jumeau de `/me`, mais **dans ce projet** |
| `GET …/projects/{pid}/members` | `member.read` — donc pas les membres du projet eux-mêmes |
| `GET`/`POST …/projects/{pid}/invitations` | `member.manage` — le `projectId` vient de l'URL |
| `GET`/`POST …/projects/{pid}/api-keys` | `apikey.manage`, vérifié par le service |
| `POST …/api-keys/{id}/revoke`, `DELETE …/api-keys/{id}` | idem — et la suppression exige la révocation |

`/me` existe parce que **le nom du rôle ne suffit pas** : les rôles sont
personnalisables par organization, donc « viewer » ne garantit rien — et
déduire les permissions d'un nom côté client recopierait la matrice RBAC hors
de son unique source de vérité.

Son jumeau par projet existe pour une raison de plus : `can()` **exige la
cible** pour une portée projet. La réponse dépend donc du projet regardé, ce
qu'une seule route au niveau de l'organization ne peut pas dire.

⚠️ `GET /organizations` ne renvoie plus le nom du rôle. Il ne servait à rien, et
n'aurait aucun sens pour un membre de projet — trois projets, trois rôles
possibles, aucun au niveau de l'organization.

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
**valide chaque réponse**. Plus une seule forme écrite à la main.

**Dans les deux sens** : `postJson` prend le schéma du corps, et le corps est
typé par lui. Orval les générait déjà, ils dormaient inutilisés. Un champ
renommé côté serveur casse donc aussi le typecheck **à l'envoi**.

Les filets, éprouvés plutôt qu'affirmés :

| Situation | Ce qui se passe |
|---|---|
| Réponse — fichier à jour | le typecheck de la console **échoue**, en nommant le champ |
| Réponse — fichier périmé | la validation échoue à l'exécution, en nommant le champ |
| Corps — champ mal nommé | `TS2561: 'rolId' does not exist in type …` |
| Corps — valeur mal formée | `email: Invalid email address ; roleId: Invalid UUID` |

⚠️ **Aucune route ne doit renvoyer `z.any()`** — les trois qui le faisaient ont
été décrites. Ce n'est plus une imprécision de documentation, c'est un trou
dans la validation de la console.

⚠️ **Un corps refusé s'affiche, une réponse hors contrat non.** `displayableError`
est le seul endroit qui tranche : une saisie invalide donne un bandeau, une
réponse hors contrat remonte bruyamment à l'`ErrorBoundary` — c'est un défaut à
corriger, pas une situation à présenter poliment.

**Ce qui reste ouvert** : les chemins d'appel (une chaîne, qu'un client Orval
complet fermerait — écarté), et le fait que **la console n'a aucun test**
([backlog 0012](backlog/0012-la-console-n-a-aucun-test.md)) : la validation ne
se déclenche que sur les écrans ouverts à la main.

## Il y a une CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Avant elle, les 113
tests, les deux typechecks et les deux lints n'avaient jamais tourné ailleurs
que sur une machine de développement.

| Job | Ce qu'il fait |
|---|---|
| `backend` | Postgres 17 en service, `db:bootstrap`, les deux migrations, tests, typecheck, lint — puis la vérification du contrat |
| `console` | typecheck, lint, build |

⚠️ **La vérification du contrat démarre vraiment le backend** et récupère la
spec par HTTP. Régénérer depuis la copie commitée aurait été bien plus simple,
et aurait laissé passer précisément l'oubli d'`api:sync` qu'elle prétend
attraper — voir [architecture/api.md](architecture/api.md#les-cinq-étapes).

C'est pourquoi elle partage le job du backend : la base est déjà là. Effet de
bord utile — `db:bootstrap` s'exécute à chaque fois, seule preuve automatique
que le provisionnement d'un environnement neuf fonctionne encore.

Éprouvé localement dans les deux sens avant d'être commité : `api:sync` sur un
backend inchangé réécrit les fichiers **à l'identique** (sans quoi la CI serait
rouge en permanence), et resserrer une borne de validation côté serveur la fait
échouer en nommant le champ.

### En cours : la page de projet

La section Projects est un contenant vide — une table à une seule colonne, dont
les lignes ne mènent nulle part. Deux routes seulement existent : lister,
créer.

**Décidé** : cliquer un projet y entre, et la barre latérale devient
**contextuelle** — on quitte `Inbox / Projects / Team` de l'organization pour
`Project overview / Team` du projet. Un fil d'Ariane ramène en arrière.

Et l'invitation à un projet se fait **depuis la Team du projet**, jamais depuis
celle de l'organization : le `project_id` vient de l'URL, pas d'un menu.

Le parcours d'un membre de projet est décrit dans
[architecture/multi-tenant.md](architecture/multi-tenant.md#un-membre-de-projet-na-pas-dorganization--et-ça-ne-se-voit-pas).
Le backend le porte déjà en grande partie — `project_members`, les rôles de
portée projet, les invitations avec `project_id`, et `resolveActor` qui bascule
sur une portée projet. Ce qui manque est du **listage**, pas du modèle.

✅ **Le défaut qui bloquait est corrigé** — la portée d'un rôle n'était pas
vérifiée à l'invitation ([backlog 0013](backlog/0013-portee-de-role-non-verifiee.md)).
Un rôle de projet invité sans projet devenait une adhésion d'organization, ses
permissions valant sur *tous* les projets. Reproduit, puis fermé par trois
tests écrits avant la correction. Refus en **422** : bien formée, mais
incohérente — Zod occupe déjà le 400.

✅ **Le backend est fait** (migration 0023). Les trois pièges annoncés se sont
tous produits, et sont fermés :

- **L'organization hôte n'apparaissait pas** — `listOrganizationsForUser` ne
  joignait que `organization_members`. Elle fait maintenant l'union des deux
  appartenances, avec un `order by` explicite : la racine de la console entre
  dans la *première*, et une union ne promet aucun ordre
- ⚠️ **`app_is_member_of` n'a pas été élargie** — 11 usages, 6 migrations. Une
  fonction distincte, `app_is_project_member_of_org`, et une branche par policy
- **La liste des projets répondait 403** — la garde exigeait `content.read`
  sans projet cible. Il n'y a plus de garde en tête : **la liste est le
  filtre**, `can(actor, "content.read", projet)` appliqué par projet

✅ **La console est faite** aussi. La barre latérale est **contextuelle** :
entrer dans un projet la remplace par `Overview` / `Team`, avec un retour
explicite en tête — on peut arriver par une adresse collée, sans historique.

Techniquement, deux mises en page sœurs sous une même coque plutôt qu'une barre
qui saurait tout faire : `organization.tsx` ne porte que la barre du haut, et
chaque coque en dessous charge ce dont la sienne a besoin. L'alternative
obligeait le parent à lire l'état de son enfant pour savoir quoi afficher.

⚠️ **Le recrutement d'un projet se fait dans le projet** :
`POST …/projects/{pid}/invitations`, dont le corps n'a **pas** de `projectId` —
il vient de l'URL. Et `InvitationInput` au niveau de l'organization l'a perdu :
la combinaison incohérente n'est plus seulement refusée, elle n'est plus
exprimable.

Les deux listes d'invitations en attente sont **séparées** — celles d'un projet
n'apparaissent plus dans l'équipe de l'organization, où personne ne les a
envoyées.

### Les clés API — fait

Quatre routes sous `…/projects/{pid}/api-keys` et une section dans la page de
projet. Les services existaient déjà tous et n'avaient jamais servi.

**Une liste nommée** par type, pas un triplet figé. La raison est
la rotation sans coupure — avec un seul emplacement, remplacer une clé impose
de révoquer puis créer, et le site est cassé entre les deux. Détail et
correction de la documentation dans
[architecture/api.md](architecture/api.md#clés-api).

L'écran range les clés en **trois sections**, une par type, chacune avec sa
propre action. Adressage `…/projects/{pid}/api-keys` : le serveur résout
`master`, la console n'entend jamais parler d'environnements.

⚠️ **Rien ne consomme encore une clé.** `resolveApiKey` n'est appelé que par
ses tests, et aucune route ne s'authentifie par clé — c'est l'étape 7. On livre
donc de quoi créer et révoquer des clés qui n'ouvrent encore rien.

⚠️ **Pas de lecture seule** sur cette page : les clés publique et preview sont
stockées en clair, donc les voir c'est les avoir. `apikey.manage` gouverne la
section entière — `owner` et `admin` seulement, aucun rôle de projet.

Trouvé en chemin : `onError` ne connaissait que deux des trois classes
d'erreur, donc **toute `ApiKeyError` remontait en 500** — le 409 « révoquer
avant de supprimer » compris. Corrigé, et couvert par un test.

Et `listApiKeys` ne sélectionne plus `last_used_at` : rien ne l'écrit avant
l'étape 7, et le renvoyer aurait mis dans la spec un champ qui ne peut dire
qu'une seule chose.

### La gestion des adhésions — faite

Retirer, suspendre, réactiver, changer de rôle, et quitter de soi-même — au
niveau de l'organization comme du projet. Avant ça, **personne ne pouvait
retirer personne** : une fois entré, on y restait.

⚠️ **Adhésion, pas compte.** Un admin d'organization ne touche jamais à la
table `user` : il effacerait l'accès de la personne à sa propre organization
personnelle et à toutes les autres où elle travaille. Ce n'est pas du
vocabulaire, c'est une frontière de pouvoir.

La matrice de qui peut retirer qui est **déjà écrite** — symétrique de celle de
l'invitation, et `canAssignRole` en est le miroir déjà construit. Détail dans
[architecture/roles-permissions.md](architecture/roles-permissions.md#retrait-dun-membre).

Les trois pièges annoncés étaient réels, et sont fermés :

- **La console ne peut pas déduire la matrice.** `GET …/members` renvoie
  **par membre** un `manageable`, calculé par le garde-fou qui refuserait
  ensuite — même procédé qu'`assignable` sur `GET …/roles`
- **Le trigger du dernier `owner` est différé.** Vérifié par une sonde : le
  `DELETE` réussit, l'exception sort **au commit**, code `23001`. Un `.catch()`
  sur l'instruction n'aurait rien vu. Le refus est traduit autour de
  `withContext`, et un test épingle le 409
- **Suspendre le seul `owner` l'aurait orphelinée.** Le trigger compte
  désormais les propriétaires **actifs**

Et un quatrième, trouvé en chemin : quatre classes d'erreur avaient pris la
même forme, et `onError` en avait déjà oublié une — **chaque refus des clés API
remontait en 500**. Elles partagent maintenant une base `ServiceError`, et
`onError` fait un seul `instanceof` : la cinquième ne pourra pas être oubliée.

La suspension se lit à la **résolution du grant**, jamais dans `can()` : une
suspension n'est pas une permission en moins, c'est une adhésion qui ne compte
plus. Le point de vérification unique reste intact, et aucune policy RLS ne
change.

### Ensuite

**Gestion des rôles personnalisés** — `role.manage` est dans le catalogue et
l'[ADR 0011](adr/0011-roles-personnalises-par-organization.md) les prévoit,
mais **rien n'est construit** : ni créer un rôle, ni modifier ses permissions.

⚠️ Correction d'un ordre annoncé à l'envers : changer le rôle de quelqu'un ne
suppose **pas** de savoir en définir. Les rôles système existent dans toute
organization dès sa création — les adhésions passent donc devant.

**Compléter l'API au fil de l'eau**, quand un écran révèle un manque.

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
| [0012](backlog/0012-la-console-n-a-aucun-test.md) | La console n'a aucun test | Avec la CI — les deux se décident ensemble |

Dix items clos.

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
