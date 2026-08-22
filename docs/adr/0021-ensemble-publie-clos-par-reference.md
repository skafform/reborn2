# ADR 0021 — L'ensemble publié est clos par référence

**Statut** : Accepté
**Date** : 2026-08-22

## Contexte

[ADR 0020](0020-references-entre-documents.md) a tranché la structure des
références et laissé une phrase ouverte : *faut-il refuser de publier un
document qui référence un brouillon ?*

Une clé étrangère garantit l'**existence**, jamais l'**état de publication**.
Le `status` vit sur la ligne cible ; aucune contrainte de base ne l'exprime.

## Décision

**Ce qui est publié ne pointe que vers du publié.**

Un invariant, énoncé une fois — pas une règle de plus.

### Les deux vérifications en découlent

| Geste | Refusé quand |
|---|---|
| **Publier** A | A référence un document non publié |
| **Dépublier** B | Un document publié référence B |

⚠️ **La seconde est celle qu'une formulation en règle aurait manquée.** « Ne
pas publier contre un brouillon » ne dit rien de la dépublication — et c'est
pourtant le même trou, ouvert par l'autre bout. Deux règles à tenir d'accord
finissent par diverger ; un invariant et ses conséquences, non.

C'est aussi le test de toute règle qu'on voudra ajouter ici : si elle ne se
déduit pas de cette phrase, c'est qu'elle en est une autre.

### Les cycles, et leur échappatoire

A référence B, B référence A : aucun ne peut être publié en premier.

La sortie est la **publication groupée** — publier un ensemble d'un seul geste,
en vérifiant la clôture sur le **résultat** plutôt que document par document.
Ce n'est pas une exception à l'invariant : c'est la seule façon de le respecter
quand la dépendance est mutuelle.

⚠️ Elle n'est pas construite, et n'a pas à l'être avant qu'un cycle existe.
Mais elle est **planifiée**, ce qui interdit de coder la vérification d'une
manière qui la rendrait impossible : le contrôle porte sur une **transition
d'ensemble**, jamais sur un document isolé — même quand l'ensemble n'a qu'un
membre.

### Où ça vit

Au **point d'émission d'événements unique**
([ADR 0008](0008-point-d-emission-d-evenements-unique.md)), avec le reste des
écritures. L'index dérivé d'ADR 0020 rend les deux questions triviales : ce que
A référence, et ce qui référence B.

## Alternatives écartées

**Tolérer qu'un document publié pointe vers un brouillon.** L'API de livraison
servirait alors une référence vers quelque chose que le public ne peut pas
lire — un identifiant qui ne résout rien. Le travail de tolérance retombe sur
chaque rendu, exactement ce qu'ADR 0020 a écarté pour les références pendantes.
La même raison, appliquée à l'état plutôt qu'à l'existence.

**Formuler deux règles séparées.** Écrire « on ne publie pas contre un
brouillon » puis, plus tard, « on ne dépublie pas ce qui est référencé ». C'est
ce qu'on aurait fait sans l'invariant — et la seconde ne serait probablement
jamais venue, parce que rien ne l'appelle.

**Avertir sans refuser.** Un avertissement qu'on peut passer outre n'est pas un
invariant : il devient une case à cocher, puis une habitude.

## Conséquences

⚠️ **Dépublier peut être refusé**, ce qui est nouveau : jusqu'ici, dépublier
était toujours possible. Le refus doit **nommer ce qui pointe**, comme celui de
la suppression — sans quoi il est indéchiffrable.

**La publication groupée devient une fonctionnalité attendue**, pas une idée.
Le jour où quelqu'un modélise deux types qui se référencent mutuellement, c'est
la seule issue.

**La vérification porte sur un ensemble dès le premier jour**, même à un
membre. Écrire la version « un document » d'abord obligerait à la réécrire.

**C'est ce que fait Sanity**, et pour la même raison : une référence publiée
qui ne résout pas est un défaut visible chez le client, pas chez nous.
