# ADR 0013 — Une clé API appartient à un environnement

**Statut** : Accepté
**Date** : 2026-08-20

## Contexte

Les clés API font partie du **socle réutilisable**, au même titre que
l'authentification, les rôles et les invitations. La question était de savoir
si elles se rattachent au **projet** — laissant le socle générique — ou à
l'**environnement**, concept propre au CMS
([ADR 0006](0006-couture-environnements.md)).

La question n'est pas celle d'une colonne, mais de **qui décide de
l'environnement servi**. Si c'est l'appelant, via un en-tête ou un segment
d'URL, alors une clé rattachée au projet peut lire n'importe quel
environnement — or la clé publique est embarquée dans les sites web, visible
de tous. N'importe qui lirait le contenu de préproduction, non publié.

## Décision

**`api_keys.environment_id`.** Un environnement possède ses trois clés —
publique, preview, secrète. Deux environnements dans un projet font six clés.

C'est le motif naturel : chaque environnement est consommé par un
**déploiement différent**, avec sa propre configuration. Le site en production
lit `master`, celui de préproduction lit `staging`. Ils n'ont aucune raison de
partager une clé.

Les permissions, elles, ne se dupliquent pas : un environnement est une
subdivision interne au projet, pas un niveau d'autorisation. Un `editor` du
projet l'est dans tous ses environnements.

## Ce que font les leaders — et pourquoi on s'en écarte

⚠️ **Aucun des deux ne lie une clé à un seul environnement.**

| | Portée du jeton | Contrainte d'environnement |
|---|---|---|
| **Contentful** | Le *space* (notre projet) | Liste blanche d'environnements, fixée à la création |
| **Sanity** | Le projet | Par les rôles ; et un *dataset* public se lit sans jeton |

Sanity est plus éloigné qu'il n'y paraît : leurs datasets peuvent être
publics, donc leur jeton n'équivaut pas à notre clé publique. C'est Contentful
qui est comparable.

Et Contentful rattache la clé au space avec une **liste** d'environnements, ce
qui permet à une clé d'en couvrir plusieurs.

Notre modèle est donc **plus simple et plus rigide** : une clé ne couvre qu'un
environnement. On paierait la machinerie d'une liste blanche pour une
souplesse dont l'usage visé n'a pas besoin — deux déploiements distincts ont
deux configurations distinctes. Contentful recommande d'ailleurs lui-même de
séparer les jetons par environnement.

**Ce point est consigné explicitement** : sans lui, quelqu'un relisant
Contentful dans un an croirait qu'on a raté quelque chose.

## Alternatives écartées

**`project_id` seul, l'environnement venant de la requête.** La clé publique
étant publique, l'appelant choisirait l'environnement — donc lirait la
préproduction. Inacceptable.

**`project_id` plus une liste blanche, façon Contentful.** Correct, mais
ajoute une table de liaison pour une souplesse non demandée.

Une erreur de raisonnement a été commise en chemin et mérite d'être notée :
`project_id` a d'abord été recommandé au motif qu'il économiserait un saut sur
le chemin chaud. C'est l'inverse. L'API publique doit répondre « quelle
contenu cette clé sert-elle ? », or le contenu est cadré par `environment_id` :
pointer directement dessus est la route **courte**.

## Conséquences

Le socle emporte la notion d'environnement. Le poids est léger :
[ADR 0006](0006-couture-environnements.md) place déjà la table `environments`
dans le socle, avec une ligne `master` par projet. Une réutilisation hors CMS
aurait une table dont elle ne se soucierait jamais.

**Se tromper coûte peu.** Les deux migrations sont triviales et sans perte :
vers une liste blanche, on la dérive de l'`environment_id` existant ; depuis
une liste blanche, on éclate en une clé par environnement.

Sources : [Authentication | Contentful](https://www.contentful.com/developers/docs/references/authentication/)
· [Authentication and tokens | Sanity](https://www.sanity.io/docs/content-lake/http-auth)
