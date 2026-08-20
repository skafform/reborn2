# Comparaison — environnements et emplacement du schéma

**Recherche menée en août 2026**, pour décider s'il fallait poser dès le
départ l'indirection permettant d'ajouter des environnements plus tard. Voir
la décision dans [../architecture/environments.md](../architecture/environments.md).

## Les trois mécanismes

| CMS | Mécanisme | Ce qu'un clone copie |
|---|---|---|
| **Contentful** | *Environments* dans un space, avec des **alias** | Contenu **et** modèle de contenu, entrées, assets, configuration |
| **Sanity** | *Datasets* dans un projet | Documents seulement — le schéma vit ailleurs (voir plus bas) |
| **Storyblok** | *Spaces* séparés | Duplication complète, le plus lourd |

## Contentful — les règles observées

- **Plafond de 11 environnements** par space
- Les environnements sont **conçus pour être supprimés** — ressources
  temporaires, pas installations permanentes
- `master` ne peut être ni supprimé ni renommé
- Nommage : les **alias** portent les noms de stade (`production`, `staging`),
  les **environnements** portent une version ou une date (`release-2026-01`,
  `hotfix-auth-bug`)
- Les alias permettent de basculer l'environnement servi sans changer le code
  ni les identifiants du client. Réservés au Premium/Enterprise au-delà de
  `master`
- ⚠️ Contentful signale lui-même que les **noms** d'environnements restent
  visibles aux utilisateurs qui n'y ont pas accès — d'où leur conseil
  d'utiliser des noms de code pour du développement sensible

## Sanity — deux enseignements majeurs

### 1. Le flux est à sens unique

> *La plupart des équipes ne « poussent » pas régulièrement le contenu de
> staging vers production ; elles utilisent staging pour tester des
> changements de schéma et de nouvelles fonctionnalités, tandis que le
> contenu réel est créé directement en production.*

Conséquence directe pour nous : **la fusion inverse (staging → production) n'a
pas à être construite**, ce qui élimine la partie de loin la plus difficile de
la fonctionnalité.

### 2. Sanity est *schemaless* au niveau de la base

Confirmé par leur documentation : *« Sanity is schemaless at the database
level »*. Le schéma vit dans le **code du Studio**
(`schemaTypes/article.ts`), versionné dans git et déployé avec lui. Le Content
Lake stocke du JSON libre avec un `_type` et un `_id`, sans rien valider — la
validation est faite par le Studio, côté client, à la saisie.

C'est pourquoi deux datasets d'un même projet peuvent avoir des schémas
différents : le schéma n'est pas *dans* le dataset, il est dans le code qui
s'y connecte.

Règles de nommage des datasets : minuscules, chiffres, tirets et tirets bas,
en commençant et finissant par une lettre minuscule ou un chiffre.

## L'écart qui nous concerne

Notre modèle suit **Contentful**, pas Sanity : les schémas sont des lignes en
base, rattachées à l'environnement, et la validation est faite par l'API, donc
autoritaire.

C'est le bon choix pour notre produit — l'objectif est qu'un `admin` puisse
créer un type de contenu depuis un formulaire, sans développeur ni
déploiement. Chez Sanity, tout changement de schéma exige les deux.

**Mais ce choix a un prix** : en mettant le schéma dans le code, Sanity obtient
gratuitement l'historique, la revue de code, le retour en arrière
(`git revert`) et les branches. Nos schémas vivant dans une table, rien de
tout cela n'existe par défaut — voir la décision ouverte sur le versionnage
des schémas dans
[../architecture/decisions-ouvertes.md](../architecture/decisions-ouvertes.md).

## Sources

- [Multiple environments | Contentful Docs](https://www.contentful.com/developers/docs/concepts/multiple-environments/)
- [Environments and environment aliases best practices | Contentful Docs](https://www.contentful.com/developers/docs/concepts/environments-and-environment-aliases-best-practices/)
- [Environment Aliases | Contentful Docs](https://www.contentful.com/developers/docs/concepts/environment-aliases/)
- [Datasets | Sanity Docs](https://www.sanity.io/docs/content-lake/datasets)
- [Can datasets in a Sanity project have different schemas?](https://www.sanity.io/answers/can-multiple-datasets-have-different-schemas)
- [Managing staging vs production datasets](https://www.sanity.io/answers/how-are-people-managing-staging-vs-production-p1601671770173900)
