/**
 * Staff login: email domain must match INTERNAL_STAFF_EMAIL_DOMAINS (comma-separated hostnames).
 * If empty, falls back to COMPANY_DOMAIN when set; otherwise no staff may sign in (fail closed).
 */
export function parseStaffEmailDomains(): string[] {
    const raw =
        process.env.INTERNAL_STAFF_EMAIL_DOMAINS?.trim() ||
        process.env.COMPANY_DOMAIN?.trim() ||
        "";
    if (!raw) return [];
    return raw
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Logged once per process when the allowlist is empty.
 *
 * Failing closed is correct, but the client only ever sees "Invalid email or
 * password" — identical to a wrong password — so an unset key looks like a
 * forgotten credential and sends people hunting through the database. One line in
 * the server log names the real cause. Once, not per attempt: a login screen left
 * open would otherwise fill the log.
 */
let warnedEmptyAllowlist = false;

export function isStaffEmailDomainAllowed(email: string): boolean {
    const at = email.lastIndexOf("@");
    if (at < 1 || at === email.length - 1) return false;
    const host = email.slice(at + 1).trim().toLowerCase();
    const allowed = parseStaffEmailDomains();
    if (allowed.length === 0) {
        if (!warnedEmptyAllowlist) {
            warnedEmptyAllowlist = true;
            console.warn(
                "[auth] Staff login is refusing EVERY address: neither INTERNAL_STAFF_EMAIL_DOMAINS " +
                "nor COMPANY_DOMAIN is set, so the allowed-domain list is empty and the check fails " +
                "closed. Set INTERNAL_STAFF_EMAIL_DOMAINS (comma-separated hostnames) in this " +
                "machine's .env and restart."
            );
        }
        return false;
    }
    return allowed.includes(host);
}
