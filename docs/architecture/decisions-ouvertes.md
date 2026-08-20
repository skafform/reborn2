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

### Quand la validation s'applique-t-elle ?

[content-schemas.md](./content-schemas.md) dit que la validation se fait à
l'API via un schéma Zod généré dynamiquement, mais pas **quand** :

- **À l'écriture seulement** — les documents déjà en base ne sont jamais
  revalidés. Ajouter un champ obligatoire ne casse rien rétroactivement ; la
  contrainte s'applique à la prochaine modification du document
- **À l'écriture et à la lecture** — tout doit toujours être conforme, donc
  un changement de schéma invalide instantanément le contenu existant

*Piste privilégiée : à l'écriture seulement.* C'est ce que font Sanity et
Contentful ; le second modèle transforme chaque modification de schéma en
incident de production. À noter : avec ce choix, ce qui casse n'est jamais le
stockage mais le **site du client**, s'il suppose la présence d'un champ
absent des anciens documents.

### Versionnage des schémas

Conséquence directe du choix « schéma en base plutôt que dans le code » (voir
[content-schemas.md](./content-schemas.md)). Si un `admin` supprime un champ
par erreur, il n'existe aujourd'hui :

- aucun historique de l'état antérieur du schéma
- aucun retour en arrière possible
- et le journal d'audit ([audit.md](./audit.md)) enregistre *qu'il y a eu*
  une modification, pas *ce qui a changé*

Les environnements ne comblent pas ce trou : staging protège **pendant** un
test, il ne restaure rien **après** une erreur en production.

Deux pistes : conserver chaque révision de `definition` avec possibilité de
restauration, ou enrichir le journal d'audit pour qu'il stocke le diff.

### Références entre documents

Voir [content-schemas.md](./content-schemas.md#références-entre-documents--à-trancher)
— recherche faite, options posées, piste privilégiée identifiée (`data` comme
source de vérité + table d'index dérivée). Le point qui mérite débat : faut-il
bloquer la publication d'un document qui référence un brouillon non publié,
comme le fait Sanity ?

## À trancher plus tard, sans coût de retard

- **Transfert de propriété** d'une organization — mentionné dans les
  permissions `owner` ([roles-permissions.md](./roles-permissions.md)), jamais
  défini
- **Liste complète des emails transactionnels** — inscription (magic link),
  invitation, réinitialisation de mot de passe, alertes de sécurité éventuelles
- **Gestion des secrets et des environnements de déploiement** (dev / staging /
  prod), variables d'environnement
- **Facturation** — apparaît dans les permissions `owner`, aucun document

## Tranché depuis

- ~~Environnements `master`/`staging`~~ → couture retenue, voir
  [environments.md](./environments.md)
