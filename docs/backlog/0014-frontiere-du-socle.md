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

## 2 — Le catalogue composable

Le seul vrai travail de conception. `can()` est typé sur `Permission`, qui est
`keyof typeof PERMISSIONS` : pour que le CMS ajoute `content.publish` sans que
le socle le connaisse, le catalogue doit se composer.

⚠️ **À faire avec la première permission de 6b, pas après.** C'est le seul
moment où le coût est faible : le typage de `Permission` remonte jusqu'à
`can()`, donc jusqu'à tout.

Aujourd'hui `config/permissions.ts` mélange les deux mondes — `member.manage`
et `org.delete` sont du socle, `content.publish` et `schema.write` sont du CMS.
Tant que c'est le cas, la règle d'import empêche le socle de *dépendre* du CMS,
mais pas d'en *contenir* le vocabulaire.

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
