/**
 * The faces on this PC's sign-in screen, as the app side sees them.
 *
 * `electron/main.ts` owns the file (`counter-roster.json` plus the cached photographs)
 * and `electron/preload.ts` carries the same shape across the bridge; that copy is
 * declared there rather than imported from here because the preload compiles under its
 * own tsconfig, outside the `@/` alias map. Two declarations, one shape — keep them in
 * step, the same arrangement the shell's wording already lives with.
 *
 * It is a convenience cache and never an authority: it decides whose photograph is
 * offered to tap, never who may sign in.
 */

export interface ShellRosterEntry {
    email: string;
    name: string;
    /** Their position, shown under the name. */
    title?: string;
    /** Where the photo came from — only used to notice when it changes. */
    avatarUrl?: string;
    /** A `file://` URL to this PC's cached copy, ready for an `<img src>`. */
    avatarFile?: string;
    hasPin: boolean;
    lastLoginAt?: string;
}

/**
 * Read the roster, or an empty list off the desktop app.
 *
 * Silent on every failure: no photographs simply means the ordinary email-and-password
 * form, which is what every sign-in was before this existed.
 */
export async function readShellRoster(): Promise<ShellRosterEntry[]> {
    try {
        const list = await window.electronAPI?.shellRoster?.();
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}
