/** Normalize customer portal login identifier (mobile → digits with optional leading country). */

export function normalizePortalEmail(raw: string): string {
    return raw.trim().toLowerCase();
}

/** Store/compare as digits only, India-friendly: strips spaces, handles +91 / leading 0. */
export function normalizePortalPhone(raw: string): string | null {
    let s = raw.replace(/\s+/g, "");
    if (!s) return null;
    if (s.startsWith("+91")) s = s.slice(3);
    else if (s.startsWith("91") && s.length > 10) s = s.slice(2);
    if (s.startsWith("0") && s.length === 11) s = s.slice(1);
    const digits = s.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return null;
    return digits;
}

export function isLikelyEmail(identifier: string): boolean {
    return identifier.includes("@");
}
