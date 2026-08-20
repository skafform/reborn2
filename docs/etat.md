# Où en est le projet

**Dernière mise à jour : 2026-08-20.** Point d'entrée pour reprendre le
travail : où on en est, ce qui reste, par quoi commencer.

## Le socle est complet et commité

Étapes 1 à 6a de la [feuille de route](roadmap.md). **89 tests au vert**,
typecheck et lint propres. Commit `de5e593`, marqué par le tag **`socle-v0`**.

| | |
|---|---|
| Serveur | Hono + `@hono/zod-openapi`, validation d'environnement au démarrage |
| Authentification | Better-Auth sur `pg.Pool`, confirmation d'adresse obligatoire, réinitialisation |
| Multi-tenant | 10 tables sous RLS **activé et forcé**, point de passage `withContext` |
| Autorisation | Rôles personnalisables par organization, 16 permissions, `can()`, garde-fous |
| Invitations | Jeton haché, email verrouillé, usage unique, plafond par organization |
| Emails | Gabarits maison sans dépendance, prévisualisation sur `/dev/emails` |
| Clés API | Publique · preview · secrète, par environnement |

⚠️ **8 commits et le tag attendent `git push --follow-tags`.**

## En cours : la console d'administration

**Décision prise avant l'étape 6b** : construire l'interface d'administration
d'abord, pour éprouver ce qui existe.

La raison n'est pas de « voir le résultat » : rien de ce qui a été construit
n'a jamais servi à un humain, et les tests ont été écrits contre l'API telle
qu'on l'a faite, pas contre ce dont une interface a besoin. Indice concret —
seules **quatre routes** existent, alors que le travail des étapes 4 à 6a
suppose d'en exposer bien davantage.

Ça éprouvera aussi l'[ADR 0005](adr/0005-depots-separes-contrat-openapi.md),
dont la stratégie OpenAPI → client typé n'a **jamais été essayée**.

### Décisions prises

| | |
|---|---|
| Emplacement | `console/`, **dans ce dépôt** |
| Framework | React Router **8.3**, React 19.2.7+ |
| Rendu | **SPA** (`ssr: false`) — la session est un cookie que le navigateur envoie à l'API ; un serveur intermédiaire n'ajouterait qu'un relais de cookie |
| CORS | **Aucun en développement** : un proxy Vite renvoie `/api` vers `localhost:3000`, rendant chaque requête *same-origin*. Le CORS réel n'aura lieu qu'en production, entre sous-domaines ([backlog #0004](backlog/0004-cors-admin-ui.md)) |
| Design | Repris de `C:\Users\mario\Documents\projets\skafform-reborn\Console\app\console.css` — inspiré de Linear. Sans framework CSS, jetons portés par `.console` et non `:root`, mode sombre, accent ambre |
| Outillage | pnpm, Biome (même configuration que le backend), TypeScript strict |

⚠️ **`console/` dans ce dépôt contredit la lettre de l'ADR 0005**, qui parlait
de deux dépôts. En pratique deux projets dans un dépôt ne font pas un monorepo
au sens outillage — mais **la conclusion ne change pas** : sans workspace ni
package partagé, le mode RPC de Hono reste impraticable, donc le contrat passe
toujours par OpenAPI. **L'ADR 0005 reste à mettre à jour** pour refléter la
disposition réelle.

### Où en est le scaffold

Écrits, **mais rien n'est installé ni lancé** :

```
console/package.json          react-router 8, react 19, biome, vite 8
console/react-router.config.ts   ssr: false, avec sa justification
console/vite.config.ts           proxy /api -> localhost:3000
console/tsconfig.json            strict, jsx react-jsx, types RR générés
console/biome.json               copié du backend
console/.gitignore               node_modules, build, .react-router
console/app/routes/             (vide)
```

### Par quoi continuer

1. `cd console && pnpm install`
2. Écrire `app/root.tsx`, `app/routes.ts`, `app/console.css` — les idiomes RR8
   se lisent dans la console de référence citée plus haut
3. Vérifier que `pnpm dev` sert une page
4. Premier parcours, choisi parce qu'il traverse tout d'un coup :
   **s'inscrire → confirmer l'adresse → créer une organization → inviter**
5. Compléter l'API **au fil de l'eau**, quand un écran révèle un manque —
   plutôt que de deviner les routes à l'avance

### Routes API manquantes, déjà identifiées

Le service existe, la route non : lister les membres, changer un rôle, retirer
un membre, créer et modifier un rôle personnalisé, supprimer un projet,
renommer une organization, gérer les clés API.

## Étape 6b — là où le CMS commence

`schemas`, `documents`, API de livraison. **Trois décisions à prendre avant**,
détaillées dans [architecture/decisions-ouvertes.md](architecture/decisions-ouvertes.md) :
quand la validation s'applique, versionnage des schémas, références entre
documents.

Rappels structurants :

- `documents` porte déjà `locale` et `translation_group_id`
- Le contenu est rattaché à `environment_id`, jamais à `project_id`
- L'API de lecture reste en **GET avec paramètres d'URL** — sinon plus de cache
- Toute écriture passe par un **point d'émission d'événements unique**

## Backlog ouvert

| # | Item | Quand |
|---|---|---|
| [0004](backlog/0004-cors-admin-ui.md) | CORS pour l'admin UI | En production seulement — le proxy le règle en développement |
| [0008](backlog/0008-resolution-des-projets-d-un-membre.md) | Résolution des projets d'un membre | À mesurer avant d'agir |

Sept items clos. **Plus rien ne bloque une mise en ligne.**

## Pièges à ne pas redécouvrir

- **Une policy RLS ne référence jamais une autre table sous RLS** — cycle
  refusé par Postgres, et `SECURITY DEFINER` n'y change rien puisque `FORCE`
  soumet aussi le propriétaire
- **Une migration de données sous RLS doit lever `FORCE`** — sinon elle ne
  touche aucune ligne, silencieusement, et si elle échoue entre-temps la table
  reste sans protection
- **`@better-auth/cli` génère un schéma périmé** — utiliser
  `scripts/migrate-auth.ts`
- **drizzle-kit génère parfois un ordre invalide** — contrainte unique après la
  clé étrangère qui en dépend
- **Définir `onError` sur Hono retire son traitement par défaut**
- **Les rôles Postgres appartiennent au cluster**, pas à la base
- **Le mailer réel ne s'installe qu'au démarrage du serveur** — un import ne
  doit jamais pouvoir expédier un email

Détail dans [CLAUDE.md](../CLAUDE.md) et
[architecture/securite.md](architecture/securite.md).
