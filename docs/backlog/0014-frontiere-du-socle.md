# 0014 — Poser la frontière du socle au premier module de CMS

**État** : ouvert
**Priorité** : 🔴 **Au premier fichier de l'étape 6b**, jamais après
**Ouvert le** : 2026-08-21

## Pourquoi maintenant serait trop tôt, et après trop tard

Le socle et le CMS sont deux projets logiques dans un seul processus. Rien ne
tient cette frontière aujourd'hui — et rien ne peut la tenir, faute de module
de CMS à interdire d'importer.

Elle devient écrivable **et nécessaire** le jour où `src/cms/` existe. Passé
ce jour, chaque import qui traverse dans le mauvais sens est une dette qu'il
faudra défaire.

⚠️ **Rien dans le code ne rappellera jamais qu'il fallait créer ce
répertoire.** D'où cet item, et la note dans CLAUDE.md.

## 1 — Le répertoire et la règle

Le CMS dans `src/cms/`, et une règle Biome interdisant à tout le reste de
l'importer. **Éprouvée le 2026-08-21** sur une sonde jetable : un import depuis
`src/services/` est refusé, un fichier de `src/cms/` importe librement le socle
et ses propres voisins.

```json
"overrides": [
  {
    "includes": ["src/**", "!src/cms/**"],
    "linter": {
      "rules": {
        "style": {
          "noRestrictedImports": {
            "level": "error",
            "options": {
              "patterns": [
                {
                  "group": ["**/cms/**"],
                  "message": "Le socle ne dépend jamais du CMS. La flèche va dans un seul sens."
                }
              ]
            }
          }
        }
      }
    }
  }
]
```

Le motif `**/cms/**` attrape les chemins relatifs quelle que soit leur
profondeur — `./cms/x`, `../cms/x`, `../../cms/x` — donc la règle ne se
contourne pas en déplaçant un fichier.

## 2 — Le catalogue composable — **fait**

✅ Le mécanisme est en place : `Permission` est un type marqué dont
`definePermission` est la seule source
([ADR 0019](../adr/0019-catalogue-de-permissions-par-fabrique.md)). Le socle
n'a plus besoin de nommer une clé du CMS pour que `can()` l'accepte.

## 2 bis — ⚠️ Sortir le vocabulaire du contenu : ce n'est pas un déplacement

**Découvert en tentant de le faire.** Le socle ne se contente pas de
*contenir* `content.*` et `schema.*` : deux de ses services s'en **servent**.

| Où | Ce qu'il en fait |
|---|---|
| `services/api-keys.ts` | `API_KEY_PERMISSIONS` — la portée d'une clé publique, preview ou secrète **est** une liste de permissions de contenu |
| `services/organizations.ts` | `listProjects` et `findProject` gardent la visibilité d'un projet sur `content.read` |

Déplacer les clés casse donc le socle. Ce qu'il faut trancher d'abord :

- **La table des portées de clés** appartient-elle au CMS ? Une clé API est de
  l'infrastructure, mais ce qu'elle *ouvre* est du contenu. L'y sortir demande
  un second registre — et c'est là que la ligne du « pas de système de
  plugins » se pose vraiment
- **La visibilité d'un projet** doit-elle rester gardée par `content.read` ? La
  vraie question du socle est « cet acteur atteint-il ce projet ? », et
  `content.read` n'en est qu'un proxy hérité

⚠️ **Tant que ce n'est pas tranché, `src/cms/` n'a pas de premier fichier** —
et la règle d'import ci-dessus n'a rien à garder. Elle est écrite, éprouvée,
et attend.

Aujourd'hui `config/permissions.ts` mélange les deux mondes — `member.manage`
et `org.delete` sont du socle, `content.publish` et `schema.write` sont du CMS.
Tant que c'est le cas, la règle d'import empêche le socle de *dépendre* du CMS,
mais pas d'en *contenir* le vocabulaire.

### ⚠️ Ce n'est pas un déplacement de chaînes

Le nœud est ailleurs, et il a été identifié en préparant l'étape 6b :

- `SYSTEM_ROLES` vit dans le socle et **accorde** aujourd'hui `schema.*` et
  `content.*`
- `seedSystemRoles` sème ces rôles à chaque création d'organization
- la table `permissions` est la cible de clé étrangère qui rend toute
  permission inconnue impossible à accorder

Si les clés du CMS sortent du socle, `SYSTEM_ROLES` ne peut plus les nommer.
Il faut donc que `seedSystemRoles` parcoure un **registre** que le module CMS
alimente en important le socle — jamais l'inverse. C'est la seule direction qui
préserve la frontière, et elle décide de la forme : une constante devient une
liste composée à l'exécution.

Deux conséquences concrètes :

⚠️ **Il y a bien un rattrapage.** Pas sur les schémas — aucun n'existe — mais
sur les **permissions** : chaque nouvelle clé du CMS doit être insérée au
vocabulaire et accordée aux rôles système de **toutes les organizations déjà
créées**. Exactement le motif de la migration 0027, désactivation du trigger
`role_permissions_protect_system` comprise.

⚠️ **Une migration ne peut pas appeler du code.** Le registre résout le semage
à l'exécution ; l'insertion dans `permissions` reste du SQL écrit à la main.
Les deux doivent rester d'accord, et **rien ne le vérifie aujourd'hui** — un
contrôle de préconditions au démarrage serait le bon endroit
([backlog #0007](0007-amorcage-et-verification-db.md) fait déjà ça pour RLS).

## 3 — Le tag

Un tag au dernier commit avant le premier fichier de CMS. **Repère historique,
pas mécanisme** : il dit *quand* le CMS a commencé, jamais *ce qui est encore
le socle*.

C'est le répertoire qui répond à cette seconde question, à n'importe quel
commit. Le premier tag, `socle-v0`, a été retiré parce qu'il affirmait le
contraire et se trompait après vingt-quatre commits.

⚠️ **Une extraction prend l'état courant de tout ce qui est hors `src/cms/`**,
jamais le commit taggué : les corrections du socle trouvées *en construisant*
le CMS arrivent après le tag, et revenir au tag les perdrait.

## Ce qui est délibérément exclu

**Un second dépôt ou un paquet publié.** Un socle à un seul consommateur n'est
pas une bibliothèque. Et deux dépôts créeraient le risque même qu'on veut
éviter : une correction à reporter d'un côté à l'autre.

**Un système de plugins.** Hono monte déjà des sous-applications, Drizzle lit
un schéma, les migrations sont ordonnées. Le reste serait une API d'extension
conçue avant d'avoir un second consommateur pour la valider.

Détail et raisonnement :
[architecture/evolutions-prevues.md](../architecture/evolutions-prevues.md#extraction-du-socle).
