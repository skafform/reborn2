# Où en est le projet

**Dernière mise à jour : 2026-08-22.** Point d'entrée pour reprendre le
travail : où on en est, ce qui reste, par quoi commencer.

## Le socle est complet et commité

Étapes 1 à 6a de la [feuille de route](roadmap.md), et beaucoup de socle
depuis : rôles personnalisés, adhésions, routes de clés, chaîne du contrat,
CI. **257 tests au vert**, typecheck et lint propres des deux côtés.

| | |
|---|---|
| Serveur | Hono + `@hono/zod-openapi`, validation d'environnement au démarrage |
| Authentification | Better-Auth sur `pg.Pool`, confirmation d'adresse obligatoire, réinitialisation |
| Multi-tenant | 15 tables sous RLS **activé et forcé**, point de passage `withContext` |
| Autorisation | Rôles personnalisables par organization, 19 permissions, `can()`, garde-fous |
| Invitations | Jeton haché, email verrouillé, usage unique, plafond par organization, Inbox |
| Emails | Gabarits maison sans dépendance, prévisualisation sur `/dev/emails` |
| Clés API | Publique · preview · secrète, par environnement |

⚠️ **Il n'y a plus de tag `socle-v0`, et c'est délibéré.** Il pointait sur
l'étape 6a en affirmant que le CMS commençait après — or vingt-quatre commits
de socle ont suivi. Un tag est une **photo** : il ne bouge pas, donc il cesse
de décrire ce qu'il nomme dès que le travail continue.

Le seul point de coupe qui ne périmera pas est le **dernier commit avant le
premier fichier de CMS**. Il n'existe pas encore : c'est au début de l'étape 6b
qu'il se taguera.

⚠️ Et un tag ne garantit rien. Il répond à *« où couper ? »*, jamais à
*« est-ce encore coupable ? »* — la seconde question ne se règle que
mécaniquement. La frontière console ↔ backend est tenue par
`noRestrictedImports` parce que la discipline seule n'avait pas suffi ; celle
du socle n'est tenue par rien. Elle ne peut pas l'être aujourd'hui, faute de
module CMS à interdire d'importer. **La règle se pose en même temps que le
tag**, au premier module de 6b.

## En cours : la console d'administration

**Décision prise avant l'étape 6b** : construire l'interface d'administration
d'abord, pour éprouver ce qui existe.

La raison n'est pas de « voir le résultat » : rien de ce qui a été construit
n'a jamais servi à un humain, et les tests ont été écrits contre l'API telle
qu'on l'a faite, pas contre ce dont une interface a besoin. Indice concret : au
moment de commencer, **quatre routes** existaient, alors que le travail des
étapes 4 à 6a en supposait bien davantage. Il y en a **41** aujourd'hui, toutes
révélées par un écran.

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
`reset-password`, `invitations/accept` (où mène le lien du courriel),
`new-organization`.

**Connexion par GitHub.** Les identifiants sont **facultatifs mais appariés**
par déploiement, d'où `GET /api/auth-providers` : la console demande au serveur
quels boutons afficher plutôt que de le supposer. Détail et pièges dans
[auth.md](architecture/auth.md#oauth--github-construit-google-prévu).

**La coque**, sous `org/:organizationId` — barre du haut avec le sélecteur
d'organization à gauche et le menu de compte à droite, barre latérale
(`Inbox`, `Projects`, `Team`, `Roles`, `Settings`), panneau flottant. Elle
porte le **contrôle de session à un seul endroit** et vérifie que
l'organization du chemin est bien une des siennes.

**L'écran de compte**, `org/:organizationId/account` — nom modifiable, adresse
en lecture seule, mot de passe, et **comptes liés**. ⚠️ **Une seule route du
backend y participe**, celle des fournisseurs : Better-Auth sert déjà
`/update-user`, `/change-password`, `/list-accounts`, `/link-social` et
`/unlink-account`, et son client publié *est* leur contrat.

Sans mot de passe — un compte arrivé par GitHub seul — la section propose de
s'en envoyer un par courriel plutôt qu'un formulaire : `setPassword` est
`serverOnly` chez Better-Auth, et le lien de réinitialisation **crée** le
compte credential absent.

Le compte n'appartient à aucune organization, mais toute la coque vit sous
`org/:id` — même compromis que l'Inbox. D'où **aucune entrée dans la barre
latérale** : on y arrive par l'avatar, ce qui dit que ce n'est pas une section
de l'organization et laisse l'identifiant n'être que de la plomberie.

⚠️ **Changer d'adresse reste hors périmètre** — une invitation en attente est
appariée sur l'adresse exacte, et les deux divergeraient
([auth.md](architecture/auth.md)). **Supprimer son compte** l'est aussi, et ce
n'est pas un écran manquant mais une décision non prise : que devient la
dernière `owner` d'une organization, que le trigger `protect_last_owner`
refusera de laisser partir ?

**Les écrans de réglages** — une organization et un projet ont chacun le leur.
Nom, description, et une zone dangereuse qui **liste ce qui bloque avant le
clic** plutôt que d'échouer après.

L'organization porte en plus l'adresse de facturation, avec **un seul bouton
*Save*** : le champ est facultatif dans le corps — absent il n'est pas touché
et `org.settings` suffit, présent il exige `org.billing` en plus. C'est ce qui
permet un enregistrement unique sans confondre deux clés.

⚠️ **Rien de tout ça n'était atteignable jusqu'ici** : renommer et supprimer
existaient côté serveur, gardés et testés, sans aucun écran pour les appeler.

**Les avatars** sont des identicons à la GitHub — grille 5×5 miroir, teinte
tirée de la même graine, calculés côté client. Rien n'est demandé au réseau :
Gravatar enverrait à un tiers le hachage de l'adresse d'un client à chaque
chargement. ⚠️ La graine est l'**identifiant du compte**, jamais l'adresse —
sans quoi le visage changerait le jour où l'adresse change.

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
| `GET /auth-providers` | **aucune** — se lit avant d'avoir une session, c'est son objet |
| `PUT /organizations/{id}` | `org.settings` — nom et description |
| `GET …/billing` | `org.billing` — l'écriture voyage avec les réglages, la lecture non |
| `PUT …/projects/{pid}` | `project.settings`, pas `org.settings` (migration 0027) |
| `GET /organizations/{id}/me` | session — dit à la console ce que la personne peut faire |
| `GET /organizations/{id}/members` | `member.read` |
| `GET /organizations/{id}/roles` | `member.manage` — sert à *attribuer*, pas à définir |
| `GET /inbox`, `POST /inbox/{id}/accept` | session — par adresse, tous locataires confondus |
| `GET …/projects/{pid}` | visibilité du projet — 404 sinon |
| `GET …/projects/{pid}/me` | jumeau de `/me`, mais **dans ce projet** |
| `GET …/projects/{pid}/members` | `member.read` — donc pas les membres du projet eux-mêmes |
| `GET`/`POST …/projects/{pid}/invitations` | `member.manage` — le `projectId` vient de l'URL |
| `GET`/`POST …/projects/{pid}/api-keys` | `apikey.manage`, vérifié par le service |
| `GET …/schemas/{id}/history` | `schema.read` — lire une lignée est une lecture de schéma |
| `POST …/schemas/{id}/restore` | `schema.write` — restaurer en est une écriture |
| `GET`/`POST `/organizations/{id}/library` | `schema.read` pour lire, `library.write` pour curer |
| `PUT`/`DELETE …/library/{id}`, `…/history`, `…/restore` | idem — la lecture large, l'écriture à sa clé |
| `POST …/projects/{pid}/schemas/copy` | `schema.read` **et** `schema.write` — aucune clé nouvelle |
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

### Décidé pendant l'inventaire d'avant-6b

**Skafform est un service hébergé**, pas un CMS auto-hébergé — la
documentation disait l'inverse depuis le début, et cette phrase masquait une
question jamais posée : un service hébergé a un **exploitant**.

⚠️ **Le modèle n'en portait aucune trace**, et ce n'était pas réparable par une
route : le rôle applicatif est sans `BYPASSRLS`, donc la garantie contre les
fuites entre locataires vaut aussi contre l'exploitant.

**Décision** : l'exploitation est un développement **séparé, en local, jamais
exposé** ([ADR 0015](adr/0015-exploitation-hors-ligne-jamais-dans-l-application.md)).
Rien à construire dans le socle — la décision consiste surtout à *ne pas*
ajouter de chemin transverse à l'application publique. Le raccourci interdit est
celui qu'on prend sans réfléchir : un drapeau `isPlatformAdmin` sur un compte.

Conséquence sur le comptage de l'usage : il doit être **justifiable**, pas
seulement suffisant. Un service hébergé facture.

### Ensuite

**Gestion des rôles personnalisés** — `role.manage` est dans le catalogue et
l'[ADR 0011](adr/0011-roles-personnalises-par-organization.md) les prévoit,
mais **rien n'est construit** : ni créer un rôle, ni modifier ses permissions.

⚠️ Correction d'un ordre annoncé à l'envers : changer le rôle de quelqu'un ne
suppose **pas** de savoir en définir. Les rôles système existent dans toute
organization dès sa création — les adhésions passent donc devant.

**Compléter l'API au fil de l'eau**, quand un écran révèle un manque.

## La frontière du socle est posée

`src/cms/` existe, et une règle Biome interdit à tout le reste de `src/` de
l'importer — **éprouvée dans les deux sens** sur une sonde jetable. Le tag
`avant-cms` marque le dernier commit avant le premier fichier de CMS.

⚠️ **Deux points de composition sont exemptés, nommés** : `src/app.ts` pour le
serveur, `src/test-support/bootstrap.ts` pour un processus de test. Ce n'est
pas une exemption « pour les tests » — un fichier de test n'importe toujours
pas `src/cms/`, il importe le bootstrap.

Ce que la pose a révélé — quatre découvertes, dont un vrai défaut — est dans
[backlog #0014](backlog/0014-frontiere-du-socle.md#4--️-ce-que-poser-la-frontière-a-révélé).

## Étape 6b — commencée

**`schemas` existe.** La table, ses policies, ses routes, son écran — le
premier objet du CMS, et le premier que la frontière garde.

La forme d'une définition n'était spécifiée nulle part ; elle l'est
maintenant, et c'est ce que le hachage figera à l'étape suivante :

| | |
|---|---|
| Cinq scalaires | `text`, `longtext`, `number`, `boolean`, `date` |
| `name` d'un champ | La clé de stockage. Contrainte d'identifiant **dès maintenant** |
| `label` | Facultatif, affichage seul — c'est ce qu'on renomme |
| `validation` | Objet imbriqué, `required` toujours présent |
| L'ordre des champs | **Significatif** : c'est la disposition du formulaire |

⚠️ **`reference` et `asset` sont absents de l'écran, pour des raisons
différentes.** `reference` est **décidé** ([ADR 0020](adr/0020-references-entre-documents.md))
mais naît avec `documents`, à l'étape 4 ; `asset` attend un stockage objet qui
n'existe pas. Les ajouter n'invalidera aucune empreinte.

### Ce qui reste

| | |
|---|---|
| **2** | Versionnage — voir *Par quoi reprendre* ci-dessous |
| **3a** | ✅ `library_schemas` — table, journal, versionnage, routes, écran |
| **3b** | ✅ La copie dans un environnement, et la divergence à trois états |
| **4** | `documents`, et les références **présentes dès sa conception** |

### Par quoi reprendre — l'étape 2, dans cet ordre

⚠️ **La normalisation canonique d'abord, seule, et exhaustivement testée
avant que quoi que ce soit s'en serve.** C'est la seule fonction du projet
dont un bug se paie en invalidant des données clients : elle devient
l'identité de chaque version.

1. ✅ **`src/cms/normalise.ts`** — fait, seul, 26 tests. Ce n'est pas une règle
   maison : c'est **RFC 8785 (JSON Canonicalization Scheme)**, choisi pour que
   le format survive à une réécriture dans un autre langage. Tri des clés par
   **unités de code UTF-16**, ordre des tableaux intact, nombres par ECMA-262
   §7.1.12.1, et **refus** de tout ce que JSON ne porte pas plutôt que la
   coercition silencieuse de `JSON.stringify`.

   ⚠️ **Générique, pas écrit contre `Definition`.** Nommer les champs un par un
   était plus court et sans tri — écarté : le jour où `validation` gagne
   `minLength`, une ligne oubliée laisserait la clé **hors de l'empreinte**.
   Deux schémas différents, un seul hachage, aucun symptôme.

   ⚠️ **Aucune normalisation Unicode**, parce que JCS n'en fait pas : deux
   écritures d'un « é » dans un `label` donnent deux empreintes. Fausse
   divergence, jamais une perte — et c'est ce que le tag rattrape si on change
   d'avis. Sa suite de tests **est la spécification** : un test qui rougit est
   un changement de format, donc un nouveau tag, pas une attente corrigée
2. ✅ **`src/cms/fingerprint.ts`** — fait, 11 tests dont des **vecteurs
   littéraux** : une entrée en clair, un condensé en clair, tous deux vérifiés
   hors du code (`printf … | sha256sum`) avant d'être écrits. C'est ce qui tient
   `normalise.ts` et le tag d'accord, la séparation des deux fichiers étant
   voulue.

   ⚠️ **L'empreinte couvre `name`, `label` et `definition`** — pas la seule
   définition, comme la documentation le laissait entendre. Les deux fonctions
   du versionnage l'exigent : `label` est le champ conçu pour être modifié,
   donc l'exclure protégerait le moins ce qui bouge le plus ; et une copie de
   bibliothèque dont l'agence a localisé un libellé se lirait « identique ».
   Le raisonnement complet est dans
   [content-schemas.md](architecture/content-schemas.md#ce-qui-entre-dans-lempreinte).

   ⚠️ **`label` est ramené à `null` dans `fingerprint.ts`**, jamais dans
   `normalise.ts` : « un libellé absent vaut `null` » est une connaissance du
   domaine schéma, et l'apprendre à la forme canonique la rendrait
   particulière
3. ✅ **`schema_versions`, `schema_history`, `schemas.current_hash`** — faits
   **d'un seul geste** (migration 0029, 10 tests). Les trois ne se séparaient
   pas : une table de versions que rien n'écrit est l'erreur que ce projet
   nomme déjà — « créée, jamais remplie » — et restaurer, c'est déplacer le
   pointeur **et** ajouter une ligne, un déplacement sans ligne étant une
   réécriture silencieuse du journal.

   Chaque invariant conçu est devenu **structurel** : le courant pointe
   toujours sur une version réelle (`NOT NULL` + clé composite), l'historique
   ne nomme jamais une version fantôme (clé composite), l'identité est le
   contenu (pas d'`id` sur les versions). Détail dans
   [content-schemas.md](architecture/content-schemas.md#ce-que-le-modèle-rend-structurel).

   ⚠️ **Deux mécanismes vérifiés plutôt que supposés**, tous deux par un test :
   une colonne d'identité écrite par le rôle applicatif — ni propriétaire, ni
   superuser — et la **cascade qui traverse une table sans policy `DELETE`**.
   Les deux tables n'ont que `SELECT` et `INSERT` : l'immuabilité d'une version
   et le caractère « ajout seul » d'un journal sont vrais, pas promis.

   ⚠️ **Restaurer exige que le journal de *ce* schéma nomme l'empreinte.** Les
   versions étant dédupliquées par organization, aller vers une empreinte que
   ce schéma n'a jamais eue serait une **affectation**, pas une restauration.

   ✅ **L'écran de lignée et ses deux routes sont là** —
   `GET …/schemas/{id}/history` et `POST …/schemas/{id}/restore`. Aucune
   permission nouvelle : lire une lignée est une lecture de schéma, restaurer
   une écriture. Une fonctionnalité entière est arrivée et le vocabulaire n'a
   pas bougé.

**Rien à rattraper** : `select count(*) from schemas` rendait **0**, vérifié
avant d'écrire `current_hash NOT NULL` sans valeur de repli. La version
initiale et sa ligne d'historique font partie de la création.

### L'écran de lignée

Une modale ouverte depuis une ligne de la table des types de contenu : quand,
quoi (`Saved` / `Restored`), qui, l'état nommé, et *Restore* sur tout ce qui
n'est pas le courant.

⚠️ **La lignée ouverte est un paramètre d'URL, pas un état de composant.**
L'ouvrir est une navigation, donc le chargeur la récupère et la restauration
passe par le même `clientAction` que la création et la suppression — pas de
second mécanisme de récupération à côté du premier. Effet secondaire utile :
l'écran devient adressable.

⚠️ **« Deleted user » plutôt qu'une case vide** quand `actor_user_id` est
`NULL`. C'est le `ON DELETE SET NULL` qui fonctionne, pas un défaut — mais un
blanc n'aurait aucune façon de le dire.

⚠️ **Le contrat ne grave pas `sha256-1`.** La borne dit « un tag, puis un
condensé hexadécimal », sans lequel — le tag existe précisément pour changer, et
le graver obligerait à republier le contrat ce jour-là.

### La bibliothèque de schémas — faite

`library_schemas` et son journal (migration 0030), six routes sous
`/organizations/{id}/library`, et un écran dans la barre latérale de
l'organization. Les modèles qu'une organization propose à ses projets.

⚠️ **`schema_versions` est partagée avec les types de contenu**, et ce n'est
pas une économie de table : le diagnostic de divergence demande « le hachage de
la copie est-il dans l'historique de la bibliothèque ? », question qui n'a de
sens que si les deux nomment les mêmes lignes. Le **journal**, lui, est une
seconde table — une clé composite ne pointe que vers une table, et y renoncer
reviendrait à laisser une ligne nommer un schéma fantôme.

⚠️ **`library.write` est une clé nouvelle, `owner` et `admin`** (ADR 0018).
Lire la bibliothèque reste `schema.read` : une clé de lecture de plus ne
réglerait aucun problème qu'on ait. Un test épingle les deux — un `viewer` lit
et ne modifie pas.

⚠️ **Les rôles personnalisés ne reçoivent rien**, contrairement à la migration
0027. Là-bas la clé était *extraite* d'une autre qui portait déjà la capacité ;
ici aucune clé existante ne l'impliquait — `schema.write` délibérément pas.

⚠️ **Le vocabulaire est tranché : « content type » partout dans l'UI**, la
bibliothèque comprise — « Library » reste le nom du *lieu*, ses entrées sont
des content types. « Schema » demeure le mot **technique** : tables, routes
`/schemas`, clés `schema.read`/`schema.write`. C'est la séparation qu'ont faite
tous les acteurs établis (vérifié : Sanity la nomme explicitement — `schema`
dans le code, *document types* pour les éditeurs ; Strapi n'affiche jamais
« schema » ; Contentful et son *content model* sont le contre-exemple cité).
L'utilisateur qui copie doit retrouver le même mot des deux côtés du geste.
La paire des documents est tranchée de même : l'UI dira **entry** — le mot de
l'instance suit le mot du type, et personne ne croise les paires — la table
reste `documents`, mot de six ADR. Détail dans
[admin-ui.md](architecture/admin-ui.md#le-vocabulaire--deux-paires-une-frontière).

Deux morceaux de console **extraits au deuxième consommateur**, comme
`menu.tsx` l'avait été : `ui/schema-fields.tsx` (le formulaire) et
`ui/lineage.tsx` (la table de lignée). ⚠️ Deux noms de champ font le contrat
entre la lignée et son écran — `restore` et `schemaId` — et les deux
`clientAction` les lisent sous ces noms-là.

### La copie et la divergence — faites

`schemas.copied_from` (migration 0031), `POST …/schemas/copy`, et le diagnostic
rendu **par la liste** — chaque type de contenu porte son `origin`, `null` s'il
a été créé directement.

⚠️ **`ON DELETE SET NULL (copied_from)`, écrit à la main.** Drizzle ne sait pas
exprimer la forme à liste de colonnes (PostgreSQL 15+, vérifié sur 17.10), et un
`SET NULL` nu annulerait aussi `organization_id`, qui est `NOT NULL` : supprimer
une entrée de bibliothèque **échouerait** au lieu de laisser ses copies vivre
sans provenance. Un test l'éprouve — c'est le seul qui couvre cette clause.

⚠️ **La clé et l'index sont *aussi* déclarés dans Drizzle**, avec une clause
moins précise que celle réellement posée. Les omettre laisserait la prochaine
génération les réémettre — le piège de la migration 0024.

⚠️ **La copie prend le nom de la bibliothèque, sans possibilité de le changer.**
Le nom fait partie de l'empreinte : une copie renommée à la naissance se lirait
`locally_modified` avant que personne n'y touche. Un nom pris donne un 409.

⚠️ **`locally_modified` en confond deux** — « seule la copie a bougé » et « les
deux ont bougé ». L'écran affiche « Modified » avec une infobulle qui le dit en
toutes lettres, pour ne pas le survendre.

**Éprouvé plutôt qu'affirmé** : une sonde jetable a confirmé que l'état
d'origine arrive dans la console comme une **union**
(`"identical" | "library_ahead" | "locally_modified"`) et non comme `string` —
ajouter un état côté serveur casse donc le typecheck de la console.

### Par quoi reprendre — maintenant

L'**étape 4** : les `documents`. Le modèle est **décidé**
([ADR 0022](adr/0022-document-a-deux-pointeurs.md)) — une ligne, deux pointeurs
(`current_hash`, `published_hash`) vers un magasin `document_versions`,
Draft/Published/Changed **dérivés**, jamais stockés. La livraison lit un champ,
la console lit l'autre, zéro conditionnelle.

**Jalon 1 fait** : `documentFingerprint` vit dans `fingerprint.ts`, à côté de
celle des schémas — **même tag**, parce que les deux sont SHA-256 sur la même
forme canonique et doivent s'incrémenter ensemble. Vecteurs littéraux vérifiés
par `sha256sum` hors du code, comme les précédents.

⚠️ **Pas de canonisation, contrairement à `fingerprint`** — et l'absence est une
décision. Un `label` de schéma arrive en deux écritures parce que l'API et la
colonne se contredisent ; un `data` n'a pas de colonne avec laquelle être en
désaccord. La règle « un champ non renseigné est **absent**, jamais `null` »
appartient au validateur généré (jalon 2), qui refusera un `null` **à la
frontière** plutôt que de le réécrire en silence.

**Jalon 2 fait** : `src/cms/validate.ts` — les deux validateurs d'une seule
traversée, 18 tests, aucun consommateur encore (le jalon 3 le branche). Deux
décisions de contrat prises en discussion et gravées :

- **`date` = date seule** (`YYYY-MM-DD`, calendrier réel vérifié — bissextiles
  comprises). « Le type décide du widget », le précédent `text`/`longtext`
  appliqué une fois de plus ; `datetime` sera un futur type de champ. Strict
  s'élargit à coût nul, permissif se resserre en migrant des données clients
- **`required` vide = incomplet, par type** : trim puis non-vide pour les
  chaînes, et **jamais un check falsy générique** — `0` et `false` sont
  complets. Les tests anti-falsy l'épinglent

⚠️ Et trois refus qui font le contrat : `null` n'est jamais « non renseigné »
(absent seulement), une clé hors définition est refusée **en la nommant**
(jamais `z.object` nu, qui la supprimerait en silence), et **la complétude
inclut la forme** — un brouillon enregistré sous une ancienne définition
repasse la forme courante au moment de publier. Aucun transform nulle part :
l'empreinte du `data` est son identité.

⚠️ Quatre contraintes à ne pas perdre en l'écrivant :

- **Le nettoyage des versions inatteignables est synchrone**, dans la
  transaction d'enregistrement — la croissance serait sinon non bornée dès le
  premier jour. La course perdue (suppression refusée par la FK) **est un
  succès silencieux**, et son test de concurrence vaut la peine d'exister
- **L'empreinte d'un document couvre `data` seul** — `locale` et
  `translation_group_id` sont de l'adressage : ils disent *où* est le contenu,
  pas *ce qu'il est*. `documentFingerprint` à part, `normalise.ts` ne bouge pas
- **`data` sur la ligne ≡ version pointée par `current_hash`** — un invariant
  silencieux, tenu par une seule fonction d'écriture, avec son assertion dans
  les tests
- **Publier est le moment des deux vérifications** — complétude
  ([ADR 0017](adr/0017-validation-a-l-ecriture-seulement.md), raffiné : forme à
  l'enregistrement, `required` à la publication, **deux modes Zod d'une seule
  définition**) et clôture ([ADR 0021](adr/0021-ensemble-publie-clos-par-reference.md)),
  les deux refus nommant ce qui manque

⚠️ Et les rappels d'avant tiennent toujours : les **références** sont présentes
dès la conception ([ADR 0020](adr/0020-references-entre-documents.md)), la
table d'index naît **avec** `documents` et jamais avant, la clôture opère sur
un **ensemble** même à un membre. La question UI — où vivent les documents dans
la console — est dans
[decisions-ouvertes.md](architecture/decisions-ouvertes.md), penchant arrêté
mais non validé.

⚠️ Et un souhait resté en plan, qui aurait transformé une énigme en message :
un contrôle au démarrage comparant le **registre de permissions** à la table
`permissions` (ADR 0019).

## Repères de l'étape 6b

`schemas`, `documents`, API de livraison. **Trois décisions à prendre avant**,
détaillées dans [architecture/decisions-ouvertes.md](architecture/decisions-ouvertes.md) :
quand la validation s'applique, versionnage des schémas, références entre
documents.

Rappels structurants :

- `documents` porte déjà `locale` et `translation_group_id`
- Le contenu est rattaché à `environment_id`, jamais à `project_id`
- L'API de lecture reste en **GET avec paramètres d'URL** — sinon plus de cache
- Toute écriture passe par un **point d'émission d'événements unique** — c'est
  là que vit la clôture du publié, dans les deux sens
- ⚠️ **La vérification porte sur un ensemble dès le premier jour**, même à un
  membre : la publication groupée est la seule issue aux cycles, et l'écrire
  « un document » obligerait à la réécrire
- ⚠️ **La table d'index des références naît avec `documents`**, jamais avant :
  une table de références sans documents à indexer est l'erreur qu'un projet
  précédent a déjà faite

## Backlog ouvert

| # | Item | Quand |
|---|---|---|
| [0004](backlog/0004-cors-admin-ui.md) | CORS pour l'admin UI | En production seulement — le proxy le règle en développement |
| [0008](backlog/0008-resolution-des-projets-d-un-membre.md) | Résolution des projets d'un membre | À mesurer avant d'agir |
| [0012](backlog/0012-la-console-n-a-aucun-test.md) | La console n'a aucun test | Avec la CI — les deux se décident ensemble |
| [0014](backlog/0014-frontiere-du-socle.md) | Frontière du socle : `src/cms/` + règle d'import | 🔴 Au premier fichier de 6b |
| [0015](backlog/0015-avatar-choisi-par-la-personne.md) | L'avatar n'est pas choisi par la personne | 🟢 L'étape 7 ne le livrera **pas** au passage |
| [0016](backlog/0016-alerte-esbuild-inexploitable-ici.md) | Alerte esbuild | 🟢 Laissée ouverte **exprès** — la faille est dans `esbuild serve`, jamais lancé |

Dix items clos.

## Pièges à ne pas redécouvrir

- **Une policy RLS ne référence jamais une autre table sous RLS** — cycle
  refusé par Postgres, et `SECURITY DEFINER` n'y change rien puisque `FORCE`
  soumet aussi le propriétaire
- **Une migration de données sous RLS doit lever `FORCE`** — sinon elle ne
  touche aucune ligne, silencieusement, et si elle échoue entre-temps la table
  reste sans protection
- **Une liste de choses à protéger, écrite à la main, dérive en silence** — le
  contrôle de préconditions énumérait les tables à vérifier et en avait manqué
  **cinq sur treize**. La forme sûre est l'**exclusion** : on protège tout, on
  retire nommément, et chaque retrait porte sa justification
- **Une contrainte écrite à la main doit *aussi* exister dans le schéma
  Drizzle** — sinon la prochaine génération la réémet. La clause peut y être
  moins précise que celle réellement posée ; ce qui compte est que le cliché la
  connaisse
- **`ON DELETE SET NULL` nu annule *toutes* les colonnes de la clé** — sur une
  clé composite dont une colonne est `NOT NULL`, la suppression échoue. La
  forme à liste de colonnes (PostgreSQL 15+) est ce qu'il faut
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
