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
