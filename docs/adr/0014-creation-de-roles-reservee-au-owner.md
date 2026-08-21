# ADR 0014 — La création de rôles est réservée au `owner`

**Statut** : Accepté
**Date** : 2026-08-21
**Remplace partiellement** : [ADR 0011](0011-roles-personnalises-par-organization.md)

## Contexte

L'[ADR 0011](0011-roles-personnalises-par-organization.md) a introduit
`role.manage` et l'a placée chez `owner` **et** `admin`. Elle a aussi assumé
une perte, écrite noir sur blanc :

> Modifier qui peut publier n'apparaît plus dans une revue de code. La
> contrepartie est la règle d'escalade […] et la journalisation de ces
> changements.

⚠️ **Cette journalisation n'existe pas.** Le point d'émission d'événements est
décidé ([ADR 0008](0008-point-d-emission-d-evenements-unique.md)) mais rien
n'est construit. La contrepartie annoncée est donc absente, et l'était déjà au
moment d'écrire l'ADR 0011.

Sans journal, la **seule trace** d'un changement du modèle de permissions est
la liste des rôles elle-même.

## Décision

`role.manage` n'est plus détenue que par le rôle système `owner`.

Un `admin` conserve `member.manage` : il assigne les rôles existants, y compris
les rôles personnalisés. Il ne décide plus de ce qu'un rôle **signifie**.

**La délégation reste possible, et devient explicite** : un `owner` qui veut
confier la gestion des rôles crée un rôle personnalisé contenant `role.manage`
et l'assigne. La règle d'escalade s'applique au délégué comme à tout le monde —
il ne pourra jamais composer au-delà de ce qu'il détient.

### Ce qu'on gagne, précisément

La liste des rôles devient **son propre journal**. Chaque entrée y a été mise
par une seule personne identifiable, et elle reste visible en permanence. Un
`admin` qui a besoin d'un pouvoir doit le demander, et ce qu'on lui accorde
s'affiche.

Avec `role.manage` chez l'`admin`, cette même liste est un endroit où du
pouvoir peut s'ajouter discrètement parmi des entrées légitimes — sans rien
pour dire qui, ni quand.

⚠️ **Ce n'est pas une faille qu'on ferme.** Le plafond était déjà tenu par la
règle d'escalade : un `admin` ne pouvait pas se donner plus qu'il ne détenait.
Ce qu'on lui retire, c'est de **composer une combinaison nouvelle** — donc ce
qu'on gagne est la lisibilité, pas une brèche colmatée.

Consigné parce que l'argument inverse — *« de toute façon l'admin ne pouvait
pas dépasser son plafond »* — est exact, et conduirait à annuler cette décision
en croyant qu'elle ne servait à rien.

## Alternatives écartées

**Laisser `role.manage` chez l'`admin`** (l'ADR 0011). Cohérent tant que le
journal d'audit est proche ; il ne l'est pas.

**Attendre le journal d'audit, puis reconsidérer.** Le rattrapage est gratuit
aujourd'hui — aucun écran ne permet encore de créer un rôle, donc aucune
organization n'en a. Une fois des clients installés, il faudrait décider quoi
faire des rôles déjà créés par des `admin`, et la décision serait prise sous
contrainte.

**Rendre le porteur de `role.manage` configurable par organization.** C'est
exactement ce que la délégation permet déjà, sans réglage : créer un rôle.

## Conséquences

**Un rattrapage est nécessaire.** Les rôles système sont copiés par
organization ([ADR 0011](0011-roles-personnalises-par-organization.md)) :
retirer la permission du catalogue ne change que les organizations créées
ensuite. Une migration doit supprimer la ligne existante — en levant
`FORCE ROW LEVEL SECURITY` et en contournant `protect_system_role_permissions`,
qui interdit précisément de toucher aux permissions d'un rôle système. Même
chorégraphie que la migration 0022, en sens inverse.

**La friction assumée** : un `owner` absent bloque tout changement de rôle.
Acceptable parce qu'une organization peut compter **plusieurs `owner`** — la
règle du dernier n'en exige qu'un — et que la délégation se fait à l'avance.
⚠️ À surveiller si des `owner` deviennent des comptes de facturation qui ne se
connectent jamais, sans second propriétaire : ce serait le premier point de
douleur, et le signal qu'il faut reconsidérer.

**L'attaque de l'ADR 0011 est bloquée plus tôt.** Un `admin` ne peut plus se
fabriquer un rôle portant `org.delete` : il ne peut plus définir de rôle du
tout. La règle d'escalade reste indispensable, mais pour le **délégué**.

Détail de la matrice : [../architecture/roles-permissions.md](../architecture/roles-permissions.md).
