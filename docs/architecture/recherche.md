# Recherche plein texte

**Non construit au MVP**, et — bonne nouvelle — **aucune couture profonde
n'est nécessaire**.

## Postgres suffit, précisément grâce au JSONB

Postgres permet une colonne **`tsvector` générée** (`GENERATED ALWAYS AS`)
alimentée par `jsonb_to_tsvector` sur la colonne `data` des documents, avec un
**index GIN** dessus. Cela transforme un balayage complet de table en
consultation d'index.

Cette approche est explicitement recommandée pour les CMS à contenu JSONB
dynamique — donc exactement notre cas. **Ni Algolia ni Elasticsearch ne sont
nécessaires pour démarrer.**

## Pourquoi la couture est superficielle

La colonne générée et son index GIN s'ajoutent par un `ALTER TABLE`, sans
toucher au modèle de données ni aux requêtes existantes. Rien à prévoir
aujourd'hui.

Seule précaution le jour venu : créer l'index GIN `CONCURRENTLY` si la table
contient déjà du volume.

## La vraie dépendance : la langue

`to_tsvector` exige une **configuration linguistique** (`english`, `french`…).
Sans connaître la langue d'un document, impossible de l'indexer correctement —
la racinisation et les mots vides diffèrent d'une langue à l'autre.

C'est donc la **localisation** qui conditionne la recherche, et non l'inverse.
Voir [localisation.md](./localisation.md).

## Affiner plus tard

Piste possible une fois la base en place : marquer dans la définition d'un
schéma quels champs sont *searchable*, plutôt que d'indexer indistinctement
toutes les chaînes de `data`. Ajoutable à tout moment.

## Sources

- [Preferred Index Types for Text Search | PostgreSQL Docs](https://www.postgresql.org/docs/current/textsearch-indexes.html)
- [Tables and Indexes | PostgreSQL Docs](https://www.postgresql.org/docs/current/textsearch-tables.html)
- [Speeding Up PostgreSQL Full-Text Search with Persistent TSVectors](https://danielabaron.me/blog/speed-up-pg-fts-with-persistent-ts-vectors/)
