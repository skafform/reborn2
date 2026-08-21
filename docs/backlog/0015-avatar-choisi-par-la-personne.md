# 0015 — L'avatar n'est pas choisi par la personne

**État** : ouvert
**Priorité** : 🟢 Quand le stockage objet existera
**Ouvert le** : 2026-08-21

## Pourquoi ce n'est pas fait

L'avatar est un identicon dérivé de l'identifiant du compte : personne ne peut
le remplacer. Décidé de le laisser ainsi pour l'instant — c'est une décoration,
et les deux chemins pour en sortir coûtent plus qu'elle ne rapporte
aujourd'hui.

## ⚠️ Ce qui se perdrait sans ce document

**Un avatar n'est pas un asset au sens du CMS.**
[assets.md](../architecture/assets.md) décrit un stockage adressable par
contenu, **dédupliqué par projet** et cadré par environnement. Une personne n'a
ni projet ni environnement — elle existe *au-dessus* des organizations.

Conséquence : **l'étape 7 ne livrera pas l'avatar au passage.** Il faudra un
second stockage, plus simple, à côté du premier. Compter dessus serait une
mauvaise surprise au moment où on croirait la couture déjà posée.

## Ce qui est déjà en place

- `user.image` existe (`migrations/auth/0001_auth.sql`, `text` nullable) et
  `updateUser({ image })` de Better-Auth l'écrit. **Le champ n'est pas ce qui
  manque** — c'est l'endroit où vivent les octets
- L'écran de compte existe (`console/app/routes/account.tsx`), donc l'endroit
  où poser le contrôle aussi

## Ce que fait le marché

Les jeunes pousses du domaine offrent le choix — c'est une attente, pas un
luxe. Ça ne rend pas l'item urgent : ça dit qu'il ne se refermera pas de
lui-même, et qu'on le paiera un jour ou l'autre.

## Les deux chemins

**Choisir parmi des variantes générées** — la teinte, ou des initiales sur une
pastille de couleur, comme Linear, Notion et Slack. Rien à stocker, aucune
dépendance, aucun envoi. `image` porterait une valeur du genre `initials:6`.

⚠️ Ça **remplacerait** l'identicon plutôt que de le compléter : deux systèmes
d'avatar dans la même colonne serait pire que l'un ou l'autre.

**Téléverser une vraie image** — ce que fait GitHub. Le coût n'est pas dans
l'écran :

| | |
|---|---|
| Où | Un stockage objet qui n'existe pas encore |
| Redimensionner | `sharp` — une dépendance native, à valider |
| Valider | Type, taille, dimensions ; OWASP traite l'upload comme surface d'attaque |
| Facturer | La sortie se compte ([ADR 0015](../adr/0015-exploitation-hors-ligne-jamais-dans-l-application.md)) |
| Modérer | Un service **hébergé** qui accepte des images de clients |

⚠️ **Le piège au milieu** : stocker l'image en `bytea` dans Postgres avec une
route qui la sert. Ça a l'air d'un raccourci — c'est un mini-stockage d'assets
qu'on jetterait, et qui préjuge la conception déjà écrite dans
[assets.md](../architecture/assets.md).

## Le coût qu'on ne verrait qu'après

`GET /organizations/{id}/members` ne renvoie ni `image`, ni de quoi dériver un
choix. Sans ce champ, un avatar changé apparaîtrait dans sa propre barre du
haut **et nulle part ailleurs** — pas dans les tableaux où les collègues se
voient. Contrat à toucher et `api:sync` à relancer, quelle que soit l'option
retenue.
