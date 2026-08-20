# ADR 0002 — Deux propriétaires de schéma : Better-Auth et Drizzle

**Statut** : Accepté
**Date** : 2026-08-19

## Contexte

Better-Auth propose un adapter Drizzle, ce qui permettrait à une seule couche
d'accès de gérer toute la base. La recherche a montré que cet adapter souffre
de frictions réelles et récurrentes :

- incompatibilité avec Drizzle v1 et son moteur basé sur Effect-TS
  ([#6766](https://github.com/better-auth/better-auth/issues/6766),
  [#7691](https://github.com/better-auth/better-auth/issues/7691),
  [#7234](https://github.com/better-auth/better-auth/issues/7234))
- comptage de lignes affectées incorrect sur `postgres-js`, corrigé
  tardivement
- erreurs de schéma après montée de version
  ([#5386](https://github.com/better-auth/better-auth/issues/5386))
- signal fort : un adapter tiers non officiel a dû être publié par la
  communauté pour combler le retard

## Décision

La même base Postgres est gérée par **deux systèmes distincts, sans adapter
entre eux** :

- **Better-Auth** possède `user`, `session`, `account`, `verification`, et y
  accède par un `pg.Pool` direct — son moteur Kysely interne
- **Drizzle** gère les tables applicatives, avec des colonnes `user_id` en clé
  étrangère vers `user.id`

## Alternatives écartées

**L'adapter Drizzle de Better-Auth.** Mettrait Drizzle sur le chemin critique
de l'authentification, avec les bugs ci-dessus.

**Le plugin `organization` de Better-Auth.** Il implémente organizations,
membres, rôles et invitations clé en main, mais ne connaît qu'un seul niveau —
il ne couvre pas `project_members`. Ses tables vivraient de surcroît sous la
gestion de Better-Auth, éclatant le modèle applicatif entre les deux systèmes.

## Conséquences

Aucun join SQL entre une table Better-Auth et une table applicative : deux
requêtes, assemblées en code. C'est le pattern que Better-Auth recommande
lui-même.

Les migrations Better-Auth doivent tourner **avant** celles de Drizzle, les
clés étrangères en dépendant. `user` étant un mot réservé SQL, il faut le
quoter.

Si l'adapter Drizzle se stabilise, le rebrancher ne coûte qu'un changement de
configuration, sans toucher aux tables applicatives.

Détail et sources :
[../research/better-auth-drizzle.md](../research/better-auth-drizzle.md).
