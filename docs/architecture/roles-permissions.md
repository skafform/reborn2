# Rôles & permissions

Approche **RBAC** : un catalogue de permissions atomiques, une correspondance
rôle → permissions, et **un seul point de vérification**
`can(acteur, permission, ressource)`. Jamais de `if (role === 'editor')`
dispersé dans les handlers.

Les rôles s'appliquent à **deux niveaux**, portés par deux tables
indépendantes.

## Catalogue de permissions

**Règle de découpage : une permission existe quand elle exprime une différence
réelle dans la matrice.** Deux permissions dont les colonnes seraient
identiques partout n'en font qu'une. Sans cette règle, on obtient un catalogue
que personne ne maintient.

| Domaine | Permissions |
|---|---|
| Contenu | `content.read` · `content.read_draft` · `content.write` · `content.publish` |
| Schémas | `schema.read` · `schema.write` |
| Membres | `member.read` · `member.manage` · `member.manage_admin` |
| Clés API | `apikey.manage` |
| Projets | `project.create` · `project.delete` |
| Organization | `org.settings` · `org.billing` · `org.transfer` · `org.delete` |

## Matrice

| | `owner` | `admin` | `viewer` | `editor` | `contributor` | `guest` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `content.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `content.read_draft` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `content.write` | ✅ | ✅ | — | ✅ | ✅ | — |
| `content.publish` | ✅ | ✅ | — | ✅ | — | — |
| `schema.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `schema.write` | ✅ | ✅ | — | — | — | — |
| `member.read` | ✅ | ✅ | ✅ | — | — | — |
| `member.manage` | ✅ | ✅ | — | — | — | — |
| `member.manage_admin` | ✅ | — | — | — | — | — |
| `apikey.manage` | ✅ | ✅ | — | — | — | — |
| `project.create` | ✅ | ✅ | — | — | — | — |
| `project.delete` | ✅ | — | — | — | — | — |
| `org.settings` | ✅ | ✅ | — | — | — | — |
| `org.billing` | ✅ | — | — | — | — | — |
| `org.transfer` | ✅ | — | — | — | — | — |
| `org.delete` | ✅ | — | — | — | — | — |

Aucune case n'est « partielle » — la matrice est **purement déclarative**, sans
exception à compléter en code.

Elle sera ajustée en cours de route : construire les routes fera apparaître des
permissions manquantes ou trop grossières. C'est attendu. La seule discipline à
tenir est la règle de découpage ci-dessus — et le fait que toute modification
se lise ici, dans une seule table.

Trois permissions encodent à elles seules les règles de gestion des membres :

- **`member.read`** — voir l'annuaire de l'organization. La seule que détienne
  un `viewer`, qui est « un admin sans écriture » : c'est cette colonne qui la
  distingue de `member.manage`, sans quoi les deux n'en feraient qu'une
- **`member.manage`** — inviter, retirer et changer le rôle d'un membre **non
  privilégié**. Couvre aussi les **invitations en attente**, y compris leur
  simple consultation : une invitation relève du recrutement, pas de
  l'annuaire. Un `viewer` voit qui est dans l'équipe, pas qui est en train d'y
  être admis
- **`member.manage_admin`** — l'octroi et le retrait d'`admin`/`owner`. Un
  `admin` ne peut donc ni promouvoir vers `admin`, ni évincer un autre `admin`

Les rôles de projet (`editor`, `contributor`, `guest`) n'ont aucune des trois :
un pigiste ou un client n'a pas à voir l'annuaire de l'organization qui
l'accueille.

## Les clés API partagent le même catalogue

| Clé | Permissions |
|---|---|
| **Publique** | `content.read` |
| **Preview** | `content.read`, `content.read_draft` |
| **Secrète** | `content.read`, `content.read_draft`, `content.write`, `content.publish`, `schema.read`, `schema.write` |

C'est ce qui justifie de garder `content.read` et `content.read_draft`
distinctes : aucun rôle humain ne les sépare, la clé publique si.

La clé secrète obtient `schema.write` — nécessaire aux scripts de migration, et
aligné sur le Content Management API de Contentful qui permet de gérer les
types de contenu par API.

Un **seul** `can(acteur, permission, ressource)` sert donc les deux types
d'acteurs, sans système d'autorisation parallèle. Cela se referme sur l'acteur
polymorphe du journal d'audit (`user` ou `api_key`, voir
[audit.md](./audit.md)).

## Où vit la correspondance rôle → permissions

**En code**, dans une constante versionnée — testable, sans aller-retour en
base. La déplacer vers la base est la couture pour des **rôles personnalisés**
définis par les clients, fonctionnalité que Contentful et Sanity réservent tous
deux à leurs paliers payants. Voir
[evolutions-prevues.md](./evolutions-prevues.md).

## Organization — `organization_members`

```
user_id, organization_id, role
```

Les 3 rôles ont tous une portée **globale sur tous les projets de
l'organization** — aucun n'a besoin d'être ajouté projet par projet, seul le
niveau d'accès change :

| Rôle | Accès contenu (tous les projets) | Paramètres |
|---|---|---|
| `owner` | Lecture/écriture | Tous les paramètres de l'org (facturation, suppression, transfert de propriété) |
| `admin` | Lecture/écriture | Paramètres de projet, pas les paramètres sensibles de l'org réservés à `owner` |
| `viewer` | Lecture seule | Aucun accès aux paramètres |

`viewer` = littéralement "un admin sans écriture" : il voit tout le contenu de
tous les projets de l'org, mais ne peut rien modifier ni gérer.

## Projet — `project_members`

```
user_id, project_id, role
```

Table **indépendante** de `organization_members` : une personne peut être
ajoutée directement à un projet **sans jamais être membre de
l'organization** (ex: pigiste/client externe qui ne travaille que sur un seul
projet).

| Rôle | Accès |
|---|---|
| `editor` | Lecture/écriture, peut publier |
| `contributor` | Lecture/écriture sur les brouillons, ne peut pas publier |
| `guest` | Lecture seule — même niveau de permission que `viewer` au niveau organization, mais **limité au(x) projet(s) où il a une entrée `project_members`**, sans jamais pouvoir dépasser ce scope |

Les invitations `editor`/`contributor`/`guest` sont gérées par les `owner`/
`admin` de l'organization (voir [invitations.md](./invitations.md)).

### Ce qu'un membre de projet voit

Il **n'appartient pas** à l'organization (aucune ligne `organization_members`).
Elle lui apparaît quand même : dans le sélecteur, à côté de la sienne, sans
distinction visuelle — et son projet dans la liste des projets. Il clique, il
y entre. Le parcours complet est dans
[multi-tenant.md](./multi-tenant.md#un-membre-de-projet-na-pas-dorganization--et-ça-ne-se-voit-pas).

Il voit donc le **nom** de l'organization, mais jamais sa liste de membres, ses
paramètres, sa facturation, ni ses autres projets. Voir le nom ≠ être membre.

**La règle tient en une phrase : on voit les projets que sa portée atteint.**

| Portée de l'acteur | Projets visibles |
|---|---|
| `organization` | tous ceux de l'organization |
| `project` | ceux de `grant.projectIds`, et rien d'autre |

Le `Grant` porte déjà les deux informations — rien à charger de plus.

⚠️ **La portée d'un rôle et l'endroit où on l'attribue doivent s'accorder**, et
c'est le **serveur** qui le vérifie : un rôle de portée projet exige un projet,
un rôle d'organization en refuse un. Sans ce contrôle, un rôle de projet
attribué sans projet devient une adhésion d'organization — et ses permissions
valent alors sur *tous* les projets. Une escalade de **portée**, que le
garde-fou d'escalade de privilèges ne voit pas : il compare des permissions, pas
leur étendue.

⚠️ Deux formulaires envoient ces invitations — celui de l'organization et celui
du projet. Raison de plus pour que la règle vive côté serveur : deux copies dans
deux écrans, c'est une règle métier hors de sa source de vérité, et *« la console
masque, elle n'autorise pas »*.

## Retrait d'un membre

Encodé par `member.manage` / `member.manage_admin` dans la matrice ci-dessus :

| Qui retire | Peut retirer |
|---|---|
| `owner` | N'importe qui, y compris un autre `owner` ou `admin` (sous réserve de la règle du dernier `owner`) |
| `admin` | Un `viewer` et n'importe quel membre de projet — **jamais** un autre `admin` ni un `owner` |

Symétrique de la règle d'invitation (*seul un `owner` peut promouvoir vers
`owner`/`admin`*) : sans cela, un `admin` pourrait évincer le propriétaire de
l'organization et contourner la règle du dernier `owner`.

⚠️ **La console ne peut pas déduire cette matrice.** Savoir si l'appelant peut
retirer *ce* membre-ci suppose de comparer leurs rôles — donc de recopier la
règle hors de sa source de vérité, ce que ce document interdit par ailleurs.

`GET /organizations/{id}/members` renvoie donc, **par membre**, ce que
l'appelant peut en faire, calculé par le garde-fou qui refuserait ensuite.
Même procédé que `assignable` sur `GET …/roles`, et pour la même raison.

## Quitter de soi-même

Partir n'est pas être retiré : ça ne demande **aucune permission**. La règle du
dernier `owner` s'applique quand même — le seul propriétaire ne peut pas s'en
aller sans avoir promu quelqu'un.

C'est la même opération de retrait, avec une garde différente : soi-même, ou
`member.manage` pour quelqu'un d'autre.

## Suspension

Une adhésion peut être **suspendue** : la ligne subsiste, le rôle est conservé,
mais l'accès cesse. C'est le verrouillage temporaire — incident, absence
prolongée — qu'un retrait rendrait irréversible sans re-choisir le rôle.

`suspended_at` sur `organization_members` et `project_members`. Trois endroits
la lisent, et **aucun n'est `can()`** :

| Où | Effet |
|---|---|
| `organizationGrant` / `projectGrant` | aucun grant n'est rendu — donc 404 partout |
| `listOrganizationsForUser` | l'organization disparaît du sélecteur |
| `protect_last_owner` | ne compte que les `owner` **actifs** |

Couper à la résolution du grant plutôt que dans `can()` garde le point de
vérification unique intact : une suspension n'est pas une permission en moins,
c'est une adhésion qui ne compte plus.

⚠️ **Aucune policy RLS ne change.** `app_is_member_of` reste vraie pour un
suspendu — mais aucune route d'administration ne s'ouvre sans grant. C'est le
partage habituel : RLS cadre le locataire, le modèle de rôles vit en TypeScript
([securite.md](./securite.md)).

⚠️ **Le trigger du dernier `owner` doit ignorer les suspendus.** Sans ça,
suspendre le seul propriétaire **orpheline l'organization** : plus personne n'a
de droits, et personne ne peut le réactiver puisque ça demande `member.manage`.
Le trou que la règle existe pour empêcher se rouvrirait par une autre porte.

## Accès aux brouillons

Les rôles en lecture seule — `viewer` (organization) et `guest` (projet) —
voient **le contenu publié et les brouillons**. La restriction au contenu
publié seul existe uniquement au niveau des clés API (clé publique vs clé
preview, voir [api.md](./api.md)), pas au niveau des rôles humains.

## Règle du dernier `owner`

Une organization doit **toujours** avoir au moins un `owner` **actif**. Tant
qu'un utilisateur est le seul `owner` d'une organization, il ne peut pas :

- être retiré de l'organization, ni la quitter de lui-même
- être **suspendu**
- être rétrogradé vers `admin` ou `viewer`
- supprimer son propre compte utilisateur

Il doit d'abord promouvoir quelqu'un d'autre `owner`, ou supprimer
l'organization. Sans cette règle, une organization devient orpheline : plus
personne ne peut gérer la facturation, les membres ou la suppression.

⚠️ **Le trigger est `DEFERRABLE INITIALLY DEFERRED`** : il ne se déclenche pas
à l'instruction mais **au commit**. Un `.catch()` posé sur le `DELETE` ne
l'attrapera donc jamais — l'exception sort au moment où la transaction se
ferme, et un refus lisible se transforme en 500 si on le traite au mauvais
endroit. Même piège que le `23505` de « déjà membre ».

## Pas de cumul de rôles

Un utilisateur ne doit pas avoir simultanément un rôle d'organization
(`organization_members`) et un rôle de projet (`project_members`) dans la
même organization — les rôles d'organization couvrent déjà tous les projets,
un rôle de projet en plus n'aurait pas de sens.

- **Bloqué à la source** : on refuse d'inviter à un projet quelqu'un qui a
  déjà un rôle dans l'organization propriétaire de ce projet
- **Filet de sécurité** : si un cumul survient malgré tout (migration,
  bug, changement de rôle ultérieur), c'est la **permission la plus élevée
  qui s'applique**

## Isolation

Un projet auquel un utilisateur n'a accès ni via un rôle d'organization
(`owner`/`admin`/`viewer`, accès automatique à tout) ni via une entrée
`project_members` explicite est **totalement invisible** pour lui — aucune
visibilité, même pas son existence (isolation opaque). Voir
[multi-tenant.md](./multi-tenant.md).

Ces tables sont gérées via Drizzle — voir [database.md](./database.md).
