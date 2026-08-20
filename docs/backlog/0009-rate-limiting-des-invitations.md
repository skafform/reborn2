# 0009 — Rate limiting des invitations

**État** : **fait**
**Ouvert le** : 2026-08-20 · **Clos le** : 2026-08-20

Plafond par organization sur une fenêtre glissante
(`INVITATION_RATE_LIMIT` dans `src/config/constants.ts`), compté sur la table
`invitations` elle-même — `created_at` et `organization_id` y sont déjà, donc
aucun stockage supplémentaire. Les invitations annulées comptent : sinon
annuler puis réinviter contournerait le plafond. Au-delà, un 429.

Reste ouvert, à rouvrir si le cas se présente : un plafond **par
destinataire**, pour empêcher le harcèlement d'une même adresse depuis
plusieurs organizations.

## Le risque

Rien ne plafonne aujourd'hui le nombre d'invitations qu'une organization peut
émettre. N'importe qui peut créer un compte, créer une organization, et
envoyer des milliers d'emails depuis notre domaine.

La conséquence ne touche pas que l'abuseur : un domaine d'envoi signalé fait
**tomber la délivrabilité de tous les emails du système** — magic links,
réinitialisations de mot de passe, invitations légitimes. La panne est globale
et lente à réparer.

C'est prévu dans [architecture/invitations.md](../architecture/invitations.md)
mais non implémenté.

## Pourquoi ce n'est pas encore fait

L'étape 5 visait le mécanisme d'invitation lui-même. Le plafonnement est une
protection d'exploitation, pas une règle métier — mais il devient bloquant dès
qu'un inconnu peut s'inscrire.

## À faire

Un plafond **par organization et par fenêtre glissante** — le nombre exact
reste à choisir, mais l'ordre de grandeur d'un usage légitime est de quelques
dizaines par jour.

Points à trancher le moment venu :

- Où compter : la table `invitations` porte déjà `created_at` et
  `organization_id`, donc un simple `count` sur une fenêtre suffit sans
  stockage supplémentaire
- Que renvoyer au-delà du plafond — un 429 avec la date de réouverture
- Faut-il aussi plafonner par **destinataire**, pour empêcher le harcèlement
  d'une même adresse depuis plusieurs organizations

## Connexe

Better-Auth a son propre rate limiting sur login, inscription et
réinitialisation ([auth.md](../architecture/auth.md)). Celui-ci est distinct :
il porte sur une action applicative, pas sur l'authentification.
