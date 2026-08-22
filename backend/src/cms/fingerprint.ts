import { createHash } from "node:crypto";
import type { Definition } from "./definition.ts";
import { normalise } from "./normalise.ts";

/**
 * The identity of a stored version — of a schema
 * ([ADR 0016](../../../docs/adr/0016-versionnage-des-schemas-adresse-par-contenu.md))
 * or of a document
 * ([ADR 0022](../../../docs/adr/0022-document-a-deux-pointeurs.md)).
 *
 * ⚠️ **Two scopes, one tag, one file.** Both fingerprints are SHA-256 over the
 * same canonical form, so they must bump together; putting one of them in
 * another module would put the tag out of sight of the function it governs.
 * What differs between them is only the **scope** — which is domain knowledge,
 * and why neither of them lives in `normalise.ts`.
 *
 * ⚠️ **The tag is not decoration.** `sha256-1:<hex>`, never bare hex. Freezing
 * a canonical form is a decision that can only be wrong once: a Unicode case
 * or a float found in the sixth month would otherwise leave two ways out —
 * invalidate every fingerprint every customer holds, or live with the bug
 * forever. With the tag, old rows keep theirs, new rows take the next one, and
 * comparison only ever means anything **within** a tag. Git tags its object
 * format for the same reason.
 *
 * ⚠️ **The tag versions the pair, not the digest.** `sha256-1` names SHA-256
 * *and* the canonical form `normalise.ts` produces. If either changes meaning,
 * it is the same bump. They live in separate files because `normalise.ts` is
 * generic and knows nothing about the CMS — the drift between them is held
 * shut by the literal vectors in the test suite, not by sitting together.
 */

export const FINGERPRINT_TAG = "sha256-1";

/**
 * ⚠️ **The whole content of a schema, not just its definition** — and each of
 * the two jobs versioning has to do demands it.
 *
 * *Restoring*: the founding motive is "somebody broke something by mistake,
 * put the exact state back". `label` is the field designed to be edited — it
 * was separated from `name` precisely so it could be changed safely — so
 * leaving it out would protect least what moves most. A version that cannot
 * restore the label is a version of a fragment, not of the state.
 *
 * *Divergence*: the three-state diagnosis reads equal fingerprints as
 * "identical". A library copy whose agency localised a label — `"Author"`
 * becoming `"Auteur"`, the most ordinary gesture there is — would read as
 * identical with the definition alone. An instrument blind to the commonest
 * legitimate customisation is wrong from its first measurement.
 */
export type VersionedContent = {
  name: string;
  /**
   * ⚠️ **All three writings are spelled out**, `undefined` included, even
   * though `exactOptionalPropertyTypes` would otherwise reject an explicit
   * one. Narrowing the type would move the collapse below into a branch the
   * compiler says is unreachable — and it is reachable, because a definition
   * read back from `JSON.parse` carries no types with it.
   */
  label?: string | null | undefined;
  definition: Definition;
};

/**
 * ⚠️ **`label` is canonicalised here, and here is the point.** The API says
 * `string | undefined`, the column says `string | null` — two writings of one
 * meaning, so two fingerprints unless one of them wins before hashing.
 *
 * It wins in this file rather than in `normalise.ts` because "an absent label
 * is `null`" is knowledge about schemas. `normalise.ts` is frozen and CMS-
 * ignorant, and teaching it a domain rule is how a canonical form stops being
 * general.
 */
export function fingerprint(content: VersionedContent): string {
  return digest(
    normalise({
      name: content.name,
      label: content.label ?? null,
      definition: content.definition,
    }),
  );
}

/**
 * The identity of a document version: **its `data`, and nothing else**
 * ([ADR 0022](../../../docs/adr/0022-document-a-deux-pointeurs.md)).
 *
 * ⚠️ **`locale` and `translation_group_id` are out, deliberately.** Addressing
 * says *where* the content is, not *what it is* — putting them in would
 * re-hash unchanged content the day a row's locale changes. That criterion is
 * the reusable one; it is the same reasoning that keeps the schema scope to
 * what a restore has to put back.
 *
 * ⚠️ **No canonicalisation here, unlike `fingerprint` above**, and the absence
 * is a decision rather than an omission. A schema's `label` arrives in two
 * writings because the API and the column disagree, so one has to win before
 * hashing. A document's `data` has no column to disagree with: the rule that
 * an unset optional field is **absent, never `null`** belongs to the validator
 * generated from the definition, where a `null` is refused out loud at the
 * boundary instead of being quietly rewritten here.
 */
export function documentFingerprint(data: Record<string, unknown>): string {
  return digest(normalise(data));
}

const digest = (canonical: string) =>
  `${FINGERPRINT_TAG}:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
