/**
 * Canonical serialisation — the bytes a schema version is hashed from.
 *
 * ⚠️ **This function is the identity of every stored version**
 * ([ADR 0016](../../../docs/adr/0016-versionnage-des-schemas-adresse-par-contenu.md)).
 * A bug here does not break a request: it gives two different schemas one
 * fingerprint, or one schema two fingerprints, for rows already written in
 * customer databases. Nothing else in this project fails that way, which is
 * why it lands alone and exhaustively tested before anything uses it.
 *
 * It implements **RFC 8785 — JSON Canonicalization Scheme** rather than a rule
 * of our own, because the format has to survive a rewrite in another language
 * one day and "whatever we did in 2026" would not:
 *
 * | JCS | Here |
 * |---|---|
 * | Keys sorted as arrays of UTF-16 code units (§3.2.3) | `Array.prototype.sort` on the keys — its default comparator *is* that order |
 * | Array element order unchanged (§3.2.1) | never touched — it is the form layout, so it is data |
 * | Numbers per ECMA-262 §7.1.12.1 (§3.2.2.3) | `JSON.stringify`, which is that algorithm |
 * | Control characters as lowercase `\uhhhh` (§3.2.2.2) | `JSON.stringify`, well-formed since ES2019 |
 * | `NaN`/`Infinity` must terminate with an error (§3.2.2.3) | they throw, and so does everything else JSON cannot hold |
 *
 * ⚠️ **Generic, not written against `Definition`.** Naming the fields one by
 * one would be shorter and would need no sorting at all. It was rejected
 * because the definition will grow — `validation` gains `minLength`, a field
 * gains `to` — and a line forgotten here would leave the new key **out of the
 * fingerprint**. Two different schemas, one hash, no symptom.
 *
 * ⚠️ **No Unicode normalisation**, because JCS does none. Two spellings of the
 * same "é" in a `label` give two fingerprints, which reads as a change that
 * did not happen. That is a false divergence, never a loss — and the
 * `sha256-1:` tag is exactly what lets us change our mind about it later.
 *
 * The result is a string; UTF-8 encoding belongs to the hashing step.
 */

/** The path is for the reader of the failure, not for the caller to parse. */
function refuse(path: string, reason: string): Error {
  return new Error(`cannot canonicalise ${path}: ${reason}`);
}

export function normalise(value: unknown): string {
  return write(value, "$");
}

function write(value: unknown, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      // Guarded even though Zod already rejects both: this function outlives
      // the shape it is handed today, and JSON.stringify writes `null` for
      // them — a valid document meaning something else.
      if (!Number.isFinite(value)) throw refuse(path, `${value} is not JSON`);
      // ECMA-262 §7.1.12.1, which also collapses `-0` to `0`. Two ways to
      // write one number, one fingerprint.
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      return Array.isArray(value) ? writeArray(value, path) : writeObject(value, path);
    default:
      // `undefined`, `bigint`, `symbol`, `function`.
      throw refuse(path, `${typeof value} is not JSON`);
  }
}

function writeArray(values: unknown[], path: string): string {
  const parts: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const at = `${path}[${index}]`;
    const item = values[index];
    // ⚠️ **Not skipped the way an object's `undefined` is.** A hole in an
    // array is a position, and `JSON.stringify` fills it with `null` — a
    // different document, and a silent one. Sparse arrays land here too:
    // reading the index gives `undefined` where `.map` would have kept the
    // hole and `join` would have written `[1,,3]`.
    if (item === undefined) throw refuse(at, "a gap in an array is not JSON");
    parts.push(write(item, at));
  }
  return `[${parts.join(",")}]`;
}

function writeObject(value: object, path: string): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    // ⚠️ A `Date` is refused rather than serialised through its `toJSON`. It
    // would come out as a string, indistinguishable from one a client typed,
    // and its precision and offset would decide the fingerprint.
    const name = prototype?.constructor?.name ?? "this value";
    throw refuse(path, `${name} is not JSON — only plain objects and arrays are`);
  }

  const entries = value as Record<string, unknown>;
  const parts: string[] = [];

  // ⚠️ The default comparator compares strings by UTF-16 code unit, which is
  // precisely what JCS asks for. It is not an oversight to be "fixed" into a
  // code-point sort — that would be a different, incompatible format.
  for (const key of Object.keys(entries).sort()) {
    const entry = entries[key];
    // Absent and `undefined` are one meaning, so they get one fingerprint.
    // This is normalisation doing its job, not `JSON.stringify` losing data.
    if (entry === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${write(entry, `${path}.${key}`)}`);
  }

  return `{${parts.join(",")}}`;
}
