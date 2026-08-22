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

⚠️ **« Chacune » a été faux pendant longtemps, et l'est redevenu vrai le
2026-08-22.** Le contrôle **énumérait** les tables à vérifier, et cette liste
écrite à la main avait dérivé sans un bruit : `api_keys`, `invitations`,
`project_members` y manquaient depuis leur création, `schema_versions` et
`schema_history` depuis la leur — **cinq sur treize**. Une `FORCE` perdue sur
l'une d'elles aurait laissé le serveur démarrer, ce qui est exactement la panne
que ce fichier existe pour attraper.

La liste est **inversée** : toute table de `public` est réputée multi-tenant,
et seules les quatre tables de Better-Auth sont exclues — chacune avec sa
justification écrite à côté, parce qu'une liste d'exclusion dérive aussi.
Le critère est nommé : *pas de colonne de cadrage par conception*, donc rien
sur quoi une policy pourrait porter.

L'oubli change ainsi de camp. Ajouter une table sans ses policies fait
**refuser le démarrage** au lieu de passer inaperçu.

Deux tests éprouvent l'inversion plutôt que de la redire : l'un affirme
qu'aucune table de `public` hors RLS n'échappe à l'exclusion, l'autre retire
`FORCE` d'`api_keys` — une des cinq oubliées — et vérifie que le contrôle la
voit, avant de la rétablir.

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
