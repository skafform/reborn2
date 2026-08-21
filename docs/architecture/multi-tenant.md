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

## Un compte sans organization est un état normal

⚠️ **Aucune organization n'est créée automatiquement à l'inscription**, ni par
défaut ni sous un nom générique (« My org »). Un compte sans organization
n'est ni transitoire ni une anomalie à corriger — c'est exactement l'état de
quelqu'un qui vient d'un lien d'invitation et n'a pas à en fonder une.

L'écran d'accueil de la console est donc **l'espace personnel** dont parle la
section précédente, pas un aiguillage. Il doit se comporter comme n'importe
quel autre écran vide de ce produit (voir la convention des états vides,
`console/app/ui/controls.tsx#Empty`) : une phrase qui dit quoi faire ensuite,
jamais une redirection qui retire le choix.

- **Aucune organization** → l'espace personnel affiche l'état vide : créer
  une organization, ou attendre une invitation
- **Une ou plusieurs organizations** → l'espace personnel mène directement à
  la dernière, ou à un choix s'il y en a plusieurs

Deux raisons, vérifiées avant de trancher plutôt que supposées :

1. **Le parcours d'invitation n'a jamais besoin de ce forçage.** Accepter une
   invitation d'organization donne déjà une organization avant même que la
   personne n'atterrisse ici — le forçage ne s'appliquait donc, dans les
   faits, qu'au parcours organique (inscription directe, sans invitation)
2. **Un nom d'organization par défaut coûte plus qu'il ne fait gagner.**
   Provisionner une organization automatiquement (« My org », ou même
   personnalisée à partir du nom du compte) évite un clic, mais laisse un nom
   qui fuit vers les personnes invitées ensuite tant que personne ne le
   change — et aucun écran de renommage n'existe aujourd'hui pour ça. Ne pas
   créer d'organization du tout évite le problème plutôt que d'en déplacer le
   coût

⚠️ **« Espace personnel » désigne un écran, pas une nouvelle frontière de
portée.** Aucun contenu, projet ou environnement ne doit exister hors
`organization_id` : c'est la frontière de locataire posée par RLS
([securite.md](./securite.md)), et une deuxième frontière parallèle
imposerait ses propres policies pour un gain qu'aucun besoin réel ne justifie
aujourd'hui.

**Reste ouvert** — les invitations de *projet* ne créent aucune adhésion
d'organization (voir plus haut) : la personne qui en accepte une atterrit sur
cet espace personnel toujours sans organization, alors qu'elle appartient
déjà à un projet. La console ne sait pas encore présenter « vous êtes membre
d'un projet, sans organization » ; ce trou reste distinct de la décision
ci-dessus, et n'est pas réglé par elle.

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
