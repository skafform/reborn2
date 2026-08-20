# ADR 0001 — Postgres nu, sans helper propriétaire

**Statut** : Accepté
**Date** : 2026-08-19

## Contexte

L'itération précédente du projet reposait sur Supabase. En repartant de zéro,
la question s'est posée de garder cette pile ou d'en sortir.

Le besoin réel est une base PostgreSQL. Les services annexes de Supabase
(Auth, Storage, Realtime) ne sont pas utilisés — l'authentification passe par
Better-Auth.

## Décision

**PostgreSQL standard, sans dépendance à un fournisseur.**

Interdits, même lorsqu'ils simplifient à court terme :

- les imports `drizzle-orm/supabase` et `drizzle-orm/neon` et leurs rôles
  prédéfinis
- Neon Authorize
- `auth.uid()` et les conventions RLS de Supabase
- toute extension Postgres propriétaire

Le contexte RLS est posé par `set_config` standard.

## Alternatives écartées

**Rester sur Supabase.** Aurait apporté RLS et l'auth clés en main, mais lié
le modèle d'autorisation à `auth.uid()` et donc à Supabase Auth — incompatible
avec le choix de Better-Auth.

**Adopter les helpers d'un fournisseur.** Gain immédiat, verrouillage durable.

## Conséquences

Le déploiement peut basculer vers Neon, Supabase-comme-hébergeur ou AWS RDS
sans réécriture — compatibilité vérifiée, le motif `SET LOCAL` en transaction
explicite fonctionnant sur les poolers en mode transaction.

Deux réglages restent proscrits : `EXCLUDE_VARIABLE_SETS` sur RDS Proxy (AWS
avertit qu'il peut faire fuiter les variables de session entre connexions) et
le pooling en mode *statement*, qui casse les variables de session.

Cette latitude porte sur la **base**, pas sur l'authentification : adopter
Supabase Auth signifierait abandonner Better-Auth et tout ce qui en dépend.

Détail : [../architecture/database.md](../architecture/database.md).
