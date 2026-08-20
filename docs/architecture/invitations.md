# Inscription & invitations

## Table `invitations`

```
id, email, organization_id, project_id (nullable), role, token, invited_by,
expires_at, accepted_at (nullable), cancelled_at (nullable)
```

- `email` est stocké directement sur l'invitation (pas seulement déduit d'un
  `user_id`) — la personne qui s'inscrit ou accepte doit correspondre
  exactement à cet email, ce qui empêche qu'un tiers récupère/partage le lien
  et se fasse ajouter à la place du destinataire prévu
- `project_id` nullable : `null` → invitation au niveau organization,
  renseigné → invitation à un projet spécifique
- `token` : aléatoire, non-devinable, à usage unique
- `email` est **immuable** : on ne modifie jamais l'email d'une invitation
  existante (risque d'usurpation — une invitation validée pour une personne
  serait redirigée vers une autre). Pour corriger une erreur d'adresse, il
  faut annuler l'invitation et en créer une nouvelle

## Ce que l'acceptation crée

| Invitation | Lignes créées à l'acceptation |
|---|---|
| `project_id = null` | Une ligne `organization_members` |
| `project_id` renseigné | **Uniquement** une ligne `project_members` — jamais `organization_members` |

Sur une invitation à un projet, `organization_id` sert seulement à savoir
**quelle organization a émis l'invitation** (listage des invitations d'une
org, application de la règle anti-cumul). Ce n'est pas une appartenance : un
membre de projet reste extérieur à l'organization, même s'il en voit le nom
comme contexte d'affichage (voir
[roles-permissions.md](./roles-permissions.md)).

## Flux — nouvel utilisateur (pas de compte existant)

- Clique sur le lien d'invitation → redirigé vers un **écran d'inscription
  dédié aux invitations**, distinct de l'écran d'inscription publique standard
  (email pré-rempli/verrouillé, correspondant à celui de l'invitation)
- Une fois l'inscription complétée, l'invitation est **acceptée
  automatiquement** — pas d'étape de confirmation supplémentaire

## Flux — utilisateur existant

- Clique sur "Accepter" → vérification que l'email de la session active
  correspond exactement à l'email de l'invitation
- Ajouté automatiquement à l'organization/projet avec le rôle assigné

## Doublons

- Si une invitation **active** (non expirée, non annulée, non acceptée)
  existe déjà pour un couple email + organization/projet donné, aucune
  nouvelle invitation n'est créée
- Si l'invitation existante est **expirée**, une nouvelle invitation peut être
  créée normalement

## Inviter quelqu'un déjà là

Refusé en **409 `already_member`**. Sans ce contrôle l'invitation partait et
devenait **inacceptable à jamais** : l'acceptation insère dans
`organization_members`, dont la clé primaire est `(organization_id, user_id)`,
et la violation remontait en 500.

Le contrôle vise exactement ce que cette insertion violerait :

| Invitation | Refusée si la personne est déjà |
|---|---|
| d'organization | membre de l'organization |
| de projet | membre **de ce projet** |

Un membre de l'organization peut donc toujours être invité sur un projet —
c'est le cas normal, et la portée des deux adhésions est distincte.

⚠️ **Ce n'est pas la façon de changer un rôle.** Inviter un `owner` en `admin`
serait une rétrogradation déguisée. Le changement de rôle est une opération
distincte, avec son propre garde-fou d'escalade.

**Le contrôle à la création ne suffit pas.** L'adhésion peut naître entre
l'envoi et le clic — ajoutée à la main, ou par une autre invitation. Sous
concurrence, seule la clé primaire tranche : l'acceptation traite donc la
violation `23505` comme un refus lisible, jamais comme un 500. Même raisonnement
que pour le doublon d'invitation ci-dessus.

## Annulation

- La personne qui a envoyé l'invitation (ou un admin habilité) peut annuler
  une invitation en attente avant qu'elle soit acceptée (`cancelled_at`)

## Envoi d'email

- **Resend**
- **Rate limité par organization** (plafond quotidien) : sans cela, n'importe
  qui peut créer un compte gratuit, créer une organization et envoyer des
  milliers d'invitations — ce qui ferait blacklister le domaine d'envoi et
  ruinerait la délivrabilité de tous les emails du système

## Expiration

- **7 jours**

## Qui peut inviter

- **Organization, rôle `owner` ou `admin`** : seul un `owner` peut inviter ou
  promouvoir quelqu'un vers `owner` ou `admin`
- **Organization, rôle `viewer`** : `owner` ou `admin`
- **Projet** (`editor`/`contributor`/`guest`) : `owner` ou `admin` de
  l'organization — voir [roles-permissions.md](./roles-permissions.md)
