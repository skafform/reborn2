# Localisation

Contenu multilingue. **Non construit au MVP**, mais la couture est profonde —
elle touche le modèle du document lui-même — et doit être posée dès le départ.

## 🔴 La couture — deux colonnes sur `documents`

```
documents
  id, environment_id, schema_id, data, current_hash, published_hash,
  created_at, updated_at,
  locale                  ← "fr" par défaut, jamais exposé au MVP
  translation_group_id    ← un groupe par document tant qu'il n'y a qu'une langue
```

⚠️ **Il n'y a pas de colonne `status`** : l'état de publication est dérivé de
deux pointeurs ([ADR 0022](../adr/0022-document-a-deux-pointeurs.md)). Ce
croquis en portait une, et l'argument « le champ `status` » ci-dessous en
dépendait — il tient toujours, mais il faut le lire comme *les deux pointeurs*.

⚠️ `translation_group_id` prend une valeur propre à chaque document plutôt que
l'`id` lui-même : « égal à id » était un raccourci pour « chacun son groupe »,
et une valeur distincte l'obtient sans second aller-retour.

Coût aujourd'hui : deux colonnes que toute la logique ignore. Coût le jour
venu : ajouter des lignes et exposer un sélecteur de langue — aucune
migration, aucune requête à réécrire.

## Le modèle retenu : structure Sanity, références Contentful

Les deux plateformes recommandent l'inverse l'une de l'autre. Le choix retenu
prend la structure de l'une et le comportement de référence de l'autre.

| | Retenu | Origine |
|---|---|---|
| **Structure** | Une ligne par langue, reliées par `translation_group_id` | **Sanity** (localisation au niveau du document) |
| **Références** | Une référence vise le **groupe de traduction**, pas une ligne précise ; la langue demandée est résolue à la lecture | L'avantage que **Contentful** obtient nativement, récupéré ici au prix d'une jointure |

## Pourquoi pas la structure de Contentful

Contentful place toutes les langues dans un même document :
`{ "titre": { "fr": "Bonjour", "en": "Hello" } }`. Deux éléments de notre
modèle l'excluent :

1. **La recherche.** Un seul blob JSONB contiendrait français et anglais, or
   `to_tsvector` exige une configuration linguistique — les règles françaises
   seraient appliquées aux mots anglais. Il faudrait extraire des
   sous-documents par langue avant d'indexer. Voir
   [recherche.md](./recherche.md)
2. **Le champ `status`.** Il vaut aujourd'hui `draft` ou `published` pour tout
   le document. Publier la version française avant que la traduction anglaise
   soit prête est un besoin courant ; au niveau champ, `status` devrait
   devenir *par langue* — structure imbriquée ou table séparée. Au niveau
   document, chaque ligne porte naturellement son propre statut

## Pourquoi l'argument de Sanity ne s'applique pas

Sanity déconseille la localisation au niveau du champ à cause d'une **limite
d'attributs propre à son Content Lake**, particulièrement avec du Portable
Text. Cette contrainte n'existe pas sous Postgres/JSONB.

Nous arrivons donc à la même conclusion qu'eux, mais pour d'autres raisons —
il ne faut pas reprendre leur justification telle quelle.

## À écarter : une langue par environnement

Cela dupliquerait les schémas par langue et détournerait un mécanisme conçu
pour **tester des changements**, pas pour organiser du contenu. Voir
[environments.md](./environments.md).

## Sources

- [Localization strategies | Contentful Help Center](https://www.contentful.com/help/localization/field-and-entry-localization/)
- [Localization | Sanity Docs](https://www.sanity.io/docs/studio/localization)
- [@sanity/document-internationalization](https://www.npmjs.com/package/@sanity/document-internationalization)
