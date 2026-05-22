/**
 * Returns up to two uppercase initials from a display name.
 * "Jane Smith" → "JS", "Alice" → "A"
 */
export function initials(name: string): string {
    return name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}
