# 0003 — Transaction explicite et contexte RLS par requête

**État** : ouvert
**Priorité** : 🔴 Avant la première requête applicative (étape 3)
**Ouvert le** : 2026-08-20

## Ce qu'il faut

Toute requête applicative doit s'exécuter **dans une transaction explicite**,
avec le contexte de cadrage posé par :

```sql
set_config('app.current_organization_id', $1, true)
```

Le troisième argument à `true` limite la portée à la transaction. Un `SET`
simple persisterait sur la connexion et **fuiterait vers la requête suivante
du pool** — décrit dans la littérature comme la façon la plus courante de
casser accidentellement l'isolation multi-tenant.

## Forme attendue

Un point de passage unique — les requêtes applicatives ne s'écrivent pas
directement contre le pool. C'est ce point qui ouvre la transaction et pose le
contexte, à partir de l'acteur résolu (session utilisateur ou clé API).

Une requête qui contournerait ce point s'exécuterait sans contexte : les
policies renverraient zéro ligne. L'échec est visible, pas silencieux — c'est
voulu.

## Attention

Ne s'applique **pas** aux tables Better-Auth, qui ont leur propre pool et ne
sont pas sous RLS (voir [ADR 0002](../adr/0002-deux-proprietaires-de-schema.md)).

## Contrainte d'hébergement

Ce motif impose un pooler en mode **transaction** ou **session**. Le mode
*statement* casse les variables de session. Sur AWS RDS Proxy, `SET LOCAL`
épingle la connexion, et l'option `EXCLUDE_VARIABLE_SETS` est **proscrite** —
elle peut faire fuiter les variables entre connexions.

Voir [ADR 0003](../adr/0003-rls-frontiere-tenant-roles-en-code.md) et
[ADR 0001](../adr/0001-postgres-nu-sans-verrouillage-fournisseur.md).
