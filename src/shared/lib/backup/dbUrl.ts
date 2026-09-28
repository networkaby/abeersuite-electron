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

/** Parameters libpq understands. Everything else in the URL is Prisma's and is dropped. */
const LIBPQ_PARAMS = new Set([
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "connect_timeout",
    "application_name",
    "target_session_attrs",
    "options",
]);

/**
 * The URL as `pg_dump` will accept it, or `null` when it is not a Postgres URL.
 *
 * libpq rejects any URI parameter it does not know, and `DATABASE_URL` carries Prisma's
 * `?pgbouncer=true` — handed over as is, `pg_dump` exits at once with "invalid URI query
 * parameter". That is what the desktop app sends, since it has no `DIRECT_URL`.
 *
 * Twin of `stripPrismaParams` in `electron/backupManager.ts`, which "Back up to this PC"
 * uses: the Electron build cannot import from `src/`, so the two are kept in step by hand.
 */
export function libpqUrl(raw: string | undefined | null): string | null {
    const url = raw?.trim();
    if (!url || (!url.startsWith("postgres://") && !url.startsWith("postgresql://"))) return null;

    // The query starts after the LAST "@": a password may itself contain "?" or "@".
    const q = url.indexOf("?", url.lastIndexOf("@") + 1);
    if (q === -1) return url;
    const kept = url
        .slice(q + 1)
        .split("&")
        .filter((pair) => pair && LIBPQ_PARAMS.has(pair.split("=")[0].toLowerCase()));
    return kept.length > 0 ? `${url.slice(0, q)}?${kept.join("&")}` : url.slice(0, q);
}
