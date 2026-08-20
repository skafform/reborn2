# 0007 — Script d'amorçage et vérification des préconditions

**État** : **fait**
**Ouvert le** : 2026-08-20 · **Clos le** : 2026-08-20

## Le constat d'origine

Les migrations créaient tables, policies, fonctions et triggers, mais **ni les
rôles ni les droits** — qui existent forcément avant elles. Ces opérations
avaient été faites à la main et n'étaient consignées nulle part.

Tout le modèle de sécurité repose dessus : un environnement provisionné sans
ces rôles fait tourner l'application avec le rôle par défaut, souvent
`postgres`, et **RLS devient inerte silencieusement**. L'application
fonctionne, les tests passent, et chaque locataire voit les données de tous les
autres.

## Ce qui a été livré

**`backend/scripts/bootstrap-db.ts`** — idempotent, requiert une connexion
administrateur utilisée uniquement là. Vérifié en reconstruisant une base
vierge de bout en bout : amorçage, deux chaînes de migration, puis **28 tests
au vert** sur cette base.

Le script a été préféré à une procédure documentée pour une raison précise :
les instructions les plus faciles à sauter — le `REVOKE`, les
`ALTER DEFAULT PRIVILEGES` — sont celles dont l'oubli ne fait aucun bruit. Un
copier-coller les rend optionnelles ; un script, non.

**`backend/src/db/preconditions.ts`** — le garde-fou, qui compte davantage : il
vaut quelle que soit la façon dont la base a été mise en place, y compris à la
main ou par la console d'un hébergeur. Il affirme que le rôle applicatif n'est
ni superuser ni porteur de `BYPASSRLS`, qu'il ne possède aucune table
applicative, et que `rowsecurity` **et** `forcerowsecurity` sont actifs sur
chacune.

Appelé au **démarrage du serveur** — qui refuse de démarrer plutôt que de
servir avec une isolation inopérante — et en test, où il vaut spécification
exécutable : sans lui, tous les tests d'isolation pourraient passer sur une
base où RLS ne s'applique pas du tout.

## Ce que la construction a appris

**Les rôles Postgres appartiennent au cluster, pas à la base.** Amorcer une
seconde base sur la même instance avec les noms par défaut réécrit les mots de
passe des rôles de la première et la casse silencieusement — constaté en
testant le script, qui a rendu la base principale inaccessible.

D'où `DATABASE_OWNER_ROLE` et `DATABASE_APP_ROLE`, et l'avertissement affiché à
chaque exécution. C'est exactement le piège d'un staging partageant une
instance avec la production.

Voir [architecture/database.md](../architecture/database.md#provisionnement-dun-environnement).
