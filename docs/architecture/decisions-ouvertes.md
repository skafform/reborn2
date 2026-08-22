# Décisions ouvertes

**Des questions, pas des tâches.** Ce qui reste à trancher, avec le degré
d'urgence. Le détail vit dans le document de chaque aspect — cette page ne sert
que d'index.

Une question qui trouve sa réponse devient un item de
[../backlog/](../backlog/) ; si elle tranchait une décision structurante, elle
devient aussi un [ADR](../adr/).

Les écarts entre le code et l'architecture ne sont **pas** ici : ce sont des
tâches, elles vivent dans le [backlog](../backlog/).

## À trancher avant d'écrire la couche contenu

### Références entre documents

Voir [content-schemas.md](./content-schemas.md#références-entre-documents--à-trancher)
— recherche faite, options posées, piste privilégiée identifiée (`data` comme
source de vérité + table d'index dérivée). Le point qui mérite débat : faut-il
bloquer la publication d'un document qui référence un brouillon non publié,
comme le fait Sanity ?

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
