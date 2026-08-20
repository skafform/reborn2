# ADR 0003 — RLS pour la frontière multi-tenant, rôles en TypeScript

**Statut** : Accepté
**Date** : 2026-08-19

## Contexte

La menace principale d'un CMS multi-tenant est **BOLA** (Broken Object Level
Authorization), risque n°1 du OWASP API Security Top 10 : un client accédant
aux données d'un autre.

OWASP en formule la difficulté ainsi :

> BOLA n'est pas causé par des développeurs qui oublient une ligne de code
> précise — il survient quand l'autorisation au niveau objet n'est appliquée
> par défaut nulle part dans la pile applicative.

Sans garde-fou en base, le cadrage correct d'une requête est un acte de
mémoire répété indéfiniment. L'itération précédente utilisait RLS via Supabase
et encodait tout son modèle de rôles dans des fonctions SQL.

## Décision

**RLS pour la frontière multi-tenant uniquement ; le modèle de rôles reste en
TypeScript.**

- Une policy simple par table sur la colonne de cadrage (`organization_id` /
  `environment_id`)
- Les rôles (`owner`, `editor`, `contributor`…) et le droit de publier sont
  vérifiés dans le middleware

Pas de RLS sur les tables Better-Auth : il doit pouvoir lire n'importe quel
utilisateur au moment du login, avant qu'une session existe, et ces tables ne
sont pas cadrées par locataire.

## Alternatives écartées

**Aucun RLS.** Un `WHERE` oublié répond 200 avec les données de tous les
locataires — une fuite qui se lit comme du code qui fonctionne.

**RLS intégral, façon itération précédente.** Le gain de sécurité n'est pas
proportionnel à ce qu'on pousse dans RLS : le saut décisif est la frontière
multi-tenant, qui fait passer le rayon d'explosion d'illimité à un locataire.
Encoder en plus le modèle de rôles ajoute une complexité qui devient
elle-même une surface de vulnérabilité — une policy subtilement fausse échoue
aussi silencieusement qu'un `WHERE` oublié, et se teste beaucoup moins bien.

**Chiffrement applicatif par locataire.** Pertinent pour des données
réglementées, pas pour du contenu de site destiné à être publié.

## Conséquences

Trois contraintes dont la violation est **silencieuse** :

1. Le serveur se connecte avec un **rôle applicatif dédié**, jamais
   propriétaire ni superuser ; `FORCE ROW LEVEL SECURITY` sur chaque table
2. **Chaque requête tourne dans une transaction explicite**, contexte posé par
   `set_config('app.…', $1, true)` — un `SET` simple fuiterait vers la requête
   suivante du pool
3. **Aucune valeur de repli dans une policy** : `current_setting(x, true)`
   renvoie `NULL` si absent, donc aucune ligne. Un `COALESCE` de confort
   ouvrirait tout

La colonne de cadrage doit être en tête de chaque index des tables concernées,
RLS ajoutant un `WHERE` implicite.

RLS ne dispense pas des requêtes paramétrées — elle limite la portée d'une
injection réussie à un seul locataire.

Détail : [../architecture/securite.md](../architecture/securite.md) ·
[../research/rls-multi-tenant.md](../research/rls-multi-tenant.md).
