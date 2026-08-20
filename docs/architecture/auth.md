# Authentification

- **Méthode** : email + mot de passe, via **Better-Auth**
- Better-Auth gère ses propres tables (`user`, `session`, `account`,
  `verification`) nativement via un `pg.Pool` direct — voir
  [database.md](./database.md) pour le détail et la justification de ce choix
- Auth utilisateur (email/password via Better-Auth) pour l'admin UI
- Clé API par projet (header `Authorization`) pour l'API publique/de gestion —
  voir [api.md](./api.md)

## Inscription libre

Point d'entrée réel du système (pas une organization qui invite en premier —
il faut bien qu'un premier `owner` existe).

- L'utilisateur entre son email sur la page d'inscription
- Il reçoit un email avec un **lien à usage unique** (mécanisme magic-link de
  Better-Auth, utilisé ici uniquement pour prouver la possession de l'email —
  pas comme méthode de connexion récurrente, voir *Sessions* ci-dessous)
- En cliquant, il complète son compte (nom + mot de passe)
- Une fois le compte créé, il accède à son **espace personnel**, pas encore
  rattaché à une organization
- Depuis cet espace, il peut créer une ou plusieurs organizations — il en
  devient automatiquement `owner` (voir
  [multi-tenant.md](./multi-tenant.md))

Ce flux est volontairement identique dans sa mécanique à l'acceptation
d'invitation pour un nouvel utilisateur (voir
[invitations.md](./invitations.md)) : lien à usage unique → complétion du
compte. Après cette étape initiale, les connexions suivantes se font par
email + mot de passe, pas par un nouveau lien à chaque fois.

## Changement d'email

- **Hors MVP** : un utilisateur ne peut pas changer l'email de son compte.
  Cela évite d'avoir à gérer les invitations en attente adressées à
  l'ancienne adresse, qui deviendraient inutilisables (la correspondance
  d'email est stricte, voir [invitations.md](./invitations.md))

## Comptes créés via invitation

- Pas de vérification supplémentaire requise — cliquer sur le lien
  d'invitation prouve déjà la possession de l'email (voir
  [invitations.md](./invitations.md))

## Réinitialisation de mot de passe

- L'utilisateur demande une réinitialisation → email contenant un lien
- Lien **valide 1 h**, à **usage unique**
- Après changement effectif du mot de passe, **toutes les sessions actives
  sont révoquées** — si le compte était compromis, l'attaquant perd son accès
  au moment même du reset
- Rate limité (voir *Rate limiting* ci-dessous)

## Sessions

- **Cookies serveur** (défaut Better-Auth), pas de JWT — permet une révocation
  immédiate d'une session (utile pour exclure un membre d'une organization
  sur-le-champ) sans la complexité d'un système de refresh token

## OAuth (Google, GitHub) — prévu, pas construit

Pas au MVP, mais deux coutures sont posées pour que l'ajout n'impose aucun
retour en arrière.

**Aucune couture de base de données n'est nécessaire** : la table `account` de
Better-Auth porte déjà plusieurs fournisseurs par utilisateur — email/mot de
passe et OAuth cohabitent nativement.

### Politique de liaison de comptes : `disableImplicitLinking`

Décision de sécurité prise dès maintenant, car elle est pénible à changer une
fois que des comptes sont liés.

Scénario : Alice a un compte `alice@acme.com` avec mot de passe, puis clique
« Se connecter avec Google » depuis le même email.

- **Retenu** — le système **refuse** (`account_not_linked`). Alice doit
  d'abord se connecter par mot de passe, puis lier Google explicitement depuis
  ses paramètres
- **Écarté** — la liaison automatique sur email vérifié (défaut Better-Auth),
  qui repose entièrement sur la promesse du fournisseur. Si un fournisseur
  vérifie mal les adresses, est mal configuré ou compromis, un attaquant y
  déclare `alice@acme.com` et se retrouve dans le compte d'Alice sans jamais
  avoir connu son mot de passe
- **Écarté aussi** — `trustedProviders`, qui lie même sans vérification du
  fournisseur ; Better-Auth avertit lui-même du risque de prise de contrôle

Justification : chez nous, un compte compromis ne donne pas accès à des
données personnelles mais **au contenu de clients tiers**, avec les
permissions associées. Le coût — une liaison manuelle, une seule fois —
est sans commune mesure avec le risque.

### Deux hypothèses à ne jamais coder en dur

1. **Le flux d'invitation ne doit pas supposer « mot de passe »** — un invité
   devra pouvoir accepter son invitation en s'inscrivant via Google, l'email
   du fournisseur devant correspondre exactement à celui de l'invitation
   (voir [invitations.md](./invitations.md))
2. **Tous les comptes n'auront pas de mot de passe** — un utilisateur arrivé
   uniquement par OAuth n'en a aucun. La réinitialisation de mot de passe et
   la révocation de sessions qui la suit ne le concernent pas ; l'UI doit lui
   proposer « définir un mot de passe », pas « le changer »

## SSO d'entreprise — prévu, pas construit

Better-Auth a un plugin SSO (SAML 2.0 + OIDC) qui stocke une configuration
IdP **par organization** et résout le fournisseur soit par `organizationId`,
soit par **domaine d'email vérifié** — l'organization n'étant attribuée que si
le domaine ne correspond qu'à une seule.

### La couture : ne pas verrouiller les portes d'entrée d'une organization

Le SSO fait du **provisionnement à la volée** : un employé s'authentifie via
l'IdP de son entreprise, et son compte est créé *et rattaché à
l'organization* automatiquement.

Cela introduit une **troisième porte d'entrée**. Aujourd'hui il n'y en a que
deux :

1. Créer l'organization (on en devient `owner`, voir
   [multi-tenant.md](./multi-tenant.md))
2. Accepter une invitation (voir [invitations.md](./invitations.md))

Il ne faut donc **jamais coder en dur** que l'appartenance à une organization
ne peut naître que d'une invitation acceptée. La création d'une ligne
`organization_members` doit rester une opération à part entière, pas un effet
de bord du flux d'invitation.

Viendront plus tard, sans impact sur l'existant : un domaine vérifié porté par
l'organization, et un rôle par défaut attribué aux arrivants par SSO.

## Rate limiting

- Activé dès le départ sur login, inscription et réinitialisation de mot de
  passe via le rate limiting intégré de Better-Auth, pour éviter le
  brute-force sur mot de passe
