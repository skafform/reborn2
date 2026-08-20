# ADR 0005 — Dépôts séparés, contrat d'API en OpenAPI

**Statut** : Accepté
**Date** : 2026-08-19

## Contexte

L'API et l'admin UI sont deux applications distinctes, chacune avec son
serveur. Le mode RPC de Hono (`hc`) offre un client entièrement typé, mais il
fonctionne en important les types du serveur — trivial en monorepo, impraticable
entre deux dépôts.

## Décision

**Pas de monorepo** : deux dépôts, déployés séparément, communiquant par HTTP
sous le même domaine racine (sous-domaines) pour que les cookies de session
soient partagés.

**Le contrat passe par OpenAPI**, via `@hono/zod-openapi` : les schémas Zod
déjà utilisés pour la validation génèrent la spec, dont l'admin UI dérive son
client typé.

## Alternatives écartées

**Monorepo + mode RPC de Hono.** Écarté sur décision explicite de ne pas faire
de monorepo.

**Publier les types du serveur en package npm privé.** Impose un cycle
publish/bump/install à chaque changement d'API.

**Écrire les types à la main côté admin UI.** Dérive garantie à moyen terme.

## Conséquences

`@hono/zod-openapi` doit être adopté **dès la première route** : il change la
signature de chaque route, l'ajouter après coup imposerait de réécrire toute la
couche de routing.

Bénéfice secondaire : la spec fait office de documentation publique de l'API,
dont un CMS a de toute façon besoin.

**Portée du typage.** L'API se divise en deux moitiés de nature différente :

- **gestion** (organizations, projets, membres, clés, schémas) — formes fixes,
  qu'OpenAPI décrit parfaitement, et qui couvrent 100 % de ce que consomme
  l'admin UI
- **livraison de contenu** — les formes dépendent des schémas créés par les
  utilisateurs et n'existent pas au moment de générer la spec ; OpenAPI n'en
  décrit que l'enveloppe

Le typage fin du contenu est un problème distinct, reporté, à régler par
génération depuis les schémas d'un projet — façon Sanity TypeGen.

Le domaine racine partagé n'est pas un détail : des domaines distincts
imposeraient des cookies tiers et remettraient en cause la stratégie de session.

Détail :
[../research/comparaison-typage-cms.md](../research/comparaison-typage-cms.md).
