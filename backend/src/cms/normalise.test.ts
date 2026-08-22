import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalise } from "./normalise.ts";

/**
 * ⚠️ **This suite is what protects every fingerprint already written.**
 *
 * `normalise` is the only function here whose bug is paid for in customer
 * data: it becomes the identity of each schema version (ADR 0016). So these
 * tests are not a sample of its behaviour — they are the specification, and a
 * change that turns one of them red is a change of format, which needs a new
 * algorithm tag, not a corrected expectation.
 *
 * The reference is RFC 8785 (JSON Canonicalization Scheme); the section
 * numbers below point at the rule each case pins.
 */

/** Control characters, written by code so the file stays readable. */
const ch = (code: number) => String.fromCharCode(code);

describe("normalise — objects", () => {
  it("sorts keys at every depth", () => {
    assert.equal(
      normalise({ b: 1, a: { d: 2, c: { f: 3, e: 4 } } }),
      '{"a":{"c":{"e":4,"f":3},"d":2},"b":1}',
    );
  });

  it("gives one result whatever order the keys arrived in", () => {
    // The whole point: two writings of one schema, one fingerprint.
    const written = normalise({ type: "text", name: "title", label: "Title" });
    const shuffled = normalise({ label: "Title", type: "text", name: "title" });
    assert.equal(written, shuffled);
  });

  /**
   * ⚠️ JCS §3.2.3 sorts keys as arrays of **UTF-16 code units**, not code
   * points and not locale-aware. `"10"` before `"2"`, uppercase before
   * lowercase, ASCII before anything above it.
   */
  it("sorts by UTF-16 code unit, not numerically and not by locale", () => {
    assert.equal(
      normalise({ é: 0, a: 0, Z: 0, "2": 0, "10": 0, "": 0 }),
      '{"":0,"10":0,"2":0,"Z":0,"a":0,"é":0}',
    );
  });

  it("keeps an empty object, and an empty key", () => {
    assert.equal(normalise({}), "{}");
    assert.equal(normalise({ "": { "": null } }), '{"":{"":null}}');
  });

  it("accepts an object with no prototype", () => {
    // What `Object.create(null)` produces — still a plain bag of keys.
    const bare = Object.create(null);
    bare.b = 1;
    bare.a = 2;
    assert.equal(normalise(bare), '{"a":2,"b":1}');
  });
});

describe("normalise — absent, null, undefined", () => {
  /**
   * A key that is absent and a key set to `undefined` mean one thing, so they
   * must give one fingerprint. Zod 4 leaves an absent `.optional()` out of its
   * output entirely, so this is a guard rather than a daily path — but it is
   * the difference between normalising and losing data, and worth pinning.
   */
  it("treats an `undefined` value as an absent key", () => {
    assert.equal(normalise({ a: 1, label: undefined }), '{"a":1}');
    assert.equal(normalise({ a: 1 }), normalise({ a: 1, label: undefined }));
  });

  it("keeps `null` distinct from absent", () => {
    assert.notEqual(normalise({ label: null }), normalise({}));
    assert.equal(normalise({ label: null }), '{"label":null}');
  });
});

describe("normalise — arrays", () => {
  /**
   * ⚠️ Array order is **data**: it is the layout of the form, so reordering
   * two fields is a different schema and must be a different fingerprint
   * (ADR 0016). Sorting them would silently merge two schemas into one.
   */
  it("leaves element order alone", () => {
    assert.equal(normalise(["b", "a", "c"]), '["b","a","c"]');
    assert.notEqual(normalise([1, 2]), normalise([2, 1]));
  });

  it("still sorts the keys of objects inside an array", () => {
    assert.equal(normalise([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]');
  });

  it("keeps an empty array, and nesting", () => {
    assert.equal(normalise([]), "[]");
    assert.equal(normalise([[], [[]]]), "[[],[[]]]");
  });

  /**
   * ⚠️ The case that would pass unnoticed. `JSON.stringify` writes a hole as
   * `null`, which is a valid document meaning something else — and `.map`
   * would have kept the hole, so `join` would have produced `[1,,3]`, which is
   * not JSON at all.
   */
  it("refuses a gap in an array rather than filling it with `null`", () => {
    assert.throws(() => normalise([1, undefined, 3]), /\$\[1\].*gap in an array/s);
    // biome-ignore lint/suspicious/noSparseArray: the hole **is** the case under test — the suggested fix turns it into the line above.
    assert.throws(() => normalise([1, , 3]), /\$\[1\].*gap in an array/s);
  });
});

describe("normalise — numbers", () => {
  /** ECMA-262 §7.1.12.1, which JCS §3.2.2.3 adopts wholesale. */
  it("writes numbers the way ECMAScript does", () => {
    assert.equal(normalise(0), "0");
    assert.equal(normalise(1), "1");
    assert.equal(normalise(-42), "-42");
    assert.equal(normalise(1.5), "1.5");
    assert.equal(normalise(1e21), "1e+21");
    assert.equal(normalise(1e-7), "1e-7");
    assert.equal(normalise(0.1 + 0.2), "0.30000000000000004");
    assert.equal(normalise(Number.MAX_SAFE_INTEGER), "9007199254740991");
  });

  it("collapses `-0` onto `0`", () => {
    // Two ways to write one number. The language already does this; the test
    // is here so a hand-rolled number path could never quietly stop.
    assert.equal(normalise(-0), "0");
    assert.equal(normalise({ min: -0 }), normalise({ min: 0 }));
  });

  /** JCS §3.2.2.3 requires termination, not the `null` `JSON.stringify` writes. */
  it("refuses what JSON cannot hold", () => {
    assert.throws(() => normalise(Number.NaN), /NaN is not JSON/);
    assert.throws(() => normalise(Number.POSITIVE_INFINITY), /Infinity is not JSON/);
    assert.throws(() => normalise({ max: Number.NEGATIVE_INFINITY }), /\$\.max/);
  });
});

describe("normalise — strings", () => {
  it("escapes quotes and backslashes", () => {
    assert.equal(normalise('a"b\\c'), '"a\\"b\\\\c"');
  });

  /** JCS §3.2.2.2: lowercase `\uhhhh`, except for the shorthands JSON defines. */
  it("escapes control characters in lowercase hexadecimal", () => {
    assert.equal(normalise(ch(0x01)), '"\\u0001"');
    assert.equal(normalise(ch(0x1f)), '"\\u001f"');
    assert.equal(normalise(`a${ch(9)}b`), '"a\\tb"');
    assert.equal(normalise(ch(10)), '"\\n"');
    // Above U+001F nothing is escaped — DEL included.
    assert.equal(normalise(ch(0x7f)), `"${ch(0x7f)}"`);
  });

  it("escapes a lone surrogate rather than emitting invalid UTF-8", () => {
    // Well-formed `JSON.stringify`, ES2019. Without it the result could not be
    // encoded, so the hash could not be taken.
    assert.equal(normalise(ch(0xd800)), '"\\ud800"');
    // A well-formed pair stays a character.
    assert.equal(normalise("😀"), '"😀"');
  });

  /**
   * ⚠️ **Deliberate, and the one rule here that could turn out wrong.** JCS
   * normalises no Unicode, so a composed and a decomposed "é" in a `label`
   * give two fingerprints — a divergence that reads as a change nobody made.
   * It is a false alarm, never a loss, and changing our mind means a new
   * algorithm tag rather than a rewritten past.
   */
  it("does not apply Unicode normalisation", () => {
    // Written by code point rather than typed: an editor that normalised the
    // file on save would otherwise quietly turn this into a tautology.
    const composed = ch(0x00e9);
    const decomposed = `e${ch(0x0301)}`;
    assert.equal(composed.normalize("NFC"), decomposed.normalize("NFC"));
    assert.notEqual(normalise(composed), normalise(decomposed));
  });
});

describe("normalise — what is not JSON", () => {
  it("refuses values JavaScript has and JSON does not", () => {
    assert.throws(() => normalise(undefined), /undefined is not JSON/);
    assert.throws(() => normalise(10n), /bigint is not JSON/);
    assert.throws(() => normalise(Symbol("s")), /symbol is not JSON/);
    assert.throws(() => normalise(() => 1), /function is not JSON/);
  });

  /**
   * ⚠️ A `Date` is refused rather than run through its `toJSON`. It would come
   * out as a string, indistinguishable from one somebody typed, and its
   * precision and offset would decide the fingerprint.
   */
  it("refuses anything that is not a plain object or an array", () => {
    assert.throws(() => normalise(new Date(0)), /Date is not JSON/);
    assert.throws(() => normalise(new Map()), /Map is not JSON/);
    assert.throws(() => normalise(new Set()), /Set is not JSON/);
    class Field {}
    assert.throws(() => normalise(new Field()), /Field is not JSON/);
  });

  it("names where the refusal happened", () => {
    assert.throws(
      () => normalise({ fields: [{ name: "title", validation: new Date(0) }] }),
      /\$\.fields\[0\]\.validation/,
    );
  });
});

describe("normalise — a definition", () => {
  /** The shape `definition.ts` describes, written out in full. */
  const definition = {
    fields: [
      { name: "title", type: "text", validation: { required: true } },
      {
        validation: { required: false },
        type: "longtext",
        name: "body",
        label: "Body",
      },
    ],
  };

  it("produces the bytes a version will be hashed from", () => {
    assert.equal(
      normalise(definition),
      '{"fields":[{"name":"title","type":"text","validation":{"required":true}},' +
        '{"label":"Body","name":"body","type":"longtext","validation":{"required":false}}]}',
    );
  });

  it("is unmoved by the order the keys of a field were written in", () => {
    const rewritten = {
      fields: [
        { validation: { required: true }, type: "text", name: "title" },
        {
          label: "Body",
          name: "body",
          type: "longtext",
          validation: { required: false },
        },
      ],
    };
    assert.equal(normalise(rewritten), normalise(definition));
  });

  it("changes when two fields swap places", () => {
    const swapped = { fields: [definition.fields[1], definition.fields[0]] };
    assert.notEqual(normalise(swapped), normalise(definition));
  });

  it("changes when a label changes, and when a field is added", () => {
    const relabelled = {
      fields: [definition.fields[0], { ...definition.fields[1], label: "Content" }],
    };
    assert.notEqual(normalise(relabelled), normalise(definition));

    const extended = {
      fields: [
        ...definition.fields,
        { name: "publishedAt", type: "date", validation: { required: false } },
      ],
    };
    assert.notEqual(normalise(extended), normalise(definition));
  });

  /**
   * The output is JSON, and reading it back gives the same output. It is what
   * makes a stored definition comparable to one that has just arrived over
   * HTTP, having been through `JSON.parse` on the way.
   */
  it("is idempotent through a round trip", () => {
    const once = normalise(definition);
    assert.equal(normalise(JSON.parse(once)), once);
  });
});
