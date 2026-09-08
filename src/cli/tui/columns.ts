/**
 * Responsive column sizing for the profile table.
 *
 * The widths used to be hard-coded to fit exactly one terminal size, so a
 * narrow window pushed columns off the edge and a wide one left the profile
 * name truncated with empty space beside it. Columns are now dropped
 * least-important-first and the name column absorbs whatever is left over.
 */

export const W_MARKER = 2;
export const W_STATUS = 14;
export const W_EXPIRES = 9;
export const W_ACCOUNT = 13;

/** Floor below which the name column stops being useful and a column is dropped. */
const COMFORTABLE_NAME = 18;
const USABLE_NAME = 14;
const MIN_NAME = 10;
const MAX_NAME = 34;

export interface ColumnLayout {
  name: number;
  showExpires: boolean;
  showAccount: boolean;
}

export function layoutColumns(innerWidth: number): ColumnLayout {
  const available = innerWidth - W_MARKER - W_STATUS;

  const withAll = available - W_EXPIRES - W_ACCOUNT;
  if (withAll >= COMFORTABLE_NAME) {
    return { name: Math.min(MAX_NAME, withAll), showExpires: true, showAccount: true };
  }

  const withoutAccount = available - W_EXPIRES;
  if (withoutAccount >= USABLE_NAME) {
    return { name: Math.min(MAX_NAME, withoutAccount), showExpires: true, showAccount: false };
  }

  return { name: Math.max(MIN_NAME, available), showExpires: false, showAccount: false };
}

/**
 * The slice of a list to render, scrolled so `cursor` stays visible.
 * Returns the window plus how many rows are hidden above and below.
 */
export function viewport(
  total: number,
  cursor: number,
  capacity: number,
): { start: number; end: number; hiddenAbove: number; hiddenBelow: number } {
  if (total <= 0) return { start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 };
  const size = Math.max(1, Math.min(capacity, total));
  // Keep the cursor centred once the list scrolls, then clamp to the ends.
  let start = cursor - Math.floor(size / 2);
  start = Math.max(0, Math.min(start, total - size));
  const end = start + size;
  return { start, end, hiddenAbove: start, hiddenBelow: Math.max(0, total - end) };
}

/** Total width the sized columns occupy, so the frame can hug its content. */
export function tableWidth(layout: ColumnLayout): number {
  return (
    W_MARKER +
    layout.name +
    W_STATUS +
    (layout.showExpires ? W_EXPIRES : 0) +
    (layout.showAccount ? W_ACCOUNT : 0)
  );
}

/**
 * Fit `s` into a `w`-wide cell, always leaving a one-column gutter so a
 * full-width value never butts straight up against the next column, and marking
 * a clipped value with an ellipsis rather than silently losing characters.
 */
export function pad(s: string, w: number): string {
  const room = Math.max(1, w - 1);
  const body = s.length > room ? s.slice(0, Math.max(0, room - 1)) + "…" : s;
  return body + " ".repeat(Math.max(0, w - body.length));
}
