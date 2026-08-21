# 0013 — La portée d'un rôle n'est pas vérifiée à l'invitation

**État** : **fait**
**Priorité** : 🔴 Avant la Team de projet, qui repose entièrement dessus
**Ouvert le** : 2026-08-21 · **Clos le** : 2026-08-21

## Le constat

`createInvitation` (`backend/src/services/invitations.ts`) accepte n'importe
quel `roleId` de l'organization, sans regarder son `scope`. L'acceptation range
ensuite la personne selon la seule présence d'un `project_id` :

```
if (invitation.projectId) → project_members
else                      → organization_members
```

Et `organizationGrant` (`backend/src/auth/authorization.ts`) code la portée en
dur :

```ts
scope: "organization",
```

Conséquence : inviter avec un rôle de portée **projet** (`editor`) et **sans**
`project_id` crée un membre d'organization dont les permissions d'`editor`
valent sur **tous** les projets.

## Ce que ce n'est pas

Pas une escalade de privilèges. Le garde-fou d'escalade tient — l'inviteur ne
peut accorder que des permissions qu'il détient. C'est une escalade de
**portée** : un rôle conçu pour un projet agit partout. Le garde-fou ne la voit
pas, puisqu'il compare des permissions et non leur étendue.

## Pourquoi ça n'est pas encore arrivé

La console filtre `role.scope === "organization"` avant de proposer les rôles
([`console/app/routes/team.tsx`](../../console/app/routes/team.tsx)), avec ce
commentaire :

> *la **portée** : un rôle de projet ne s'attribue qu'avec un projet, et le
> service refuserait la combinaison*

⚠️ **Le service ne refuse rien.** La protection est entièrement dans l'écran, ce
que le projet interdit explicitement — *« La console masque, elle n'autorise
pas »*, et *« l'autorisation est vérifiée côté serveur sur chaque route, jamais
déduite de l'UI »*. Un appel direct avec un `member.manage` valide suffit.

Le commentaire est donc à corriger en même temps que le code : il décrit une
garantie qui n'existe pas.

## Ce qu'il faut

Dans `createInvitation`, après la résolution du rôle et avant l'insertion :

| Portée du rôle | `project_id` |
|---|---|
| `project` | requis |
| `organization` | interdit |

Le refus a sa place parmi les autres codes stables du service, à traduire dans
`apiErrorMessage` côté console.

Même vérification partout où un rôle s'attribue — l'assignation directe compte
autant que l'invitation, exactement comme pour l'escalade de privilèges
([ADR 0011](../adr/0011-roles-personnalises-par-organization.md)).

## Ce qui a été fait

Le défaut a d'abord été **reproduit**, pas déduit : invitation `editor` sans
projet, acceptée sans broncher, puis

```
portée obtenue : organization
projets couverts : []
permissions : content.publish, content.read, content.read_draft,
              content.write, schema.read
```

Puis trois tests, écrits avant la correction et rouges à ce moment-là — un par
combinaison refusée. `createInvitation` porte maintenant les deux contrôles,
juste après le garde-fou d'escalade.

**Le refus est un `422`, pas un `400`.** La requête est bien formée ; c'est sa
combinaison qui ne tient pas. Zod occupe déjà le 400 à la frontière des routes,
et les confondre empêcherait un client de distinguer un corps mal formé d'un
refus de fond. Le service n'émettait aucun 400 jusque-là.

Le commentaire de `console/app/routes/team.tsx` — *« le service refuserait la
combinaison »* — est devenu vrai. Il décrivait une garantie absente ; il décrit
maintenant celle qui existe.

Les deux codes stables `scope_mismatch` et `unknown_project` sont traduits dans
`apiErrorMessage`. Le contrat OpenAPI est **inchangé** : aucune forme de
requête ni de réponse n'a bougé, seulement les refus possibles.

## Lié

- [architecture/securite.md](../architecture/securite.md#une-permission-a-une-étendue-pas-seulement-un-nom)
- [architecture/roles-permissions.md](../architecture/roles-permissions.md#ce-quun-membre-de-projet-voit)
