# Décisions ouvertes

**Des questions, pas des tâches.** Ce qui reste à trancher, avec le degré
d'urgence. Le détail vit dans le document de chaque aspect — cette page ne sert
que d'index.

Une question qui trouve sa réponse devient un item de
[../backlog/](../backlog/) ; si elle tranchait une décision structurante, elle
devient aussi un [ADR](../adr/).

Les écarts entre le code et l'architecture ne sont **pas** ici : ce sont des
tâches, elles vivent dans le [backlog](../backlog/).

## Plus rien à trancher avant la couche contenu

✅ **Les quatre questions sont fermées.** Le versionnage et le moment de la
validation le 2026-08-21 — **ensemble**, le premier supposant une réponse au
second sans la nommer — puis les références et la clôture du publié le
2026-08-22.

La dernière s'est formulée en **invariant** plutôt qu'en règle : *ce qui est
publié ne pointe que vers du publié*. Les deux vérifications — publier,
dépublier — en découlent au lieu d'être deux règles à tenir d'accord
([ADR 0021](../adr/0021-ensemble-publie-clos-par-reference.md)).

## À trancher plus tard, sans coût de retard

- **Liste complète des emails transactionnels** — inscription (magic link),
  invitation, réinitialisation de mot de passe, alertes de sécurité éventuelles
- **Gestion des secrets et des environnements de déploiement** (dev / staging /
  prod), variables d'environnement
- **Facturation** — le modèle de plans et de plafonds. Le *comptage*, lui, est
  décidé ([comptage-de-l-usage.md](../research/comptage-de-l-usage.md)) et se
  construit à l'étape 7

## Tranché depuis

- ~~Environnements `master`/`staging`~~ → couture retenue, voir
  [environments.md](./environments.md)
- ~~Transfert de propriété d'une organization~~ → **rien à définir** : c'est
  promouvoir quelqu'un `owner` puis se retirer, et une organization peut en
  compter plusieurs ([multi-tenant.md](./multi-tenant.md#suppression))
- ~~Qui exploite le service, et comment~~ → hors de l'application, en local
  ([ADR 0015](../adr/0015-exploitation-hors-ligne-jamais-dans-l-application.md))
