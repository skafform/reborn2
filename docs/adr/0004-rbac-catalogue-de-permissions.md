# ADR 0004 — RBAC : catalogue de permissions et point de vérification unique

**Statut** : Accepté, **partiellement remplacé par
[ADR 0011](0011-roles-personnalises-par-organization.md)**
**Date** : 2026-08-20

> ⚠️ Une seule décision de cet ADR est caduque : la correspondance rôle →
> permissions ne vit plus dans une constante en code mais en base, le besoin de
> rôles personnalisés par organization ayant été exprimé depuis. Tout le reste —
> catalogue défini en code, règle de découpage, point de vérification unique,
> catalogue partagé avec les clés API — reste en vigueur.

## Contexte

Le modèle comporte deux niveaux de rôles — organization (`owner`, `admin`,
`viewer`) et projet (`editor`, `contributor`, `guest`) — plus trois types de
clés API aux capacités distinctes.

L'état de l'art situe précisément le risque :

> RBAC échoue rarement parce que le schéma est faux — il échoue parce que les
> règles autour du schéma n'ont jamais été décidées, produisant des cas
> particuliers non documentés et une application incohérente.

## Décision

**RBAC comme motif d'implémentation** :

- Un **catalogue de permissions atomiques** (`content.publish`,
  `schema.write`, `member.manage_admin`…)
- Une **correspondance rôle → permissions** dans une constante versionnée en
  code
- **Un seul point de vérification** `can(acteur, permission, ressource)` —
  jamais de `if (role === 'editor')` dans un handler

**Règle de découpage** : une permission existe quand elle exprime une
différence réelle dans la matrice. Deux permissions dont les colonnes seraient
identiques partout n'en font qu'une.

Les **clés API partagent ce catalogue**, ce qui évite un second système
d'autorisation et se referme sur l'acteur polymorphe du journal d'audit.

## Alternatives écartées

**Vérifications de rôle en dur dans les handlers.** Rend la logique rigide et
disperse les exceptions ; c'est la cause d'échec identifiée ci-dessus.

**Rôles personnalisés définis par les clients, dès maintenant.** Contentful et
Sanity réservent tous deux cette fonctionnalité à leurs paliers payants — c'est
une fonctionnalité produit monétisable, pas un prérequis technique.
*(Décision renversée le lendemain : voir
[ADR 0011](0011-roles-personnalises-par-organization.md).)*

**ReBAC façon Zanzibar (OpenFGA, SpiceDB).** Résout des graphes d'autorisation
que ce projet n'a pas ; deux niveaux de rôles fixes ne justifient pas un moteur
externe.

## Conséquences

La matrice est **purement déclarative**, sans exception à compléter en code, et
tient dans une seule table lisible d'un coup d'œil.

Ajouter un rôle devient une colonne dans cette matrice — aucun code à modifier
au-delà de la constante.

Les rôles personnalisés se feront en déplaçant la correspondance **du code vers
la base**, sans toucher au catalogue ni aux points de vérification.

La matrice sera ajustée en construisant les routes ; c'est attendu. La seule
discipline à tenir est la règle de découpage.

Détail :
[../architecture/roles-permissions.md](../architecture/roles-permissions.md) ·
[../research/rbac.md](../research/rbac.md).
