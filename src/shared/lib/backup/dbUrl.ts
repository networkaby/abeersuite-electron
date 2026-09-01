/**
 * Which database a Postgres connection URL points at, for labelling backups.
 *
 * Only the Supabase project ref, because only it distinguishes anything: host,
 * database name and role are identical across every project on the same Supabase
 * region ("aws-1-ap-south-1.pooler.supabase.com", "postgres", "postgres.<ref>"),
 * so carrying them made file names and log lines longer without making them say
 * more.
 *
 * Parsed with a regex rather than `new URL()` because Supabase passwords
 * routinely contain characters the URL parser mangles or rejects. The password is
 * never extracted, returned, or logged.
 */

/**
 * `(.*)@` is greedy on purpose: it splits at the LAST "@", so a password
 * containing "@" still leaves the rest of the URL intact.
 */
const USER_RE = /^[a-z][a-z0-9+.-]*:\/\/(.*)@/i;

/**
 * "postgresql://postgres.gphtzbejvpijcfmvqpqo:…@…" → "gphtzbejvpijcfmvqpqo".
 *
 * "" when the URL is missing, unparseable, or not a Supabase pooler URL (a direct
 * connection uses a plain "postgres" role with no ref in it). Callers drop the
 * segment rather than printing a placeholder.
 */
export function projectRefFromDbUrl(raw: string | undefined | null): string {
    const match = USER_RE.exec(raw?.trim() ?? "");
    if (!match) return "";

    // Role name is the part before the password.
    const user = match[1].split(":")[0];
    const dot = user.indexOf(".");
    return dot === -1 ? "" : user.slice(dot + 1);
}
