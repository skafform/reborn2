# Décisions ouvertes

**Des questions, pas des tâches.** Ce qui reste à trancher, avec le degré
d'urgence. Le détail vit dans le document de chaque aspect — cette page ne sert
que d'index.

Une question qui trouve sa réponse devient un item de
[../backlog/](../backlog/) ; si elle tranchait une décision structurante, elle
devient aussi un [ADR](../adr/).

Les écarts entre le code et l'architecture ne sont **pas** ici : ce sont des
tâches, elles vivent dans le [backlog](../backlog/).

## À trancher avant d'écrire les clés API

### À quoi une clé API est-elle rattachée ?

[api.md](./api.md) les scope à `environment_id`. Or les environnements sont un
concept **CMS** — ils existent pour tester un changement de schéma contre du
contenu réel ([environments.md](./environments.md)).

Cela compte parce que les clés API sont considérées comme faisant partie du
**socle réutilisable**, au même titre que l'authentification, les rôles et les
invitations. Un socle générique scoperait plutôt à un **projet**.

- **Rattacher au projet** — socle net, mais il faut un mécanisme pour qu'une
  clé désigne un environnement
- **Rattacher à l'environnement** — plus simple maintenant, moins net à
  extraire

À trancher **avant** d'écrire la table, pas après.

Note connexe : le triplet publique / preview / secrète est lui aussi
CMS-spécifique — la clé *preview* n'existe que parce qu'il y a des brouillons.
Le mécanisme (clé hachée, portée, capacités, révocation) est générique. Même
ligne de découpe que dans [`config/permissions.ts`](../../backend/src/config/permissions.ts),
qui mêle déjà `member.manage` et `org.*` à `content.*` et `schema.*`.

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
