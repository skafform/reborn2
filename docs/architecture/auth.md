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
par `sendResetPassword`, et servie par un seul écran de console
(`routes/reset-password.tsx`) : sans jeton il demande le lien, avec un jeton il
demande le mot de passe. Deux formulaires, un seul sujet — et l'adresse ne
bouge pas, puisque c'est le lien du courriel qui y ramène.

⚠️ **Le formulaire de demande ne dit jamais si le compte existe** : il
répondrait sinon à qui veut énumérer les comptes.

⚠️ **C'est aussi le chemin de « définir un mot de passe »** pour un compte
arrivé par OAuth seul — voir *Deux hypothèses* plus bas.

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

## OAuth — GitHub construit, Google prévu

**Aucune migration n'a été nécessaire** : la table `account` de Better-Auth
porte déjà plusieurs fournisseurs par utilisateur — email/mot de passe et OAuth
cohabitent nativement.

### Un fournisseur est facultatif, et c'est le serveur qui le dit

`GITHUB_CLIENT_ID` et `GITHUB_CLIENT_SECRET` sont **facultatifs mais
appariés** : la CI n'a pas d'application OAuth, et un identifiant sans son
secret fait échouer le démarrage plutôt que le premier clic.

D'où `GET /api/auth-providers`, sans session : un client doit savoir quels
boutons afficher **avant** d'en avoir une, et deviner produirait soit un bouton
qui échoue, soit un bouton absent qui marcherait. La liste est **relue depuis
la configuration de Better-Auth**, jamais redéclarée — deux listes
dériveraient, et celle-ci mentirait sans bruit.

⚠️ **Pas sous `/api/auth/`** : `app.ts` y donne tout à Better-Auth, la route
serait avalée.

⚠️ **L'URL de retour à déclarer chez le fournisseur dérive de
`BETTER_AUTH_URL`, pas de la console** — `${BETTER_AUTH_URL}/api/auth/callback/github`.
Le navigateur quitte donc l'origine de la console le temps du retour. En
développement ça marche quand même parce que **les cookies ignorent le port** :
celui que le backend pose sur `localhost:3000` vaut sur `localhost:5173`.

### ⚠️ La confirmation d'adresse ne suit pas toute seule

`requireEmailVerification` ne couvre que l'email/mot de passe. Un compte GitHub
dont l'adresse n'est **pas vérifiée chez GitHub** obtiendrait une session — et
c'est exactement la personne que la règle existe pour arrêter, puisque les
invitations sont appariées sur l'adresse seule.

D'où `socialProviders.github.requireEmailVerification`, **par fournisseur** :
Better-Auth ne crée alors aucune session et répond `email_not_verified`.
L'email de confirmation part quand même, `sendOnSignUp` étant posé.

Les portées par défaut du fournisseur — `read:user`, `user:email` — sont ce qui
lui permet de lire le drapeau *verified* de GitHub.

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

### La section « comptes liés »

⚠️ **Elle n'est pas un confort.** Sans elle, la liaison manuelle qu'impose
`disableImplicitLinking` serait **impossible** : la politique deviendrait un
cul-de-sac au lieu d'une friction. Elle est donc arrivée avec le premier
fournisseur, pas après.

Elle liste le mot de passe et les fournisseurs sur le même pied — c'est ce qui
rend lisible « il m'en reste une autre » avant de déconnecter. Better-Auth
refuse de retirer la dernière (`FAILED_TO_UNLINK_LAST_ACCOUNT`) ; la console
masque l'action dans ce cas, **par confort, jamais comme garde-fou**.

⚠️ Déconnecter exige une session récente (`freshAge`, un jour par défaut).
C'est le seul geste du compte qui puisse échouer pour une raison qui n'a rien à
voir avec ce qu'on demande.

### Les deux hypothèses, et ce qu'elles sont devenues

1. **Le flux d'invitation ne suppose pas « mot de passe »** — un invité peut
   accepter en s'inscrivant via un fournisseur, l'email de celui-ci devant
   correspondre exactement à celui de l'invitation (voir
   [invitations.md](./invitations.md))
2. **Tous les comptes n'ont pas de mot de passe** — qui arrive par OAuth seul
   n'en a aucun. ⚠️ Et **`setPassword` de Better-Auth est `serverOnly`**, donc
   injoignable depuis la console. La réponse n'est pas une route de plus :
   `resetPassword` **crée** le compte `credential` quand il n'y en a pas
   (`api/routes/password.mjs`). « Définir un mot de passe » est donc le même
   chemin que « je l'ai oublié » — et il prouve la possession de l'adresse au
   passage, ce qu'un simple formulaire ne ferait pas

### Ce qu'il reste

- **Google.** Le seul travail supplémentaire est chez eux : un écran de
  consentement renseigné, là où GitHub n'en demande pas. Côté code, un objet
  de plus dans `socialProviders` et une entrée dans `ui/providers.tsx`
- ⚠️ **Une application OAuth par fournisseur *et par environnement***, les URI
  de redirection différant

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
