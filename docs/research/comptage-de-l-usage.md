# Comparaison — comptage de l'usage et quotas

**Recherche menée en août 2026**, pour décider *quoi* mesurer, *à quel grain*,
et *quand* il devient trop tard pour commencer. Rien n'est construit : la
décision qui en découle est une couture, dans
[../architecture/api.md](../architecture/api.md#comptage-de-lusage--couture-pour-les-quotas)
et [../architecture/evolutions-prevues.md](../architecture/evolutions-prevues.md#quotas--facturation).

## La question de départ

Comment mesurer la consommation d'une organization — requêtes, bande passante,
taille des données — et faut-il compter par clé API ou par locataire ?

## Ce que mesurent les deux références

| | Contentful | Sanity |
|---|---|---|
| Appels d'API | ✅ | ✅ (API et API CDN comptés séparément) |
| Bande passante | ✅ CDN / assets | ✅ **sortante**, API + CDN + assets confondus |
| Documents | — | ✅ |
| Assets (stockage) | — | ✅ |
| Datasets / environnements | — | ✅ |

**Contentful** expose une *Usage API* : `GET /metric` rend une série
temporelle, en granularité **journalière jusqu'à 31 jours** et **mensuelle
jusqu'à 12 mois**, groupée **par space** ou par type d'API. Un
`GET /usages-detailed` donne le détail **par asset**, pour trouver quel fichier
fait le trafic. C'est la même API qui alimente leurs tableaux de bord.

**Sanity** publie ses définitions plutôt qu'une API : la bande passante est le
total sortant du mois ; les documents et les datasets sont comptés **à la fin
du mois**.

## Les deux règles qu'on aurait mal devinées

⚠️ **Une requête en échec ne compte pas.** Sanity exclut explicitement les
réponses `4xx` et `5xx`, ainsi que les requêtes `OPTIONS`. Ce n'est pas un
détail de facturation : ça change l'endroit où le compteur se branche — après
avoir connu le statut, pas à l'entrée.

⚠️ **Les mesures d'état sont des instantanés, pas des moyennes.** Sanity compte
les documents et les datasets *à la fin du mois*. Aucun historique à tenir,
aucune agrégation continue : une requête mensuelle suffit. C'est beaucoup moins
cher que ce qu'on imagine en abordant le sujet.

## Le partage qui en découle

C'est la conclusion utile de cette recherche, et les deux modèles la
confirment :

| Mesure | Nature | Ce qu'il faut |
|---|---|---|
| Requêtes, octets sortis | **flux** — non compté = perdu à jamais | un compteur durable |
| Documents, projets, assets | **état** — recalculable à tout moment | une requête, une fois par mois |

Seul le flux impose un calendrier. Tout le reste se recompte quand on veut, y
compris rétroactivement.

## Le grain : par clé

Une clé résout vers un environnement → un projet → une organization. Compter au
grain le plus fin donne donc gratuitement les trois vues — qui consomme, quel
site, qui paie. L'agrégation monte ; elle ne descend pas.

Contentful ne groupe que **par space**, l'équivalent de notre projet. Aller plus
fin ne coûte rien chez nous, puisqu'une clé appartient déjà à un environnement.

## Le point coûteux : l'écriture

⚠️ Un compteur par requête transforme chaque **lecture** — l'opération qu'on
veut la moins chère — en lecture *plus* écriture.

| Approche | Prix |
|---|---|
| `UPSERT` sur la ligne (clé, jour) | une écriture indexée par requête, mais durable |
| Tampon en mémoire, vidé périodiquement | chemin chaud gratuit, la queue perdue au redémarrage |
| Magasin séparé (Redis) | précis, et une dépendance que ce projet n'a pas |

La première est celle qui correspond à ce projet — **hors de la transaction de
lecture, et après la réponse** : un échec de comptage ne doit jamais faire
échouer une lecture.

Contentful et Sanity opèrent à une échelle qui justifie des pipelines dédiés.
Rien n'indique qu'il faille commencer là.

## Quand

À l'**étape 7**, avec l'API de livraison — le seul endroit à fort volume. La
console fait quelques dizaines de requêtes par session ; un site en fait des
milliers par jour, et personne ne facture un administrateur qui consulte sa
liste de projets.

Pas avant, faute de requêtes à compter. Pas après, parce que le flux ne se
reconstitue pas.

## Sources

- [Usage limits | Contentful Help Center](https://www.contentful.com/help/admin/usage/usage-limit/)
- [Usage | Content Management API | Contentful](https://www.contentful.com/developers/docs/references/content-management-api/usage/)
- [Plans and payments | Sanity Docs](https://www.sanity.io/docs/platform-management/plans-and-payments)
- [Technical limits | Sanity Docs](https://www.sanity.io/docs/content-lake/technical-limits)
