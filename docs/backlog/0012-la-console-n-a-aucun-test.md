# 0012 — La console n'a aucun test

**État** : **entamé** — 2026-08-22
**Priorité** : 🟠 Avant que la console porte de la logique qui lui soit propre
**Ouvert le** : 2026-08-21

## Le constat

`console/` n'a **aucun test**, ni infrastructure pour en écrire. Le backend en
a 113 ; la console, zéro. Il n'y a même pas de script `test` dans son
`package.json`.

Ça touche directement le filet posé par
[architecture/api.md](../architecture/api.md#comment-la-console-dérive-son-client--fait) :
la validation des réponses ne se déclenche que sur **les écrans exécutés**, et
« exécuté » veut aujourd'hui dire *ouvert à la main dans un navigateur*. Un
écran qu'on n'a pas visité depuis un changement d'API ne dira rien tant que
quelqu'un ne l'ouvrira pas — en production, ce sera un utilisateur.

## Pourquoi ce n'est pas fait maintenant

La console est presque entièrement du rendu et des appels. Sa seule logique
propre tient en quelques lignes : le filtrage des entrées de barre latérale par
permission, le choix du rôle par défaut à l'invitation, la traduction d'un code
`reason` en message. Le reste est couvert par les tests du backend, ou par le
contrat généré.

Écrire des tests demande de trancher **quoi** tester, ce qui n'est pas
évident :

| Piste | Ce que ça attrape | Ce que ça coûte |
|---|---|---|
| Tests unitaires sur `lib/` | `displayableError`, `apiErrorMessage`, la validation | Un lanceur de tests, rien de plus |
| Rendu des `clientLoader` / `clientAction` avec un `fetch` simulé | Les écrans **sans** navigateur, donc la validation de contrat sur chacun | Des doublures pour la session et l'API |
| Bout en bout (Playwright) | Le vrai parcours | Un navigateur en CI, une base amorcée |

⚠️ **La deuxième ligne est celle qui ferme le trou décrit plus haut** — pas la
première, et pas forcément la troisième. Un test qui exécute chaque
`clientLoader` contre une réponse capturée force la validation à s'exécuter
partout, sans navigateur.

## À décider en même temps

Le backend utilise `node:test` natif, sans dépendance. La console tourne sur
Vite, dont l'écosystème pousse Vitest. Prendre Vitest ici serait la première
dépendance de test du dépôt — à peser contre l'uniformité, sachant que les deux
projets sont **agnostiques** et n'ont aucune obligation de partager leur
outillage.

## Lié

La CI existe désormais ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml))
et fait tourner le typecheck, le lint et le build de la console. Il ne lui
manque qu'une ligne le jour où des tests existent — c'est le seul travail
restant côté CI.

## Entamé : le premier test existe

`app/lib/content-type-body.test.ts`, six cas, sous **`node:test`** — le même
outil que le backend, donc aucune dépendance ajoutée et aucun runner à
configurer. Il tourne en CI, entre le lint et le build.

⚠️ **Le périmètre a été choisi étroit, exprès.** Pas « tester la console »,
mais une question qui se nomme en une phrase : *le corps assemblé depuis le
formulaire est-il celui qu'on croit ?* Ordre des champs préservé, `validation`
imbriquée, lignes vides écartées sans décaler les suivantes, libellé rogné vers
`null`.

C'est ce qui a rendu ce premier test possible : la partie qui portait de la
logique a été **extraite** de l'écran (`lib/content-type-body.ts`), et elle est
pure — pas de DOM, pas de rendu, pas de réseau, aucun import de valeur. Le
reste de l'écran est de la plomberie que rien ne casse en silence.

⚠️ Le fichier importe son sujet **avec son extension** (`./x.ts`), seul
endroit de la console à le faire : Node résout les chemins lui-même là où Vite
s'en passe. D'où `allowImportingTsExtensions` dans `tsconfig.json`, sans effet
ailleurs puisque rien n'est émis.

**Ce qui reste ouvert** : les écrans eux-mêmes. Le défaut qui a motivé cet item
— `defaultChecked` sur une modale dont les enfants restaient montés — n'aurait
été attrapé que par un test de rendu, qui demande un DOM et donc une
dépendance. C'est une décision à part, pas une suite de celle-ci.
