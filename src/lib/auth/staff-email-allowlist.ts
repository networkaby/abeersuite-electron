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

export function isStaffEmailDomainAllowed(email: string): boolean {
    const at = email.lastIndexOf("@");
    if (at < 1 || at === email.length - 1) return false;
    const host = email.slice(at + 1).trim().toLowerCase();
    const allowed = parseStaffEmailDomains();
    if (allowed.length === 0) return false;
    return allowed.includes(host);
}
