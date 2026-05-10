export function formatDate(d: Date | string): string {
    return new Date(d).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
    });
}

export function formatDateTime(d: Date | string): string {
    return new Date(d).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}

/**
 * Smart inbox/chat timestamp.
 * Same day → HH:MM (locale time). Older → "Mon DD".
 * Handles Supabase Realtime payloads that may omit the trailing "Z" — coerces to UTC.
 */
export function formatInboxTime(iso: string): string {
    const utc = iso && !iso.endsWith("Z") && !iso.includes("+") ? iso + "Z" : iso;
    const date = new Date(utc);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Time only (HH:MM AM/PM, en-US). */
export function formatTimeOnly(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}
