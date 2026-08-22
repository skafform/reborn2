import { z } from "zod";
import type { Definition } from "./definition.ts";

/**
 * From a stored definition to what a document is allowed to be.
 *
 * Drafts split "write" into two moments (ADR 0017, refined by ADR 0022), so
 * one definition yields **two validators, from one traversal** — never two
 * generators, which would drift:
 *
 * | Mode | Moment | What it checks |
 * |---|---|---|
 * | `shape` | save | types, identifiers — every field optional |
 * | `completeness` | publish | shape **and** `required` |
 *
 * ⚠️ **Completeness includes shape.** A draft saved under an older definition
 * has to pass the *current* one at publish time — "required only" would let a
 * retyped field slip through the door built to catch it.
 *
 * ⚠️ **No transforms, `.refine` only.** A validator never rewrites `data`:
 * its fingerprint is its identity, and `data` on the row must stay
 * byte-for-byte the version the pointer names (ADR 0022). `z.string().trim()`
 * would silently break both.
 *
 * ⚠️ **`null` is refused everywhere, absent is fine in shape mode.** An unset
 * optional field is *absent*, never `null` — decided with the document
 * fingerprint, where absent and `null` deliberately hash apart. `.optional()`
 * already refuses `null`, so the rule needs no code, only its tests.
 *
 * Definitions come from the database, already through `DefinitionSchema` and
 * `duplicateFieldName` on their way in — this module assumes them valid.
 */

/**
 * ⚠️ **`date` is a calendar date, `YYYY-MM-DD`, never a datetime.** The
 * doctrine that split `text` from `longtext` — the type decides the widget —
 * cuts the same way here: accepting both writings would make one type with
 * two shapes, and every consumer (the picker, sorting, range filters) would
 * have to guess which one it holds. A `datetime` field type can arrive later
 * without invalidating any fingerprint; permissive-now cannot be tightened
 * without migrating customer data. `z.iso.date()` checks the real calendar —
 * 2024-02-29 passes, 2026-02-29 does not (verified, not assumed).
 *
 * A malformed date is a **shape** error: it fails at save, not at publish.
 */
type FieldType = Definition["fields"][number]["type"];

// Typed to the common ZodType so `.refine` below sees one callable signature
// instead of an incompatible union of five.
const BASE_TYPES: Record<FieldType, () => z.ZodType> = {
  text: () => z.string(),
  longtext: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  date: () => z.iso.date(),
};

/**
 * ⚠️ **Emptiness is per type, and only strings have it.** A required `text`
 * that is `""` — or `"   "`, or the rule dies to one press of the space bar —
 * is incomplete: the editor left the field blank, and "Title is required" is
 * what they expect to hear. But `0` is a complete number and `false` a
 * complete boolean; the classic generator trap is a generic falsy check that
 * refuses to publish a $0 price. Non-strings are present-and-typed or absent,
 * nothing in between — and an empty date is already a shape error.
 */
const incomplete = (type: FieldType) =>
  type === "text" || type === "longtext"
    ? (value: unknown) => typeof value === "string" && value.trim() === ""
    : () => false;

export function documentValidators(definition: Definition): {
  shape: z.ZodType;
  completeness: z.ZodType;
} {
  const shape: Record<string, z.ZodType> = {};
  const completeness: Record<string, z.ZodType> = {};

  for (const field of definition.fields) {
    const base = BASE_TYPES[field.type]();
    const isEmpty = incomplete(field.type);

    shape[field.name] = base.optional();
    completeness[field.name] = field.validation.required
      ? base.refine((value) => !isEmpty(value), {
          error: `${field.name} is required`,
        })
      : base.optional();
  }

  // ⚠️ strictObject, never bare z.object: a bare object *strips* unknown keys
  // silently — a rewrite of what the client sent, and a hole in "validate
  // everything at the boundary". Strict refuses and names them
  // (`unrecognized_keys`). The console form only sends defined fields, so the
  // refusal is also what surfaces a stale key left over from a removed field.
  return {
    shape: z.strictObject(shape),
    completeness: z.strictObject(completeness),
  };
}
