# Sécurité

## La menace principale : BOLA

**Broken Object Level Authorization** est le risque n°1 du OWASP API Security
Top 10 (API1:2023). En multi-tenant, il se manifeste en *escalade
horizontale* : un client accède aux données d'un autre.

La formulation d'OWASP explique pourquoi c'est la classe de faille la plus
difficile à empêcher par la seule discipline de code :

> BOLA n'est pas causé par des développeurs qui oublient une ligne de code
> précise — il survient quand l'autorisation au niveau objet **n'est appliquée
> par défaut nulle part** dans la pile applicative.

Sans garde-fou en base, le cadrage correct d'une requête est un **acte de
mémoire répété**, par chaque personne qui touche au code, indéfiniment.

## Décision : RLS pour la frontière, TypeScript pour les rôles

| Ce qui est protégé | Où |
|---|---|
| **Frontière multi-tenant** — ne jamais voir les lignes d'un autre locataire | **RLS Postgres**, une policy simple par table sur la colonne de cadrage (`organization_id` / `environment_id`) |
| **Modèle de rôles** — `owner` vs `editor` vs `contributor`, lecture vs écriture, droit de publier | **TypeScript**, dans le middleware — voir [roles-permissions.md](./roles-permissions.md) |

### Pourquoi pas RLS intégral

Le gain de sécurité n'est pas proportionnel à ce qu'on pousse dans RLS.

Le saut décisif est la frontière multi-tenant : elle fait passer le rayon
d'explosion d'*illimité* à *un seul locataire*. Encoder en plus le modèle de
rôles dans des policies apporte un gain marginal bien plus faible, contre une
complexité qui devient elle-même une surface de vulnérabilité — une policy SQL
subtilement fausse échoue aussi silencieusement qu'un `WHERE` oublié, et se
teste beaucoup moins bien qu'une fonction TypeScript.

C'est l'architecture en couches recommandée par OWASP : la couche service
applique les décisions au niveau objet, la couche d'accès aux données ajoute
la défense en profondeur avec les contraintes de locataire.

## Rayon d'explosion

| | Sans RLS | Avec RLS sur la frontière |
|---|---|---|
| `WHERE` de cadrage oublié | Toutes les données de tous les locataires, en 200 OK | Zéro ligne |
| Injection SQL réussie | Dump complet de la base | Limité au locataire courant |
| Bug de logique de rôle | Selon le bug | Limité au locataire courant |
| Détection | Un test ciblé, ou un client qui s'en aperçoit | La requête renvoie vide, l'erreur saute aux yeux |

RLS **n'empêche pas** l'injection SQL — les requêtes paramétrées restent
obligatoires — mais elle en **contient** la portée.

## Ce que RLS ne protège pas

À savoir, pour ne pas créer un faux sentiment de sécurité :

- Les erreurs de rôle **à l'intérieur** d'un locataire (un `viewer` qui écrit,
  un `contributor` qui publie) — c'est la couche TypeScript
- Une clé API fuitée : elle résout un environnement légitime, RLS la laisse
  passer
- Les bugs d'attribution de rôle eux-mêmes
- L'audit, besoin distinct — voir [audit.md](./audit.md)

## Les policies doivent être autonomes

⚠️ **Une policy qui interroge une autre table dont la policy revient vers elle
forme un cycle que Postgres refuse** — « infinite recursion detected », ou un
épuisement de la pile quand le cycle est plus long.

Deux cycles ont été rencontrés en construisant : `projects` ↔ `environments`,
puis `api_keys` ↔ `environments`.

`SECURITY DEFINER` ne les résout **pas** : `FORCE ROW LEVEL SECURITY` soumet
aussi le propriétaire aux policies, donc la fonction rencontre la même boucle.
C'est pourtant le réflexe naturel, et c'est ce qui rend le piège coûteux.

**Le remède est structurel : chaque table porte sa colonne de cadrage.**
`environments` et `api_keys` portent un `organization_id` dénormalisé, garanti
cohérent par une clé étrangère composite. Chaque policy se suffit alors à
elle-même, et les requêtes y gagnent — résoudre une clé API ne touche qu'une
seule table.

Règle à tenir : **une policy ne référence jamais une autre table protégée par
RLS.**

## Une policy par opération, quand l'écriture n'est pas symétrique

La plupart des tables portent deux policies : une `FOR SELECT`, une `FOR ALL`.
`schema_versions` et `schema_history` n'en portent que deux `FOR SELECT` et
`FOR INSERT` — **aucune pour `UPDATE`, aucune pour `DELETE`**.

C'est la même règle que ci-dessus, prise à l'endroit : une table sans policy
est **fermée**. Une version est immuable et un journal est en ajout seul ; ne
pas écrire la policy rend ces deux propriétés vraies au lieu de promises. Un
`FOR ALL` de confort les aurait laissées à la discipline du code.

⚠️ **La cascade fonctionne quand même** : Postgres exécute les actions
d'intégrité référentielle **hors** RLS. C'est ce qui permet de supprimer une
organization avec tout son historique alors qu'aucune policy n'autorise le
moindre `DELETE` dessus. Vérifié par un test, pas déduit du manuel — et le
nettoyage de fin de suite l'exerce à chaque exécution.

⚠️ **Conséquence à ne pas confondre avec une protection** : sans policy, un
`UPDATE` ne lève pas d'erreur, il touche **zéro ligne**. C'est *fail-closed*,
donc sûr, mais silencieux — un code qui tenterait la mise à jour croirait
réussir.

## Migrer des données sous RLS

`FORCE` soumet le propriétaire aux policies, donc un `UPDATE` de remplissage
lancé par une migration **ne touche aucune ligne** — sans erreur, silencieusement.

Il faut lever `FORCE` le temps de l'opération :

```sql
ALTER TABLE t NO FORCE ROW LEVEL SECURITY;
-- remplissage
ALTER TABLE t FORCE ROW LEVEL SECURITY;
```

Supprimer les policies ne conviendrait pas : une table sans policy est
**fermée**, pas ouverte.

⚠️ Une migration qui échoue entre les deux laisse la table **sans FORCE** —
donc son propriétaire hors RLS. C'est arrivé. Le contrôle de préconditions
(`src/db/preconditions.ts`) l'attrape au démarrage suivant, ce qui est
précisément sa raison d'être.

## Les trois risques de configuration

Tous relèvent du réglage initial : vérifiables une fois, puis stables.

**1. Contournement par le propriétaire.** Superusers et propriétaires de tables
ignorent RLS par défaut. Il faut un **rôle applicatif dédié qui n'est pas
propriétaire** des tables, et `FORCE ROW LEVEL SECURITY` sur chacune. C'est le
pire scénario : se croire protégé sans l'être. Se teste en une requête.

**2. Fuite par le pooler.** Le contexte doit être posé avec
`set_config('app.…', $1, true)` — le troisième argument à `true` en limite la
portée à la transaction. Un `SET` simple persiste sur la connexion, et la
requête suivante hérite du contexte du locataire précédent. Conséquence :
**chaque requête tourne dans une transaction explicite**.

**3. Policy qui échoue en mode ouvert.** Le comportement par défaut est le bon :
`current_setting('app.x', true)` renvoie `NULL` si la variable est absente, la
comparaison vaut `NULL`, aucune ligne ne passe — *fail-closed*.

> **Règle : aucune policy ne doit comporter de valeur de repli.** Un `COALESCE`
> de confort détruirait cette propriété et ouvrirait tout.

## Les deux modèles d'accès

Se tromper de modèle produit une route qui fonctionne — mais faussement.

- **Routes de contenu**, authentifiées par clé API (publique / preview /
  secrète). L'appelant est une machine, sans identité utilisateur. Le contexte
  RLS est l'`environment_id` que la clé résout — voir [api.md](./api.md)
- **Routes d'administration**, authentifiées par session Better-Auth.
  L'identité vient **toujours** de la session vérifiée, jamais d'un `user_id`
  ou `organization_id` envoyé par l'appelant

## Une permission a une étendue, pas seulement un nom

Le garde-fou d'escalade compare des **permissions** : on n'accorde pas ce qu'on
ne détient pas. Il ne regarde pas leur **étendue**. Deux acteurs peuvent donc
détenir `content.write` et ne pas pouvoir écrire aux mêmes endroits — c'est la
portée du `Grant` qui tranche, pas le catalogue.

D'où une seconde vérification, distincte et tout aussi serveur : **la portée du
rôle et l'endroit où on l'attribue doivent s'accorder.** Un rôle de portée
projet exige un projet ; un rôle d'organization en refuse un.

⚠️ Sans ce contrôle, un rôle de projet attribué **sans** projet devient une
adhésion d'organization, et ses permissions valent sur *tous* les projets. Le
garde-fou d'escalade laisse passer, puisque aucune permission nouvelle n'est
accordée — seulement plus loin. Cas réel, relevé dans ce code et suivi au
[backlog 0013](../backlog/0013-portee-de-role-non-verifiee.md).

**Ce n'est pas RLS qui protège de ça.** RLS cadre le locataire ; à l'intérieur,
tous les projets d'une organization sont de son côté de la frontière. Le
filtrage par projet est applicatif — même partage des rôles qu'entre RLS et la
matrice RBAC.

## Exceptions et contraintes

**Pas de RLS sur les tables de Better-Auth.** Il gère `user`, `session`,
`account` et `verification` avec son propre pool et doit pouvoir lire
n'importe quel utilisateur au moment du login, avant qu'une session existe.
Ces tables ne sont d'ailleurs pas cadrées par locataire — un utilisateur
n'appartient pas intrinsèquement à une organization. Voir
[database.md](./database.md).

**Index.** RLS ajoute un `WHERE colonne_de_cadrage = …` implicite à chaque
requête. La colonne de cadrage doit être en **tête de chaque index** des
tables concernées, sinon Postgres bascule en balayage complet. À concevoir dès
la création des tables.

## Écarté volontairement

**Chiffrement applicatif par locataire.** Une troisième couche qu'on rencontre
dans la littérature sur les fuites multi-tenant : chiffrer les colonnes
sensibles avec une clé propre à chaque locataire, de sorte qu'une ligne
obtenue par erreur reste illisible.

Pertinent pour des données réglementées, pas pour du contenu de site web
destiné à être publié. Ne résout aucun problème que ce projet a réellement.

## Sources

- [API1:2023 Broken Object Level Authorization | OWASP](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
- [Multi Tenant Security Cheat Sheet | OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- Détail de la recherche : [../research/rls-multi-tenant.md](../research/rls-multi-tenant.md)
