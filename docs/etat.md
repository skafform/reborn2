# Où en est le projet

**Dernière mise à jour : 2026-08-20.** Ce document est le point d'entrée pour
reprendre le travail. Il dit où on en est, ce qui reste, et par quoi commencer.

## Le socle est complet

Étapes 1 à 6a de la [feuille de route](roadmap.md). **89 tests au vert**,
typecheck et lint propres, aucune dérive de schéma.

| | |
|---|---|
| Serveur | Hono + `@hono/zod-openapi`, validation d'environnement au démarrage |
| Authentification | Better-Auth sur `pg.Pool`, confirmation d'adresse obligatoire, réinitialisation de mot de passe |
| Multi-tenant | 10 tables applicatives sous RLS **activé et forcé**, point de passage `withContext` |
| Autorisation | Rôles personnalisables par organization, catalogue de 16 permissions, `can()`, garde-fous d'escalade |
| Invitations | Jeton haché, email verrouillé, usage unique, plafond par organization |
| Emails | Gabarits maison sans dépendance, prévisualisation sur `/dev/emails` |
| Clés API | Publique · preview · secrète, par environnement |

**Tout ce qui précède est générique** — rien n'y parle de CMS. C'est le socle
réutilisable dont il a été question à plusieurs reprises.

## À faire immédiatement

**1. Committer le travail de l'étape 6a.** 28 fichiers non commités : la table
`api_keys`, son service, ses tests, sept migrations, l'ADR 0013, et les leçons
RLS ajoutées à `securite.md` et `CLAUDE.md`.

**2. Pousser.** 7 commits attendent `git push` — l'origine est en retard depuis
l'étape 3.

**3. Poser le tag du socle.** `git tag socle-v0` marque la frontière entre ce
qui est réutilisable et ce qui devient le CMS. Depuis ce point on pourra créer
un dépôt template ou extraire un paquet, sans rien maintenir entre-temps. Voir
la discussion résumée dans [architecture/overview.md](architecture/overview.md).

## Étape 6b — là où le CMS commence

C'est la prochaine étape de construction : `schemas`, `documents`, et l'API de
livraison de contenu.

Trois décisions sont à prendre **avant** d'écrire cette couche. Elles sont
détaillées dans
[architecture/decisions-ouvertes.md](architecture/decisions-ouvertes.md) :

1. **Quand la validation s'applique** — à l'écriture seulement, ou aussi à la
   lecture. Piste privilégiée : à l'écriture seulement
2. **Versionnage des schémas** — aujourd'hui, supprimer un champ par erreur est
   irréversible
3. **Références entre documents** — recherche faite, piste privilégiée
   identifiée ; le point en débat est de savoir s'il faut bloquer la
   publication d'un document référençant un brouillon

Rappels structurants pour cette étape :

- `documents` porte déjà `locale` et `translation_group_id`
  ([localisation.md](architecture/localisation.md))
- Le contenu est rattaché à `environment_id`, jamais à `project_id`
  ([ADR 0006](adr/0006-couture-environnements.md))
- L'API de lecture doit rester en **GET avec paramètres d'URL**, sinon le cache
  CDN devient impossible ([cache.md](architecture/cache.md))
- Toute écriture passe par un **point d'émission d'événements unique**, dont le
  journal d'audit est le premier consommateur
  ([ADR 0008](adr/0008-point-d-emission-d-evenements-unique.md))

## Backlog ouvert

Deux items, tous deux conditionnels — voir [backlog/](backlog/) :

| # | Item | Quand |
|---|---|---|
| [0004](backlog/0004-cors-admin-ui.md) | CORS pour l'admin UI | Quand l'admin UI existera |
| [0008](backlog/0008-resolution-des-projets-d-un-membre.md) | Résolution des projets d'un membre | À mesurer avant d'agir |

Sept autres items ont été clos. **Plus rien ne bloque une mise en ligne.**

## Ce qui viendra plus tard

[architecture/evolutions-prevues.md](architecture/evolutions-prevues.md)
recense sept fonctionnalités connues et la **couture** posée pour chacune —
cache CDN, assets, localisation, webhooks, SSO, quotas, OAuth, 2FA, recherche.
Aucune ne demande de travail aujourd'hui ; toutes ont leur indirection en
place.

## Pièges à ne pas redécouvrir

Les plus coûteux, tous rencontrés en construisant :

- **Une policy RLS ne référence jamais une autre table sous RLS** — cycle
  refusé par Postgres, et `SECURITY DEFINER` n'y change rien
- **Une migration de données sous RLS doit lever `FORCE`** — sinon elle ne
  touche aucune ligne, silencieusement
- **`@better-auth/cli` génère un schéma périmé** — utiliser
  `scripts/migrate-auth.ts`
- **drizzle-kit génère parfois un ordre invalide** — contrainte unique après la
  clé étrangère qui en dépend
- **Définir `onError` sur Hono retire son traitement par défaut** — les
  `HTTPException` doivent être reconverties
- **Les rôles Postgres appartiennent au cluster**, pas à la base

Le détail vit dans [CLAUDE.md](../CLAUDE.md) et
[architecture/securite.md](architecture/securite.md).
