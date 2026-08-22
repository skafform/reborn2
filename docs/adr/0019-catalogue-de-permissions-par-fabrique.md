# ADR 0019 — Le catalogue de permissions est une fabrique, pas une union

**Statut** : Accepté
**Date** : 2026-08-21

## Contexte

Le socle et le CMS sont deux projets logiques dans un seul processus, et la
flèche de dépendance va dans **un seul sens** : le CMS importe le socle, jamais
l'inverse ([backlog #0014](../backlog/0014-frontiere-du-socle.md)).

Le socle porte le point de vérification unique, `can(acteur, permission)`, dont
le paramètre était typé sur l'union des clés connues — c'est ce typage qui rend
impossible de vérifier une permission inexistante.

Le CMS doit pouvoir ajouter des clés. `can(acteur, "library.write")` doit
donc typer, alors que le socle n'a pas le droit de connaître ce mot.

⚠️ **La composition dans un troisième module ne s'en sort pas.**
`authorization.ts` devrait l'importer, et ce module importe le CMS : le socle
en dépendrait par un intermédiaire, et la règle de lint ne l'attraperait pas —
elle interdit d'importer `cms/`, pas d'importer un fichier qui l'importe. Une
frontière non tenue qui a l'air tenue est pire que pas de frontière.

## Décision

**`Permission` est un type marqué, et `definePermission` en est la seule
source.**

```ts
declare const permissionBrand: unique symbol;
export type Permission = string & { readonly [permissionBrand]: true };

export function definePermission(key, spec): Permission
```

Chaque couche déclare les siennes en important le socle, et exporte ses
constantes. Les points d'appel passent la constante, plus le littéral.

### Ce que ça achète, et qui n'est pas le typage

**Détenir une `Permission` prouve que son enregistrement a eu lieu.** Le seul
moyen d'en obtenir une est d'importer la constante, donc d'exécuter la
fabrique. Il n'y a pas d'ordre de chargement à vérifier au point d'appel : il
ne peut pas être faux.

**Déclarer la clé et ses détenteurs est un seul geste.** Le semage des rôles
système lit le registre que la fabrique a rempli — le problème « accorder des
permissions qu'on ne peut pas nommer » se règle dans la ligne qui définit la
clé, pas dans un second enregistrement qui pourrait s'en écarter.

⚠️ **`owner` n'est jamais listé** : il reçoit tout le catalogue par
construction. C'est ce qui garantit qu'il peut toujours accorder n'importe
quelle permission, la règle d'escalade interdisant d'accorder ce qu'on ne
détient pas. Le lui faire répéter transformerait une garantie en autant
d'occasions de l'oublier.

### Les deux points d'entrée du marquage

`definePermission` **accorde** le marquage — l'unique assertion sanctionnée du
mécanisme, dans la fonction dont c'est le métier.

`toPermissions` le **vérifie** contre le registre, et lève sur l'inconnu. C'est
ce qu'il faut au corps d'une requête : composer un rôle personnalisé consiste
précisément à envoyer des clés. Fermé par défaut, comme le reste.

## Alternatives écartées

**La fusion de déclarations** (`declare module`, le motif Fastify). Légitime,
idiomatique, type-only donc compatible avec `erasableSyntaxOnly` — c'était la
proposition initiale. Écartée pour une raison structurelle, pas de goût :
l'union se compose **à la compilation**, que le module ait été chargé ou non.
Une clé peut donc typer contre un registre vide, ce qui laisse le semage des
rôles dépendre d'une vérification au démarrage. La fabrique rend la
contradiction impossible au lieu de la détecter.

Et elle est implicite : l'union grandit parce qu'un fichier existe quelque
part, pas parce qu'on l'a écrit.

**Garder l'union de littéraux** et y mettre les clés du CMS. C'est l'état
d'avant. Écarté : le socle contiendrait le vocabulaire du CMS, ce que la règle
d'import n'empêche pas — elle interdit de *dépendre*, pas de *contenir*.

**Un `can()` générique, plus un point d'entrée typé par couche.** Techniquement
correct. Écarté par une règle antérieure : *toute décision d'autorisation passe
par `can()`*. Une seconde porte, même mince, est un second point de
vérification — précisément ce que cette règle a été écrite pour empêcher.

## Conséquences

**Les littéraux disparaissent des points d'appel** : 33 endroits, dont 16 dans
les tests. C'est le prix, et il était mesurable avant de le payer.

⚠️ **La console garde ses littéraux, définitivement.** Elle reçoit les
permissions en JSON et ne peut pas importer les constantes du backend : elle
compare `permissions.includes("org.billing")` sur des chaînes, sans typage — ni
aujourd'hui ni demain. Cette décision ne couvre qu'**une moitié du système**.

⚠️ **La preuve n'est pas hermétique.** Rien n'interdit
`"x" as unknown as Permission` ailleurs. TypeScript refuse l'assertion simple,
donc c'est un vrai ralentisseur, pas un mur.

⚠️ **Le registre n'est complet que si les modules sont chargés.** Sans
conséquence pour `can()` ; déterminant pour le semage des rôles, qui créerait
des organizations aux rôles incomplets. Un contrôle de préconditions au
démarrage — le registre contre la table `permissions` — reste à écrire.

**La matrice s'inverse** : les attributions passent de rôle → permissions à
permission → rôles. Ça colle mieux à
[roles-permissions.md](../architecture/roles-permissions.md), dont le tableau a
une ligne par permission — et la raison d'être d'une restriction se lit
désormais sur la permission qu'elle restreint.
