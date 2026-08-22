import type { ContentType } from "./api-contract";

/**
 * Ce qu'un formulaire de type de contenu envoie, assemblé depuis `FormData`.
 *
 * ⚠️ **Extrait de l'écran pour être éprouvable.** C'est la seule partie de
 * `project-content-types.tsx` qui porte de la logique — le reste est de la
 * plomberie — et c'est celle dont une erreur ne se verrait pas : un ordre
 * inversé, une case décochée lue à côté, un champ vide envoyé quand même.
 *
 * ⚠️ **Aucun import de valeur**, seulement des types. C'est ce qui permet à
 * `node --test` de l'exécuter sans bundler : les `import type` sont effacés.
 */

/**
 * Ce qu'un champ peut être, **tiré du contrat** et non redéclaré.
 *
 * Les libellés sont à nous, les valeurs appartiennent au serveur : le typage
 * rejette une valeur qu'il n'a pas, et rejettera cette liste le jour où un
 * type s'ajoutera sans qu'on l'affiche.
 */
export type FieldType = ContentType["definition"]["fields"][number]["type"];

export const FIELD_TYPES: readonly { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
];

/** Une chaîne de formulaire ramenée au vocabulaire du contrat. */
export const asFieldType = (value: string | undefined): FieldType =>
  FIELD_TYPES.find((type) => type.value === value)?.value ?? "text";

/**
 * ⚠️ **Trois listes parallèles**, parce qu'un formulaire HTML ne rend pas
 * d'objets : `fieldName`, `fieldType`, et les cases cochées de
 * `fieldRequired`, dont la valeur est l'indice de la ligne.
 *
 * L'ordre des entrées est celui du DOM, donc celui de l'affichage — et c'est
 * **la disposition du formulaire**, que le serveur traite comme de la donnée
 * (ADR 0016). Le préserver n'est pas un détail : le réordonner change le
 * type.
 */
export function contentTypeBody(form: FormData) {
  const names = form.getAll("fieldName").map(String);
  const types = form.getAll("fieldType").map(String);
  const required = new Set(form.getAll("fieldRequired").map(String));

  return {
    name: String(form.get("name") ?? ""),
    // `null`, jamais une chaîne vide : le contrat distingue « pas de libellé »
    // de « libellé vide », et deux écritures pour un sens donneraient deux
    // empreintes au moment du hachage.
    label: String(form.get("label") ?? "").trim() || null,
    definition: {
      fields: names
        .map((name, index) => ({
          name: name.trim(),
          type: asFieldType(types[index]),
          validation: { required: required.has(String(index)) },
        }))
        // Une ligne laissée vide n'est pas un champ. Le filtre vient **après**
        // l'indexation : sinon une ligne vide au milieu décalerait le type et
        // la case de toutes les suivantes.
        .filter((field) => field.name !== ""),
    },
  };
}
