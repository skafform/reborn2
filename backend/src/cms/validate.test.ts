import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Definition } from "./definition.ts";
import { documentValidators } from "./validate.ts";

/**
 * Le générateur de validateurs, éprouvé à vide — aucun consommateur encore,
 * comme `normalise.ts` en son temps : c'est lui qui décidera ce qu'un client
 * peut écrire, donc il se fige avant d'avoir un appelant.
 */

const field = (
  name: string,
  type: Definition["fields"][number]["type"],
  required = false,
): Definition["fields"][number] => ({ name, type, validation: { required } });

/** Un type de contenu qui exerce les cinq scalaires. */
const article: Definition = {
  fields: [
    field("title", "text", true),
    field("body", "longtext"),
    field("words", "number", true),
    field("pinned", "boolean", true),
    field("publishedOn", "date"),
  ],
};

const { shape, completeness } = documentValidators(article);

describe("shape — les cinq types", () => {
  it("accepte la bonne forme de chacun", () => {
    const data = {
      title: "Hello",
      body: "Long form",
      words: 42,
      pinned: false,
      publishedOn: "2026-08-22",
    };
    assert.equal(shape.safeParse(data).success, true);
  });

  it("refuse la mauvaise forme, en nommant le champ", () => {
    const wrong: [string, unknown][] = [
      ["title", 42],
      ["body", true],
      ["words", "42"],
      ["pinned", "false"],
      ["publishedOn", 20260822],
    ];
    for (const [name, value] of wrong) {
      const result = shape.safeParse({ [name]: value });
      assert.equal(result.success, false, `${name} devrait refuser`);
      assert.deepEqual(
        result.error?.issues[0]?.path,
        [name],
        "le refus nomme le champ",
      );
    }
  });

  /**
   * ⚠️ **Absent passe, `null` jamais.** Un champ non renseigné est *absent* —
   * la règle posée avec l'empreinte, où absent et `null` hachent différemment.
   * Un `null` accepté ici serait réécrit nulle part : il entrerait dans le
   * `data`, dans l'empreinte, et dans ce que la livraison sert.
   */
  it("accepte l'absence de n'importe quel champ, requis compris", () => {
    assert.equal(shape.safeParse({}).success, true, "le brouillon vide est normal");
    assert.equal(shape.safeParse({ title: "seul" }).success, true);
  });

  it("refuse `null` sur chaque champ", () => {
    for (const name of ["title", "body", "words", "pinned", "publishedOn"]) {
      assert.equal(
        shape.safeParse({ [name]: null }).success,
        false,
        `${name}: null n'est pas « non renseigné »`,
      );
    }
  });

  it("refuse ce que JSON ne porte pas de toute façon", () => {
    assert.equal(shape.safeParse({ words: Number.NaN }).success, false);
    assert.equal(shape.safeParse({ words: Number.POSITIVE_INFINITY }).success, false);
  });
});

describe("shape — la date est une date de calendrier", () => {
  /**
   * ⚠️ **`YYYY-MM-DD`, jamais un datetime** — « le type décide du widget »,
   * le précédent text/longtext appliqué une fois de plus. `datetime` sera un
   * futur type de champ, pas une seconde écriture de celui-ci.
   */
  it("accepte une date seule, refuse un datetime", () => {
    assert.equal(shape.safeParse({ publishedOn: "2026-08-22" }).success, true);
    assert.equal(
      shape.safeParse({ publishedOn: "2026-08-22T10:00:00Z" }).success,
      false,
      "un datetime est un autre type, pas une variante",
    );
  });

  it("vérifie le calendrier réel", () => {
    assert.equal(shape.safeParse({ publishedOn: "2024-02-29" }).success, true);
    assert.equal(shape.safeParse({ publishedOn: "2026-02-29" }).success, false);
    assert.equal(shape.safeParse({ publishedOn: "2026-13-01" }).success, false);
    assert.equal(shape.safeParse({ publishedOn: "2026-1-2" }).success, false);
  });

  it("une date malformée échoue à l'enregistrement, pas à la publication", () => {
    // La forme appartient à `shape` ; la complétude n'a rien à dire d'une
    // date — vide, elle est déjà une erreur de forme.
    assert.equal(shape.safeParse({ publishedOn: "" }).success, false);
  });
});

describe("shape — les clés inconnues", () => {
  /**
   * ⚠️ Un `z.object` nu les **supprimerait en silence** — une réécriture de ce
   * que le client a envoyé. Le refus nommé est aussi ce qui fait remonter une
   * clé orpheline d'un champ supprimé, au lieu de la laisser s'accumuler.
   */
  it("refuse une clé hors définition, en la nommant", () => {
    const result = shape.safeParse({ title: "ok", titel: "typo" });
    assert.equal(result.success, false);
    const issue = result.error?.issues.find((i) => i.code === "unrecognized_keys");
    assert.ok(issue && "keys" in issue);
    assert.deepEqual(issue.keys, ["titel"]);
  });

  it("une définition vide ne laisse rien passer", () => {
    const { shape: empty } = documentValidators({ fields: [] });
    assert.equal(empty.safeParse({}).success, true);
    assert.equal(empty.safeParse({ anything: 1 }).success, false);
  });
});

describe("completeness — le vide est par type", () => {
  it("refuse un requis absent, en le nommant", () => {
    const result = completeness.safeParse({ words: 1, pinned: true });
    assert.equal(result.success, false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    assert.ok(paths?.includes("title"), "title manquant doit être nommé");
  });

  it("refuse un texte requis vide, espaces compris", () => {
    const base = { words: 1, pinned: false };
    assert.equal(completeness.safeParse({ ...base, title: "" }).success, false);
    assert.equal(
      completeness.safeParse({ ...base, title: "   " }).success,
      false,
      "sinon la règle se contourne d'un coup de barre d'espace",
    );
    assert.equal(completeness.safeParse({ ...base, title: "x" }).success, true);
  });

  /**
   * ⚠️ **Les tests anti-falsy.** Le piège classique d'un générateur est un
   * `!value` générique qui refuserait de publier un prix à 0 ou un
   * interrupteur à faux. Chaque type définit son propre « vide » — pour les
   * non-chaînes, il n'existe pas.
   */
  it("tient `0` pour un number requis complet", () => {
    assert.equal(
      completeness.safeParse({ title: "x", words: 0, pinned: true }).success,
      true,
    );
  });

  it("tient `false` pour un boolean requis complet", () => {
    assert.equal(
      completeness.safeParse({ title: "x", words: 1, pinned: false }).success,
      true,
    );
  });

  it("laisse un facultatif absent, même à la publication", () => {
    assert.equal(
      completeness.safeParse({ title: "x", words: 1, pinned: true }).success,
      true,
      "body et publishedOn restent facultatifs",
    );
  });

  /**
   * ⚠️ **La complétude inclut la forme.** Un brouillon enregistré sous une
   * ancienne définition repasse la forme courante au moment de publier — un
   * mode « required seulement » laisserait un champ retypé franchir la porte
   * construite pour l'attraper.
   */
  it("refuse une mauvaise forme même sur un champ facultatif", () => {
    assert.equal(
      completeness.safeParse({ title: "x", words: 1, pinned: true, body: 42 }).success,
      false,
    );
  });
});

describe("les deux modes, d'une seule traversée", () => {
  it("un brouillon incomplet passe la forme et échoue la complétude", () => {
    const draft = { title: "Work in progress" };
    assert.equal(shape.safeParse(draft).success, true);
    assert.equal(completeness.safeParse(draft).success, false);
  });

  /**
   * ⚠️ **Aucun transform.** Un validateur ne réécrit pas un `data` dont
   * l'empreinte est l'identité : la sortie du parse est l'entrée, octet pour
   * octet — c'est ce qui garde `data` ≡ version pointée (ADR 0022).
   */
  it("ne réécrit jamais la donnée", () => {
    const data = {
      title: "  padded, and kept that way  ",
      words: 42,
      pinned: true,
      publishedOn: "2026-08-22",
    };
    assert.deepEqual(shape.parse(data), data);
    assert.deepEqual(completeness.parse(data), data);
  });
});
