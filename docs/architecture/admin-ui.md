# Admin UI

⚠️ **Ce document a été écrit avant la console, et le disait au futur.** Elle
existe : `console/`, en React Router 8, mode SPA. Ce qu'elle fait aujourd'hui
est décrit dans [../etat.md](../etat.md) — ici ne restent que les décisions de
structure et ce qui n'est pas construit.

## Ce que la console est

**Un serveur distinct**, réuni au backend dans un seul git par commodité de
sauvegarde. Le dépôt est un contenant, pas une frontière d'architecture : les
deux projets sont **agnostiques l'un de l'autre**, et rien ne traverse — ni
import, ni workspace, ni chemin de fichier
([ADR 0005](../adr/0005-depots-separes-contrat-openapi.md)).

Elle communique exclusivement par HTTP, et ne connaît du backend qu'une adresse
et un contrat. Ce contrat est **généré** depuis la spec OpenAPI, plus jamais
recopié à la main ([api.md](./api.md#comment-la-console-dérive-son-client--fait)).

## Domaine et cookies

**Même domaine racine**, par sous-domaines (`api.exemple.com` /
`admin.exemple.com`), pour que le cookie de session Better-Auth soit partagé
sans les complications du cross-domain. Des domaines distincts imposeraient des
cookies tiers et remettraient en cause la stratégie de session.

⚠️ **Aucun CORS en développement** : un proxy Vite renvoie `/api` vers le
backend, ce qui rend chaque requête *same-origin*. Le CORS réel n'aura lieu
qu'en production, entre sous-domaines ([backlog 0004](../backlog/0004-cors-admin-ui.md)).

Le proxy reporte le CORS du navigateur, **pas** le contrôle d'origine de
Better-Auth — deux mécanismes distincts, d'où `TRUSTED_ORIGINS`.

## Ce que masquer veut dire

La console cache les entrées et les actions dont la personne n'a pas la
permission. ⚠️ **C'est un confort, jamais le garde-fou** : chaque route reste
vérifiée côté serveur, on peut taper l'adresse, et un onglet peut rester ouvert
pendant qu'on retire un rôle.

⚠️ Et elle ne **déduit** jamais une permission d'un nom de rôle : les rôles sont
personnalisables par organization ([ADR 0011](../adr/0011-roles-personnalises-par-organization.md)),
donc « viewer » ne garantit rien. Le serveur dit ce qu'on peut faire — par
organization (`/me`), par projet (`…/projects/{id}/me`), par rôle
(`assignable`) et par membre (`manageable`).

## Le vocabulaire : deux paires, une frontière

Le mot **produit** (l'UI) et le mot **technique** (tables, routes, clés de
permission) sont séparés, et la frontière passe au même endroit partout :

| Technique — tables, routes, permissions | Produit — l'UI |
|---|---|
| `schemas`, `/schemas`, `schema.read`/`schema.write` | **content type** |
| `documents`, `/documents` | **entry** |

⚠️ **Le mot de l'instance suit le mot du type, et ce n'est pas un goût.** Tous
les acteurs établis fonctionnent par paires : Contentful et Strapi disent
*content type → entry*, Sanity dit *document type → document*, personne ne
croise les paires. « Content type » ayant été retenu (vérifié : aucun leader ne
montre « schema » à un éditeur — Sanity nomme la séparation, `schema` dans le
code, *document types* dans le Studio ; Strapi ne l'affiche jamais), l'instance
est *entry*.

L'UI dit d'ailleurs *entry* **rarement** : le geste quotidien affiche le nom du
type — on navigue vers « Articles » — et le mot générique ne survit que dans
les compteurs, les états vides et les libellés transverses.

**« Library » reste le nom du lieu** ; ses entrées sont des content types.

⚠️ Deux mots restent délibérément ouverts : celui de l'**API de livraison**
(étape 7 — une surface produit pour développeurs, distincte de ce contrat-ci ;
Contentful y dit `/entries`), et rien d'autre. Les tables et les six ADR qui
disent `documents` ne bougent pas — les renommer réécrirait des décisions pour
un bénéfice nul.

## Ce qui n'est pas construit

- **Les écrans de contenu** — éditeur de documents, formulaires générés à partir
  des définitions de schéma ([content-schemas.md](./content-schemas.md)). Ils
  attendent l'étape 6b, qui crée ce qu'ils éditeraient
- **Les tests** — la console n'en a aucun
  ([backlog 0012](../backlog/0012-la-console-n-a-aucun-test.md)), ce qui a déjà
  laissé passer un défaut que ni le typecheck, ni le lint, ni le contrat ne
  pouvaient voir
