# ADR 0007 — Localisation au niveau du document

**Statut** : Accepté
**Date** : 2026-08-19

## Contexte

Le contenu multilingue touche le modèle du document lui-même — c'est donc une
décision à prendre avant que des données existent.

Fait notable : **Contentful et Sanity recommandent l'inverse l'un de l'autre.**
Contentful place toutes les langues dans un même document
(`{ "titre": { "fr": …, "en": … } }`) ; Sanity recommande un document par
langue, reliés par une référence partagée.

## Décision

**Structure Sanity, comportement de référence Contentful.**

Deux colonnes sur `documents`, dès le départ et ignorées tant qu'il n'y a
qu'une langue :

- `locale` — `"fr"` par défaut
- `translation_group_id` — égal à `id` tant qu'il n'y a qu'une langue

Une référence vise le **groupe de traduction**, pas une ligne précise ; la
langue demandée est résolue à la lecture.

## Alternatives écartées

**La structure de Contentful (toutes les langues dans un `data`).** Deux
éléments du modèle l'excluent :

1. **La recherche.** `to_tsvector` exige une configuration linguistique ; un
   blob contenant français et anglais ferait appliquer les règles françaises
   aux mots anglais
2. **Le champ `status`.** Publier la version française avant la traduction
   anglaise est un besoin courant ; au niveau champ, `status` devrait devenir
   *par langue* — structure imbriquée ou table séparée

**L'argument de Sanity, tel quel.** Ils déconseillent le niveau champ à cause
d'une limite d'attributs propre à leur Content Lake, qui n'existe pas sous
Postgres/JSONB. Même conclusion, autres raisons — il ne faut pas reprendre leur
justification.

**Une langue par environnement.** Dupliquerait les schémas par langue et
détournerait un mécanisme conçu pour tester des changements.

## Conséquences

L'avantage natif de Contentful — des références indépendantes de la langue —
est récupéré au prix d'une jointure supplémentaire.

Chaque ligne porte son propre `status`, donc la publication par langue est
gratuite.

La recherche plein texte devient correcte dès le premier jour du multilingue :
chaque ligne connaît sa langue, donc sa configuration `to_tsvector`.

Détail : [../architecture/localisation.md](../architecture/localisation.md).
