# 0013 — La portée d'un rôle n'est pas vérifiée à l'invitation

**État** : ouvert
**Priorité** : 🔴 Avant la Team de projet, qui repose entièrement dessus
**Ouvert le** : 2026-08-21

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

## À écrire d'abord

Un test qui reproduit le défaut : inviter avec un rôle `editor` sans projet,
accepter, puis constater que le `Grant` obtenu a la portée `organization`. Il
doit échouer avant la correction, passer après.

## Lié

- [architecture/securite.md](../architecture/securite.md#une-permission-a-une-étendue-pas-seulement-un-nom)
- [architecture/roles-permissions.md](../architecture/roles-permissions.md#ce-quun-membre-de-projet-voit)
