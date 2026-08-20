# Recherche — RLS Postgres en multi-tenant, sans Supabase

**Recherche menée en août 2026**, pour décider si l'isolation multi-tenant
devait reposer sur Row Level Security une fois Supabase abandonné. Voir la
décision dans [../architecture/securite.md](../architecture/securite.md).

## Le point de départ

L'itération précédente du projet utilisait RLS via Supabase, qui injecte le JWT
dans la session Postgres et expose `auth.uid()` aux policies. Sans Supabase,
la question était : peut-on reproduire ça proprement sur un Postgres nu ?

## Réponse : oui, et Drizzle le supporte officiellement

Drizzle fournit `pgPolicy()`, `pgTable.withRLS()` et `pgRole()`, et drizzle-kit
gère les policies dans les migrations. Ça fonctionne avec un **Postgres
standard**, pas seulement Supabase ou Neon (qui ont juste des imports dédiés
avec des rôles prédéfinis).

Note importante de leur documentation : *« si aucune policy n'existe pour la
table, une policy deny par défaut s'applique »* — aucune ligne n'est visible.

Le motif qui remplace le JWT de Supabase :

```
BEGIN
  set_config('app.current_org_id', $1, true)   -- true = portée transaction
  … requêtes …
COMMIT
```

L'API de transactions de Drizzle correspond directement à ce motif.

## Les quatre pièges documentés

**1. Contournement par le propriétaire.** *« Les superusers et les rôles ayant
l'attribut BYPASSRLS contournent toujours la sécurité au niveau ligne, et les
propriétaires de tables la contournent normalement aussi. »* Impose un rôle
applicatif dédié non-propriétaire et `FORCE ROW LEVEL SECURITY`.

**2. Fuite par le pooler.** Décrit comme *« la façon la plus courante dont les
équipes cassent accidentellement l'isolation »* : un `SET` simple persiste sur
la connexion, la requête suivante hérite du contexte précédent. Le pooling en
mode *statement* casse les variables de session entièrement.

**3. Index.** Sans la colonne de cadrage en tête de chaque index, Postgres ne
peut pas satisfaire efficacement le `WHERE` implicite ajouté par RLS et bascule
en balayage complet.

**4. Variable non définie.** Selon l'écriture des policies, l'absence de
contexte échoue ou renvoie silencieusement du vide — à décider délibérément.

## L'argument sécurité, vérifié auprès d'OWASP

BOLA est le risque **n°1** du OWASP API Security Top 10 (API1:2023). En
multi-tenant il produit une escalade horizontale — un client accédant aux
données d'un autre.

La formulation décisive :

> BOLA n'est pas causé par des développeurs qui oublient une ligne de code
> précise — il survient quand l'autorisation au niveau objet n'est appliquée
> par défaut nulle part dans la pile applicative.

OWASP recommande explicitement RLS comme **défense en profondeur** : *« les
requêtes incluent automatiquement des prédicats d'autorisation sans modifier le
code applicatif ; RLS fournit une défense en profondeur quand la logique
d'autorisation applicative échoue »*, dans une architecture en couches où la
couche service applique les décisions au niveau objet et la couche d'accès aux
données ajoute les contraintes de locataire.

## Ce qui a été retenu, et pourquoi pas plus

**RLS sur la frontière multi-tenant uniquement**, le modèle de rôles restant en
TypeScript.

Le raisonnement est contre-intuitif mais tient : le gain de sécurité n'est pas
proportionnel à ce qu'on pousse dans RLS. Le saut décisif fait passer le rayon
d'explosion d'illimité à un seul locataire. Encoder en plus le modèle de rôles
en policies apporte un gain marginal faible contre une complexité qui devient
elle-même une surface de vulnérabilité — l'itération précédente comptait dix
fonctions d'autorisation dans un schéma `private`.

**Écarté** : le chiffrement applicatif par locataire, rencontré dans la
littérature sur les fuites multi-tenant. Pertinent pour des données
réglementées, pas pour du contenu de site web destiné à être publié.

## Sources

- [Drizzle ORM — Row-Level Security](https://orm.drizzle.team/docs/rls)
- [API1:2023 Broken Object Level Authorization | OWASP](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
- [Multi Tenant Security Cheat Sheet | OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [Postgres Row-Level Security for Multi-Tenancy: The Pattern and the Footguns](https://patotski.com/blog/postgres-row-level-security-multi-tenant/)
- [Postgres RLS for Multi-Tenant SaaS, the Production Pattern](https://theroadtoenterprise.com/blog/postgres-rls-multi-tenant-saas)
