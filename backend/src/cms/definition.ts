import { z } from "@hono/zod-openapi";

/**
 * La forme d'une définition de type de contenu.
 *
 * ⚠️ **Ce schéma est hachable**, et c'est ce qui gouverne ses choix. À
 * l'étape suivante, une définition normalisée devient l'identité d'une version
 * ([ADR 0016](../../../docs/adr/0016-versionnage-des-schemas-adresse-par-contenu.md)).
 * Toute forme admettant **deux écritures pour un même sens** produirait deux
 * empreintes pour un même schéma — d'où l'absence de valeurs par défaut
 * injectées et de champs facultatifs redondants.
 */

/**
 * ⚠️ **Cinq scalaires et une référence.** `reference` est arrivé le
 * 2026-08-22 ([ADR 0020](../../../docs/adr/0020-references-entre-documents.md))
 * **sans invalider une seule empreinte** — une définition existante garde ses
 * octets, et c'est exactement ce que cette liste promettait. `asset` reste
 * bloqué par un stockage objet qui n'existe pas.
 *
 * Le format s'étend sans casse.
 *
 * `text` et `longtext` ne diffèrent pas au stockage — les deux sont des
 * chaînes — mais partout ailleurs : une ligne contre une zone de saisie, une
 * longueur maximale plausible contre aucune, un champ filtrable contre un
 * corps de texte. Un drapeau `multiline` ferait rendre un même type de deux
 * façons : un indice d'affichage déguisé en type.
 *
 * ⚠️ **`date` est une date de calendrier, `YYYY-MM-DD`, jamais un datetime** —
 * la même doctrine, prise par l'autre bout : accepter les deux écritures
 * ferait un type à deux formes, dont chaque consommateur (le sélecteur, le
 * tri, les filtres de plage) devrait deviner laquelle il tient. `datetime`
 * sera un **futur type de champ** quand un cas réel le demandera — strict
 * aujourd'hui s'élargit à coût nul, permissif aujourd'hui se resserre en
 * migrant des données clients (`validate.ts`).
 */
export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "boolean",
  "date",
  "reference",
] as const;

/**
 * ⚠️ **`name` est la clé de stockage**, dans `documents.data` et dans les
 * types générés. Elle doit donc être un identifiant, et la contrainte est
 * posée **maintenant** : l'imposer plus tard, sur des noms arbitraires déjà
 * chez des clients, est beaucoup plus dur.
 */
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const FieldSchema = z
  .object({
    name: z.string().regex(IDENTIFIER).max(64).openapi({ example: "title" }),
    type: z.enum(FIELD_TYPES),
    /**
     * ⚠️ **Ce qu'on renomme.** Séparer le libellé de la clé dès la première
     * version est ce qui permet à l'éditeur d'offrir le renommage sans
     * orpheliner les données — et sans graver une faute de frappe. C'est la
     * séparation id/name de Contentful, adoptée pour sa raison.
     *
     * Facultatif : la console affiche `label ?? name`, et le cas courant
     * reste bref.
     */
    label: z.string().min(1).max(200).optional(),
    /**
     * ⚠️ **Toujours présent, `required` compris.** Un objet facultatif
     * donnerait trois écritures pour deux sens — absent, `{}`, ou
     * `{ required: false }` — donc trois empreintes pour un même schéma.
     *
     * Imbriqué plutôt qu'à plat parce que la catégorie est nommée et certaine
     * (`content-schemas.md` parle de « règles de validation ») : `minLength`,
     * `min`, `max`, `pattern` viendront. Y ajouter une clé ne re-hache rien ;
     * déplacer `required` à plat plus tard re-hacherait tout.
     */
    /**
     * Le type de contenu visé, pour un champ `reference` — et **rien d'autre
     * n'en porte**, ce que le raffinement plus bas rend vrai.
     *
     * ⚠️ **Par le *nom* du type, jamais par son identifiant** (ADR 0020), et
     * ce n'est pas une commodité. Un schéma de bibliothèque copié dans trois
     * projets doit rester portable : par nom, chaque copie résout contre
     * l'`author` de **son** environnement ; par identifiant, chaque copie
     * pointerait vers le schéma d'un autre environnement, ce que le cadrage
     * interdit structurellement.
     */
    to: z.string().regex(IDENTIFIER).max(64).optional().openapi({ example: "author" }),
    validation: z.object({ required: z.boolean() }),
  })
  /**
   * ⚠️ **`to` et `reference` vont ensemble ou pas du tout.** Sans ce refus, un
   * champ `text` pourrait porter un `to` que personne ne lit : deux écritures
   * pour un même sens, donc **deux empreintes pour un même schéma** — la
   * chose que la forme d'une définition existe pour empêcher.
   */
  .refine((field) => (field.type === "reference") === (field.to !== undefined), {
    error: "`to` nomme le type visé, et n'appartient qu'à un champ `reference`",
  })
  .openapi("SchemaField");

export const DefinitionSchema = z
  .object({
    /**
     * ⚠️ **L'ordre compte.** Un tableau, jamais un objet indexé par nom :
     * l'ordre est la disposition du formulaire, donc de la donnée
     * (ADR 0016). Réordonner deux champs change l'empreinte, et c'est juste.
     */
    fields: z.array(FieldSchema).max(200),
  })
  .openapi("SchemaDefinition");

export type Definition = z.infer<typeof DefinitionSchema>;

/**
 * Ce qu'un document porte : les valeurs de ses champs, façonnées par une
 * définition mais **jamais typées par elle** — la définition vit en base, donc
 * TypeScript ne peut pas la connaître.
 *
 * ⚠️ Ce n'est pas un aveu de faiblesse : c'est `validate.ts` qui tient la
 * garantie, à l'exécution, contre la définition **courante**. Un type
 * statique ici ne pourrait que mentir.
 */
export type DocumentData = Record<string, unknown>;

/**
 * Deux champs ne peuvent pas partager une clé de stockage.
 *
 * Vérifié ici plutôt que par une contrainte de base : `fields` est un tableau
 * dans un JSONB, et Postgres n'a rien à opposer à un doublon dedans.
 */
export function duplicateFieldName(definition: Definition): string | null {
  const seen = new Set<string>();
  for (const field of definition.fields) {
    if (seen.has(field.name)) return field.name;
    seen.add(field.name);
  }
  return null;
}
