/**
 * Apply one editor's photo changes to the gallery as saved NOW, not to the list
 * that editor last saw.
 *
 * The office product page autosaves its whole photo list. Without this, a photo
 * added from the phone app while the page was open was silently dropped by the
 * page's next save. With it, the page's edit is replayed as a diff:
 *
 *   base    — the saved list the editor started from
 *   edited  — the list the editor wants
 *   current — the list saved right now (may hold other people's changes)
 *
 * The editor's order and its own adds / removes win; a photo someone else added
 * meanwhile is kept (at the end); a photo someone else removed stays removed.
 * A changed link (Adjust, Skip for AI) is a remove + add, so it works the same.
 */
export function mergeGallery(base: string[], edited: string[], current: string[]): string[] {
    const inBase = new Set(base);
    const inCurrent = new Set(current);
    // The editor's list, minus photos someone else removed since it loaded.
    const kept = edited.filter((u) => inCurrent.has(u) || !inBase.has(u));
    const seen = new Set(kept);
    // Photos added elsewhere since it loaded.
    const theirs = current.filter((u) => !inBase.has(u) && !seen.has(u));
    return [...new Set([...kept, ...theirs])];
}
