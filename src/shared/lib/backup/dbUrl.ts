/**
 * Identity of a Postgres connection URL — everything except the password.
 *
 * Used to label backups (file name, Dropbox log line) so a dump found months
 * later says which database it came from. Parsed with a regex rather than
 * `new URL()` because Supabase passwords routinely contain characters the URL
 * parser mangles or rejects.
 *
 * The password is never extracted, returned, or logged.
 */

export interface DbIdentity {
    /** Host without the port, e.g. "aws-1-ap-south-1.pooler.supabase.com". "" if unparseable. */
    host: string;
    /** Supabase project ref, from the "postgres.<ref>" pooler user. "" for a non-Supabase URL. */
    projectRef: string;
    /** Database name, e.g. "postgres". "" if absent. */
    dbName: string;
    /** Role name, e.g. "postgres.gphtzbejvpijcfmvqpqo". "" if absent. */
    user: string;
}

const EMPTY: DbIdentity = { host: "", projectRef: "", dbName: "", user: "" };

/**
 * `(.*)@` is greedy on purpose: it splits at the LAST "@", so a password
 * containing "@" still leaves the host intact.
 */
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:(.*)@)?([^@/?#]+)(?:\/([^?#]*))?/i;

export function describeDbUrl(raw: string | undefined | null): DbIdentity {
    const value = raw?.trim();
    if (!value) return EMPTY;

    const match = URL_RE.exec(value);
    if (!match) return EMPTY;

    const [, userInfo, hostPort, path] = match;
    const user = userInfo ? userInfo.split(":")[0] : "";
    const dot = user.indexOf(".");

    return {
        host: hostPort.split(":")[0],
        // Supabase pooler users look like "postgres.<project-ref>".
        projectRef: dot === -1 ? "" : user.slice(dot + 1),
        dbName: path ?? "",
        user,
    };
}
