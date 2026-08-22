import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Definition } from "./definition.ts";
import {
  documentFingerprint,
  FINGERPRINT_TAG,
  fingerprint,
  type VersionedContent,
} from "./fingerprint.ts";
import { normalise } from "./normalise.ts";

/**
 * ⚠️ **The vectors below are the format, not examples of it.**
 *
 * A fingerprint is the identity of a stored version — of a schema (ADR 0016)
 * or of a document (ADR 0022) — so a digest that changes is a format change:
 * it needs a new algorithm tag, never a corrected expectation. The literals here are what makes that mechanical —
 * they are the only thing standing between an innocent edit to `normalise.ts`
 * and every fingerprint in every customer database meaning something else.
 *
 * Each one is checkable without running this code at all:
 *
 *   printf '%s' '<the canonical string>' | sha256sum
 *
 * which is how the two below were confirmed before being written down.
 */

const article: { name: string; label: string; definition: Definition } = {
  name: "article",
  label: "Article",
  definition: {
    fields: [
      { name: "title", type: "text", validation: { required: true } },
      {
        name: "body",
        type: "longtext",
        label: "Body",
        validation: { required: false },
      },
    ],
  },
};

describe("fingerprint — known answers", () => {
  it("hashes a schema with no fields", () => {
    const content = { name: "article", definition: { fields: [] } };

    assert.equal(
      normalise({ ...content, label: null }),
      '{"definition":{"fields":[]},"label":null,"name":"article"}',
    );
    assert.equal(
      fingerprint(content),
      "sha256-1:eed07419c964a6936ee1ff00ce0a7834ce1dc7730547c2150ab6fc99d5109441",
    );
  });

  it("hashes a schema with fields", () => {
    assert.equal(
      normalise({ ...article, label: "Article" }),
      '{"definition":{"fields":[{"name":"title","type":"text","validation":{"required":true}},' +
        '{"label":"Body","name":"body","type":"longtext","validation":{"required":false}}]},' +
        '"label":"Article","name":"article"}',
    );
    assert.equal(
      fingerprint(article),
      "sha256-1:7c2dfc2963ef55d565fcdf35d4c7418a2f8cb03a1d945f7a8ca1217c0231d7f1",
    );
  });

  it("carries the tag, and nothing but hexadecimal after it", () => {
    // ⚠️ Never bare hex: comparison only means anything within a tag, and a
    // bare digest gives nothing to compare tags on.
    assert.match(fingerprint(article), /^sha256-1:[0-9a-f]{64}$/);
    assert.equal(FINGERPRINT_TAG, "sha256-1");
  });
});

describe("fingerprint — the label's three writings", () => {
  /**
   * ⚠️ The API says `string | undefined`, the column says `string | null`. One
   * meaning, so it must be one fingerprint — and the collapse happens in
   * `fingerprint.ts`, which knows about schemas, not in `normalise.ts`, which
   * is frozen and general.
   */
  it("gives absent, `undefined` and `null` one digest", () => {
    const expected =
      "sha256-1:eed07419c964a6936ee1ff00ce0a7834ce1dc7730547c2150ab6fc99d5109441";
    const definition: Definition = { fields: [] };

    assert.equal(fingerprint({ name: "article", definition }), expected);
    assert.equal(
      fingerprint({ name: "article", label: undefined, definition }),
      expected,
    );
    assert.equal(fingerprint({ name: "article", label: null, definition }), expected);
  });

  it("keeps a real label distinct from none", () => {
    const definition: Definition = { fields: [] };
    assert.notEqual(
      fingerprint({ name: "article", label: "Article", definition }),
      fingerprint({ name: "article", label: null, definition }),
    );
  });
});

describe("fingerprint — what moves it", () => {
  /**
   * ⚠️ The label is in scope on purpose, and this is the test that says why.
   * A library copy whose agency localised a label has diverged; a diagnosis
   * that read it as identical would be wrong about the commonest legitimate
   * customisation there is.
   */
  it("moves when a label is localised", () => {
    const localised = { ...article, label: "Auteur" };
    assert.notEqual(fingerprint(localised), fingerprint(article));
  });

  it("moves when the schema is renamed", () => {
    assert.notEqual(fingerprint({ ...article, name: "post" }), fingerprint(article));
  });

  it("moves when two fields swap places", () => {
    const [title, body] = article.definition.fields;
    if (!title || !body) throw new Error("the fixture lost a field");
    const swapped = { ...article, definition: { fields: [body, title] } };
    assert.notEqual(fingerprint(swapped), fingerprint(article));
  });

  it("moves on any change to a field", () => {
    const [, body] = article.definition.fields;
    if (!body) throw new Error("the fixture lost a field");

    const withTitle = (title: Definition["fields"][number]) =>
      fingerprint({ ...article, definition: { fields: [title, body] } });
    const untouched = fingerprint(article);

    const changes: { why: string; title: Definition["fields"][number] }[] = [
      {
        why: "renamed",
        title: { name: "heading", type: "text", validation: { required: true } },
      },
      {
        why: "retyped",
        title: { name: "title", type: "longtext", validation: { required: true } },
      },
      {
        why: "no longer required",
        title: { name: "title", type: "text", validation: { required: false } },
      },
      {
        why: "labelled",
        title: {
          name: "title",
          type: "text",
          label: "Title",
          validation: { required: true },
        },
      },
    ];

    for (const { why, title } of changes) {
      assert.notEqual(withTitle(title), untouched, `unmoved by a field ${why}`);
    }
  });
});

describe("fingerprint — what does not move it", () => {
  it("ignores the order the keys were written in", () => {
    const rewritten: VersionedContent = {
      definition: {
        fields: [
          { validation: { required: true }, type: "text", name: "title" },
          {
            label: "Body",
            validation: { required: false },
            name: "body",
            type: "longtext",
          },
        ],
      },
      label: "Article",
      name: "article",
    };
    assert.equal(fingerprint(rewritten), fingerprint(article));
  });

  /**
   * What a row read back from Postgres has been through. Without this, a
   * definition would fingerprint differently on the way in and on the way out,
   * and every stored schema would look permanently modified.
   */
  it("survives a JSON round trip", () => {
    assert.equal(
      fingerprint(JSON.parse(JSON.stringify(article))),
      fingerprint(article),
    );
  });
});

/**
 * L'empreinte d'un document — le second périmètre, le même tag
 * (ADR 0022). Mêmes règles qu'au-dessus : ces vecteurs **sont** le format, et
 * chacun est vérifiable hors du code.
 */
describe("documentFingerprint — known answers", () => {
  it("hashes an empty document", () => {
    assert.equal(normalise({}), "{}");
    assert.equal(
      documentFingerprint({}),
      "sha256-1:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });

  it("hashes a document with fields", () => {
    const data = { title: "Hello", published: true, words: 42 };

    assert.equal(normalise(data), '{"published":true,"title":"Hello","words":42}');
    assert.equal(
      documentFingerprint(data),
      "sha256-1:91402fe26e1e461f955e7158f5afaa513102e40e5426782c62126700a55b6ff4",
    );
  });

  /**
   * ⚠️ **Le même tag que les schémas, et c'est voulu** : les deux empreintes
   * sont SHA-256 sur la même forme canonique, donc elles s'incrémentent
   * ensemble. Deux tags dériveraient.
   */
  it("carries the same tag as a schema fingerprint", () => {
    assert.match(documentFingerprint({ a: 1 }), /^sha256-1:[0-9a-f]{64}$/);
    assert.equal(FINGERPRINT_TAG, "sha256-1");
  });
});

describe("documentFingerprint — what moves it", () => {
  it("moves on any change to a value", () => {
    const base = documentFingerprint({ title: "Hello" });
    assert.notEqual(documentFingerprint({ title: "hello" }), base);
    assert.notEqual(documentFingerprint({ title: "Hello!" }), base);
    assert.notEqual(documentFingerprint({ heading: "Hello" }), base);
    assert.notEqual(documentFingerprint({ title: "Hello", extra: null }), base);
  });

  /**
   * ⚠️ **Absent et `null` sont deux empreintes**, contrairement au `label`
   * d'un schéma — et c'est délibéré. Un `data` n'a pas de colonne avec
   * laquelle être en désaccord : la règle « un champ non renseigné est absent,
   * jamais `null` » appartient au validateur généré, qui refuse un `null` à la
   * frontière plutôt que de le réécrire ici en silence.
   */
  it("keeps an absent key distinct from a null one", () => {
    assert.notEqual(documentFingerprint({ subtitle: null }), documentFingerprint({}));
  });
});

describe("documentFingerprint — what does not move it", () => {
  it("ignores the order the keys were written in", () => {
    assert.equal(
      documentFingerprint({ words: 42, title: "Hello", published: true }),
      documentFingerprint({ title: "Hello", published: true, words: 42 }),
    );
  });

  /**
   * Ce qu'une ligne relue de Postgres a traversé. Sans ça, un document
   * s'empreindrait différemment à l'aller et au retour, et chaque document
   * stocké paraîtrait modifié en permanence.
   */
  it("survives a JSON round trip", () => {
    const data = { title: "Hello", tags: ["a", "b"], meta: { pinned: false } };
    assert.equal(
      documentFingerprint(JSON.parse(JSON.stringify(data))),
      documentFingerprint(data),
    );
  });

  /**
   * ⚠️ **L'adressage dit *où* est le contenu, pas *ce qu'il est*** (ADR 0022).
   * `locale` et `translation_group_id` sont des colonnes de la ligne : les
   * inclure re-hacherait un contenu inchangé au premier changement de locale.
   * Ce test épingle le périmètre en le passant à côté du `data`.
   */
  it("is unmoved by the addressing that surrounds the data", () => {
    const data = { title: "Bonjour" };
    const row = { data, locale: "fr", translationGroupId: "g-1" };

    assert.equal(
      documentFingerprint(row.data),
      documentFingerprint({ title: "Bonjour" }),
    );
    assert.notEqual(
      documentFingerprint(row.data),
      documentFingerprint({ ...data, locale: "fr" }),
      "la locale dans le `data` serait un autre contenu — elle n'a rien à y faire",
    );
  });
});
