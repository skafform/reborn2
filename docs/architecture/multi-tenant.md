# Multi-tenant

```
organizations → projects → documents
```

- Isolation des données par `project_id` sur toutes les tables de contenu
- Chaque projet possède ses propres clés API (lecture/écriture séparées, comme
  Contentful)

## Création d'une organization

- N'importe quel utilisateur inscrit (voir [auth.md](./auth.md)) peut créer
  une organization depuis son espace personnel
- Il en devient automatiquement `owner` — c'est ainsi que naît le premier
  `owner` d'une organization (pas d'invitation nécessaire pour ce point de
  départ)
- Un utilisateur peut créer/posséder plusieurs organizations

## Tout compte reçoit son espace, en silence

**Une organization est créée automatiquement à la première connexion d'un
compte qui n'en a aucune.** Sans écran, sans bouton à presser, sans question :
se connecter ne doit rien demander.

Elle porte le nom du compte — `« X's organization »`, jamais un littéral
générique comme « My org ». Ce nom devient visible par toute personne invitée
ensuite, et aucun écran ne permet encore de le changer : autant qu'il désigne
quelqu'un plutôt qu'un emplacement vide.

⚠️ **Ce n'est pas une alternative à l'invitation reçue — les deux
coexistent.** Quelqu'un d'invité qui se connecte **directement**, sans suivre
le lien du courriel, obtient son espace personnel **et** garde son invitation
en attente. Confondre les deux a produit un vrai défaut : l'espace était créé
et l'invitation devenait invisible, alors qu'elle existait toujours en base.
L'invitation l'attend donc dans son **Inbox** (voir
[invitations.md](./invitations.md)).

Ce que la racine de la console fait, dans l'ordre :

1. Au moins une organization → la première
2. Aucune → une est créée à son nom, et on y entre

⚠️ **« Espace personnel » désigne un écran, pas une nouvelle frontière de
portée.** Aucun contenu, projet ou environnement ne doit exister hors
`organization_id` : c'est la frontière de locataire posée par RLS
([securite.md](./securite.md)), et une deuxième frontière parallèle
imposerait ses propres policies pour un gain qu'aucun besoin réel ne justifie
aujourd'hui.

**Reste ouvert** — les invitations de *projet* ne créent aucune adhésion
d'organization : la personne qui en accepte une appartient à un projet sans
appartenir à l'organization qui le porte. La console navigue par organization
et ne sait pas encore présenter ce cas.

## Suppression

Même principe qu'une clé API (voir [api.md](./api.md)) : rien ne se supprime
tant que ce n'est pas vidé au préalable — pas de cascade destructrice
déclenchée par un seul clic.

- Une **organization** ne peut être supprimée que lorsqu'elle ne contient
  plus **aucun projet** et **aucun membre** autre que l'`owner` qui effectue
  la suppression
- Un **projet** ne peut être supprimé que lorsqu'il ne reste plus de membre
  de projet rattaché

Cela force à retirer explicitement les accès avant de détruire quoi que ce
soit, et évite qu'une suppression accidentelle emporte le travail de
plusieurs personnes.

Voir [roles-permissions.md](./roles-permissions.md) pour le détail des rôles à
chaque niveau (organization et projet), et [database.md](./database.md) pour
l'emplacement de ces tables (gérées via Drizzle).
