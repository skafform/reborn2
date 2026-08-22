/**
 * A date, as a day.
 *
 * ⚠️ **`en-CA`, not the browser's locale.** It yields `2026-08-21`, and it is
 * chosen rather than inherited: two people looking at the same table must read
 * the same thing, and `03/04` means two different days depending on where the
 * reader sits.
 *
 * Extracted at its fifth copy — four screens had the same line.
 *
 * Takes a `Date` as well as an ISO string: our own contract carries dates as
 * strings, Better-Auth's client hands back parsed `Date`s, and both end up in
 * the same column of the same table.
 */
export const day = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-CA");

/**
 * A date down to the minute, for a log where several entries share a day.
 *
 * Same `en-CA` choice as `day`, and for the same reason — one reading for
 * every reader. `hourCycle: "h23"` because the locale would otherwise decide,
 * and a lineage read as `2:04` is ambiguous where `14:04` is not.
 */
export const moment = (value: string | Date) =>
  new Date(value).toLocaleString("en-CA", {
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: "h23",
  });
