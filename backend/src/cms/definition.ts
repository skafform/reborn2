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
 * ⚠️ **Cinq scalaires, et rien d'autre.** Les deux types composites que tout
 * CMS finit par avoir sont chacun bloqués : `reference` par la dernière
 * décision ouverte, `asset` par un stockage objet qui n'existe pas.
 *
 * En ajouter plus tard **n'invalide aucune empreinte** : une définition
 * existante garde ses octets. Le format s'étend sans casse.
 *
 * `text` et `longtext` ne diffèrent pas au stockage — les deux sont des
 * chaînes — mais partout ailleurs : une ligne contre une zone de saisie, une
 * longueur maximale plausible contre aucune, un champ filtrable contre un
 * corps de texte. Un drapeau `multiline` ferait rendre un même type de deux
 * façons : un indice d'affichage déguisé en type.
 */
export const FIELD_TYPES = ["text", "longtext", "number", "boolean", "date"] as const;

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
    validation: z.object({ required: z.boolean() }),
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
