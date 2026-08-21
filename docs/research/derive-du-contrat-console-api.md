# Recherche — empêcher la dérive entre la console et l'API

**Recherche menée en août 2026**, après avoir constaté que la console déclare
ses types **à la main** au lieu de les dériver du contrat que le serveur
publie. Voir [../adr/0005-depots-separes-contrat-openapi.md](../adr/0005-depots-separes-contrat-openapi.md),
dont c'est la partie jamais éprouvée.

## Le problème, démontré sur le code

`console/app/routes/team.tsx` déclarait :

```ts
type Member = { userId: string; roleName: string; name: string; email: string; joinedAt: string };
```

Le serveur en envoie **six** — il y a aussi `roleId`. Deux descriptions du même
objet, sans rien qui les relie.

**Reproduit pour de vrai** : renommer `roleName` en `role` côté serveur, des
deux côtés proprement (schéma Zod **et** requête Drizzle).

| Contrôle | Résultat |
|---|---|
| Typecheck backend | ✅ vert |
| Typecheck console | ✅ **vert** |
| Lint des deux côtés | ✅ vert |

Rien ne signale quoi que ce soit. Et pourtant `member.roleName` vaut
`undefined` — la colonne « Role » du tableau Équipe s'affiche **vide**.

La cause : `api<Member[]>(…)` est une **affirmation**, pas une vérification.
`fetch` renvoie `unknown`, et le paramètre de type dit à TypeScript de faire
confiance. S'il est faux, TypeScript ne peut pas le savoir.

## Ce que la littérature appelle « API drift » — et qu'on n'a pas

> *Votre définition dit que la réponse contient X, Y et Z, mais votre serveur
> ne renvoie que X et Y.*

C'est le problème central que toute cette littérature cherche à résoudre. **Il
ne peut pas se produire ici**, et c'est un bénéfice non mesuré d'un choix fait
au début du projet.

**Vérifié empiriquement** : un handler modifié pour renvoyer `[{ nimporte:
"quoi" }]` fait échouer le typecheck du backend —

```
Type '{ nimporte: string; }[]' is not assignable to type
'{ userId: string; roleId: string; roleName: string; … }[]'
```

`@hono/zod-openapi` contraint le retour du handler à ce que sa route déclare.
La spec dit donc la vérité sur ce que le serveur envoie. La plupart des équipes
ne peuvent pas l'affirmer, leur spec étant du YAML écrit à côté du code.

**Conséquence** : la moitié la plus difficile du problème est déjà réglée. Il
ne reste que « la copie du consommateur correspond-elle à la spec ? ».

## Ce que font les autres

**Le patron majoritaire** — commiter la spec dans le dépôt du consommateur,
générer depuis ce fichier, et faire échouer la CI si le résultat diffère
(`git diff --exit-code`). Aucun serveur en marche nécessaire.

> *« Manual regeneration equals nobody regenerates »* — consensus unanime : ce
> qui n'est pas automatique n'est pas fait.

**Contract testing** (Pact) — le consommateur déclare ce qu'il utilise, le
producteur vérifie qu'il le fournit. Attrape ce qu'un schéma ne dit pas :
quelles entrées produisent quel statut, les combinaisons de champs optionnels
invalides, et **quels clients dépendent de quoi** — ce qui permet de supprimer
un champ sans risque. Une infrastructure entière.

**Registre de schémas** (Confluent, Glue) — la référence en microservices, avec
règles de compatibilité imposées avant publication. Surdimensionné ici.

**Stripe** — la spec est un artefact **versionné et taggé**, publié à chaque
release. Deux variantes : une publique, une annotée pour leurs générateurs.

**PactFlow « Drift »** — le producteur **s'auto-vérifie** avant de publier :
l'API réelle correspond-elle à sa définition ? C'est ce que notre typecheck
fait déjà, gratuitement.

## La validation à l'exécution ferme le dernier trou

La génération de types seule laisse un trou : **le fichier généré peut être
périmé**. Rien n'oblige à le régénérer, et `--check` exige un backend en
marche, donc ne peut pas être un garde-fou automatique.

Zod le ferme autrement — non par un numéro de version, mais en **confrontant la
donnée réelle**. Un fichier périmé décrit l'ancienne forme, le serveur envoie
la nouvelle, la validation échoue. Plus précis qu'une vérification de version :
celle-ci dit « ta copie date », Zod dit « ce champ-là a changé ».

Un cas que **seule** la validation attrape, relevé par la littérature :

> *Quelqu'un garde son onglet ouvert pendant que vous redéployez. Son
> navigateur parle à une console d'avant, contre un serveur d'après.*

Aucune vérification à la compilation ne peut rien contre ça.

## Ce que l'essai a révélé, et que la documentation ne disait pas

Orval 8.24 exécuté sur notre spec réelle, dans un répertoire jetable hors du
projet. Les contraintes fines traversent fidèlement :

```ts
"email":    zod.email(),
"roleId":   zod.uuid(),
"joinedAt": zod.iso.datetime({ offset: true }),
"name":     zod.string().check(zod.minLength(1)).check(zod.maxLength(200)),
```

⚠️ **`strict: { response: true }` est un piège.** Il paraît plus sûr, il ne
l'est pas :

| Le serveur… | avec `strict` | sans |
|---|---|---|
| **ajoute** un champ | ❌ **refusé** | ✅ accepté |
| **renomme** un champ | ✅ refusé | ✅ refusé |
| **change le type** d'un champ | ✅ refusé | ✅ refusé |

`strict` ferait casser la console sur un **ajout de champ** — changement
rétrocompatible, que la console n'utilise même pas. Sans lui, on attrape tout
ce qui compte et on tolère l'ajout.

**C'est la découverte principale de cette recherche**, et elle n'apparaît dans
aucune documentation : seul l'essai l'a montrée.

## Zod Mini : la limite, et sa réparation

> *Zod Mini ne charge aucune locale par défaut ; tous les messages valent
> `Invalid input`.*

Gênant, puisque tout l'intérêt est de savoir **quoi** a changé. Trois lignes
suffisent :

```ts
import * as z from "zod/mini";
import { en } from "zod/locales";
z.config(en());
```

**Vérifié** : `path` et `code` sont présents **dans les deux cas**. Sans
locale, on aurait `{ code: 'invalid_type', path: ['members', 0, 'roleName'],
message: 'Invalid input' }` — le chemin nomme déjà le champ. La locale
n'ajoute que la phrase lisible, qui vaut largement ses trois lignes.

L'autre différence de Mini est **syntaxique** : `z.string().check(z.minLength(5))`
au lieu de `z.string().min(5)`. Comme Orval génère le code, on ne l'écrit
jamais — ça ne coûte rien. Mini exige Zod 4 et refuse Zod 3.

## Ce qui reste ouvert, sans maquillage

1. **Les chemins** — `api("…/membres")` compilerait toujours. Orval peut
   générer un client complet qui les verrouille ; ça réécrit tous les appels
   pour un risque jamais survenu ici
2. **Les corps de requête** — Orval les génère, rien ne force à s'en servir
3. **Ce que personne n'exécute** — la validation ne se déclenche que sur les
   écrans qu'on ouvre
4. **Le moment** — fichier périmé : on l'apprend en faisant tourner
   l'application, pas dans la PR

⚠️ **Corollaire à assumer** : ça transforme une dégradation discrète en panne
visible. `api()` doit traiter l'échec de validation proprement — un message,
jamais un écran blanc.

**Le gain n'est pas « la dérive devient impossible »**, mais : une donnée
silencieusement fausse devient un échec bruyant qui nomme le champ.

Fermer complètement demanderait un CI qui fait tourner les deux, du contract
testing, ou une spec publiée en artefact versionné. Les trois n'ont de sens
qu'une fois les déploiements séparés.

## Sources

- [openapi-typescript — CLI](https://openapi-ts.dev/cli)
- [Orval — génération Zod](https://orval.dev/docs/guides/zod)
- [Zod Mini](https://zod.dev/packages/mini) et
  [personnalisation des erreurs](https://zod.dev/error-customization)
- [Schemas are not contracts — PactFlow](https://pactflow.io/blog/schemas-are-not-contracts/)
- [Schemas can be contracts (Drift) — PactFlow](https://pactflow.io/blog/schemas-can-be-contracts/)
- [What is API contract testing](https://totalshiftleft.ai/blog/what-is-api-contract-testing)
- [Zero API Drift in 2026](https://aetherio.tech/en/articles/generation-types-typescript-openapi-synchronisation-backend-frontend)
- [stripe/openapi](https://github.com/stripe/openapi)
