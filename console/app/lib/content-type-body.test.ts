import assert from "node:assert/strict";
import { describe, it } from "node:test";
// ⚠️ Extension explicite : Node résout les chemins lui-même, là où Vite s'en
// passe. C'est le seul endroit de la console qui la porte, et c'est pour ça.
import { asFieldType, contentTypeBody } from "./content-type-body.ts";

/**
 * Le premier test de la console (docs/backlog #0012).
 *
 * Périmètre volontairement étroit : **le corps assemblé depuis le formulaire
 * est-il celui qu'on croit ?** Pas de DOM, pas de rendu, pas de réseau — la
 * seule partie de l'écran qui porte de la logique, et la seule dont une erreur
 * ne se verrait pas à l'œil.
 */

/** Un formulaire comme le navigateur l'enverrait, lignes dans l'ordre du DOM. */
function form(
  fields: { name: string; type?: string; required?: boolean }[],
  head: { name?: string; label?: string } = {},
) {
  const data = new FormData();
  data.set("name", head.name ?? "article");
  data.set("label", head.label ?? "");
  fields.forEach((field, index) => {
    data.append("fieldName", field.name);
    data.append("fieldType", field.type ?? "text");
    if (field.required) data.append("fieldRequired", String(index));
  });
  return data;
}

describe("corps d'un type de contenu", () => {
  it("préserve l'ordre des champs", () => {
    const body = contentTypeBody(
      form([{ name: "title" }, { name: "body" }, { name: "publishedAt" }]),
    );
    assert.deepEqual(
      body.definition.fields.map((field) => field.name),
      ["title", "body", "publishedAt"],
      "l'ordre est la disposition du formulaire, donc de la donnée",
    );
  });

  it("place `required` sous `validation`, pour chaque champ", () => {
    const body = contentTypeBody(
      form([
        { name: "title", required: true },
        { name: "body", required: false },
      ]),
    );
    assert.deepEqual(body.definition.fields[0]?.validation, { required: true });
    assert.deepEqual(
      body.definition.fields[1]?.validation,
      { required: false },
      "toujours présent : un objet facultatif donnerait deux empreintes pour un schéma",
    );
  });

  /**
   * ⚠️ Le cas qui casse en silence. Les cases cochées portent l'indice de leur
   * ligne, et le filtre des lignes vides vient **après** l'indexation — sinon
   * une ligne vide au milieu décalerait le type et la case de toutes les
   * suivantes.
   */
  it("ne décale rien quand une ligne du milieu est laissée vide", () => {
    const body = contentTypeBody(
      form([
        { name: "title", type: "text", required: true },
        { name: "", type: "number" },
        { name: "body", type: "longtext", required: true },
      ]),
    );

    assert.deepEqual(body.definition.fields, [
      { name: "title", type: "text", validation: { required: true } },
      { name: "body", type: "longtext", validation: { required: true } },
    ]);
  });

  it("laisse tomber les lignes vides, et rogne les noms", () => {
    const body = contentTypeBody(form([{ name: "  title  " }, { name: "   " }]));
    assert.deepEqual(
      body.definition.fields.map((field) => field.name),
      ["title"],
    );
  });

  it("rend `null` pour un libellé absent ou blanc, et rogne les autres", () => {
    // `null` et non `""` : le contrat distingue « pas de libellé » de
    // « libellé vide », et deux écritures pour un sens donneraient deux
    // empreintes au hachage.
    assert.equal(contentTypeBody(form([], { label: "" })).label, null);
    assert.equal(contentTypeBody(form([], { label: "   " })).label, null);
    assert.equal(contentTypeBody(form([], { label: " Article " })).label, "Article");
  });

  /**
   * ⚠️ La valeur vient d'un `<select>` dont les options sortent du contrat,
   * donc elle est toujours connue. Le repli existe pour ce qui n'est pas un
   * navigateur — et il choisit le type le plus inoffensif, jamais le plus
   * permissif.
   */
  it("replie un type inconnu sur `text`", () => {
    assert.equal(asFieldType("richtext"), "text");
    assert.equal(asFieldType(undefined), "text");
    assert.equal(asFieldType("longtext"), "longtext");
  });
});
