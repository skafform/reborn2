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

- L'utilisateur s'inscrit avec son email, son nom et un mot de passe
- Il reçoit aussitôt un email de **confirmation d'adresse**, à usage unique
- **Tant qu'il n'a pas cliqué, il ne peut pas se connecter** —
  `requireEmailVerification` refuse la session
- Le clic confirme l'adresse et ouvre directement la session
  (`autoSignInAfterVerification`), sans redemander le mot de passe
- Il accède alors à son **espace personnel**, pas encore rattaché à une
  organization
- Depuis cet espace, il peut créer une ou plusieurs organizations — il en
  devient automatiquement `owner` (voir
  [multi-tenant.md](./multi-tenant.md))

Ce que ça ferme : sans confirmation, n'importe qui crée un compte avec
l'adresse d'un tiers et s'en sert — pour recevoir les invitations qui lui
étaient destinées, notamment.

### Écart avec l'esquisse initiale

Le cadrage décrivait un flux inverse — entrer son email, recevoir un lien,
*puis* choisir nom et mot de passe. C'est le chemin standard de Better-Auth qui
a été retenu : éprouvé, et il ferme le même risque.

Il en reste une différence, mineure : dans le flux implémenté, un compte non
confirmé **existe** avec l'adresse visée, ce qui empêche son propriétaire
légitime de s'inscrire — l'adresse est prise. Une gêne, pas une brèche. La
parade usuelle est de renvoyer l'email de confirmation lorsqu'une inscription
vise une adresse déjà prise mais non confirmée (`onExistingUserSignUp` chez
Better-Auth). À faire si le cas se présente.

## Réinitialisation de mot de passe

Pour qui a **oublié** le sien, donc depuis l'écran de connexion. Implémentée
par `sendResetPassword`.

- L'utilisateur demande une réinitialisation → email contenant un lien
- Lien **valide 1 h**, à **usage unique**
- Après changement effectif du mot de passe, **toutes les sessions actives
  sont révoquées** — si le compte était compromis, l'attaquant perd son accès
  au moment même du reset
- Rate limité (voir *Rate limiting* ci-dessous)

## Changement de mot de passe

Pour qui **connaît** le sien, depuis l'écran de compte de la console. Aucune
route applicative n'y participe : `/change-password` appartient à Better-Auth,
qui exige l'ancien mot de passe.

⚠️ **Les autres sessions sont révoquées ici aussi** (`revokeOtherSessions`), et
pour la même raison qu'au reset : on change son mot de passe parce qu'on le
croit connu d'un tiers. Better-Auth supprime toutes les sessions puis en ouvre
une neuve pour le navigateur courant — seul celui-ci survit.

⚠️ **Cet écran suppose que le compte a un mot de passe.** C'est vrai
aujourd'hui, ce ne le sera plus avec OAuth — voir *Deux hypothèses à ne jamais
coder en dur* plus bas. Better-Auth refuse alors par
`CREDENTIAL_ACCOUNT_NOT_FOUND` : l'écran ne casse pas, mais il proposera le
mauvais geste tant qu'il ne distinguera pas *définir* de *changer*.

## Changement d'email

- **Hors périmètre** : un utilisateur ne peut pas changer l'email de son
  compte. Cela évite d'avoir à gérer les invitations en attente adressées à
  l'ancienne adresse, qui deviendraient inutilisables (la correspondance
  d'email est stricte, voir [invitations.md](./invitations.md))
- L'écran de compte affiche donc l'adresse **en lecture seule, avec la
  raison** — plutôt que de l'omettre : savoir sous quel compte on est connecté
  est la première chose que cet écran sert à voir

## Suppression de compte

**Non construite, et ce n'est pas un écran manquant** : que devient la dernière
`owner` d'une organization ? Le trigger `protect_last_owner` refusera de la
laisser partir, à raison. Il faut trancher — transférer, supprimer
l'organization, ou refuser — avant d'ouvrir le bouton.

## Comptes créés via invitation

- Pas de vérification supplémentaire requise — cliquer sur le lien
  d'invitation prouve déjà la possession de l'email (voir
  [invitations.md](./invitations.md))

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

**Posée dans `src/auth.ts`, avant qu'un seul fournisseur existe.** C'est le
seul réglage de ce fichier qui devient coûteux avec le temps : une fois des
comptes liés, en changer impose de défaire des liaisons.

⚠️ **Elle avait été décidée ici sans être écrite là-bas**, et le décalage
n'était pas visible : sans fournisseur OAuth, rien ne lie quoi que ce soit. Le
défaut se serait appliqué le jour de l'ajout de Google, silencieusement.

⚠️ **Et le garde-fou intégré de Better-Auth ne nous protégeait pas.** La
liaison implicite exige que l'adresse locale soit confirmée
(`requireLocalEmailVerified`, vrai par défaut) — or `requireEmailVerification`
l'impose déjà à tout le monde. La condition qui aurait pu freiner est donc
**toujours** satisfaite chez nous.

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
   proposer « définir un mot de passe », pas « le changer ». ⚠️ L'écran de
   compte de la console propose aujourd'hui « changer » sans condition

### Ce qu'il restera à construire

- **Une section « comptes liés »** dans l'écran de compte. ⚠️ Sans elle, la
  liaison manuelle qu'impose `disableImplicitLinking` est **impossible** :
  la politique retenue deviendrait un cul-de-sac plutôt qu'une friction
- **Les identifiants en environnement** — facultatifs, mais **appariés** :
  un `CLIENT_ID` sans son `SECRET` doit faire échouer le démarrage. Le motif
  existe déjà dans `config/env.ts` pour `RESEND_API_KEY`
- **Une application OAuth par fournisseur *et par environnement***, les URI
  de redirection différant. Google demande en plus un écran de consentement
  renseigné, GitHub non — d'où l'ordre suggéré : GitHub d'abord

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
