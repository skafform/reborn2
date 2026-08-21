# ADR 0005 — Dépôts séparés, contrat d'API en OpenAPI

**Statut** : Accepté
**Date** : 2026-08-19

## Contexte

L'API et l'admin UI sont deux applications distinctes, chacune avec son
serveur. Le mode RPC de Hono (`hc`) offre un client entièrement typé, mais il
fonctionne en important les types du serveur — trivial en monorepo, impraticable
entre deux dépôts.

## Décision

**Pas de monorepo** : deux projets **agnostiques l'un de l'autre**, déployés
séparément, communiquant par HTTP sous le même domaine racine (sous-domaines)
pour que les cookies de session soient partagés.

> **Précision apportée à l'usage (2026-08-21).** Cet ADR disait « deux
> dépôts ». En pratique, `backend/` et `console/` vivent dans **un seul git**,
> par commodité de sauvegarde. Ça ne change **rien à la décision** : le dépôt
> est un contenant, pas une frontière d'architecture. Sans workspace ni package
> partagé, le mode RPC de Hono reste impraticable, et le raisonnement ci-dessous
> tient mot pour mot.
>
> Ce qui compte n'est pas le nombre de dépôts mais que **rien ne traverse la
> frontière** : aucun import, aucun workspace, aucun tsconfig commun, et
> **aucun chemin de fichier** — y compris pour la spec OpenAPI, qui se récupère
> par HTTP sur le serveur en marche et jamais à `../backend/openapi.json`. Une
> commodité qui la franchirait marcherait aujourd'hui et casserait le jour où
> les deux se séparent, ce qui doit rester bon marché à tout moment.
>
> La règle est tenue **mécaniquement** : `noRestrictedImports` sur `../../**`
> dans `console/biome.json` refuse tout import sortant de `app/`.

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

**La partie la plus incertaine de cet ADR a été éprouvée** *(2026-08-21)*. Elle
ne l'avait jamais été : la console consommait l'API au `fetch`, avec des types
**déclarés à la main** — exactement la troisième alternative écartée ci-dessus.
La dérive annoncée avait commencé, et a été reproduite pour de vrai : renommer
un champ côté serveur laissait les deux typechecks au vert et vidait une
colonne à l'écran.

La chaîne prévue par cet ADR est en place — `pnpm api:sync` récupère la spec
par HTTP, Orval en génère des schémas Zod, la console n'écrit plus aucune forme
à la main, et valide ce qu'elle reçoit comme ce qu'elle envoie. La décision est
désormais un résultat. Détail et étapes :
[../architecture/api.md](../architecture/api.md#comment-la-console-dérive-son-client--fait).

⚠️ **Conséquence pour la CI** : la spec se récupère du serveur en marche, jamais
d'un chemin de fichier. Une vérification qui régénérerait depuis la copie
commitée serait bon marché — et laisserait passer précisément l'oubli d'
`api:sync` qu'elle prétend attraper.

Détail :
[../research/comparaison-typage-cms.md](../research/comparaison-typage-cms.md).
