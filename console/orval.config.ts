/**
 * Génération des schémas de validation depuis le contrat de l'API.
 *
 * La console déclarait ses types **à la main**, ce qui dérive sans que rien ne
 * le signale — reproduit : renommer un champ côté serveur laisse les deux
 * typechecks au vert et vide une colonne à l'écran. Les schémas viennent
 * désormais de la description que le serveur publie, et les types s'en
 * déduisent par `z.infer`.
 *
 * ⚠️ L'entrée est un **fichier local**, pas une URL : la génération ne doit pas
 * exiger un backend en marche — clone neuf, CI, déploiement. Ce fichier est
 * rafraîchi par `pnpm api:sync`, qui va le chercher **par HTTP**, jamais par un
 * chemin vers `backend/` (voir docs/architecture/api.md).
 */
export default {
  skafform: {
    input: "./app/lib/openapi.json",
    output: {
      target: "./app/lib/api-schemas.ts",
      client: "zod",
      mode: "single",
      override: {
        zod: {
          version: 4,
          /** Variante élaguable à la compilation : la console est un bundle. */
          variant: "mini",
          /**
           * ⚠️ **Pas de `strict: { response: true }`.** Il paraît plus sûr et
           * ne l'est pas : il ferait échouer la console quand le serveur
           * **ajoute** un champ — un changement rétrocompatible, que la console
           * n'utilise même pas. Sans lui, le renommage et le changement de type
           * restent attrapés. Éprouvé sur la vraie spec ; aucune documentation
           * ne le mentionne.
           */
        },
      },
    },
  },
};
