/**
 * Up to two uppercase initials from a display name, for avatar fallbacks.
 * "Jane Smith" → "JS", "Alice" → "A", "" → "?".
 *
 * Splits on any run of whitespace: the copies this replaced split on a
 * single space, so a doubled space put the letters of "undefined" in the
 * badge ("Jane  Smith" → "JU"). The one home for the rule — twelve files
 * used to carry their own.
 */
export function initials(name: string): string {
    return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}
