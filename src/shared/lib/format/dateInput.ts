/**
 * ISO string → `yyyy-MM-ddThh:mm` for a `<input type="datetime-local">` (local tz).
 * Empty/null → "".
 */
export function toDateTimeLocalInput(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * ISO string → `yyyy-MM-dd` for a `<input type="date">`. Empty/null → "".
 * Takes the date portion as-is (no tz shift), matching how the API returns it.
 */
export function toDateInput(iso: string | null): string {
    return iso ? iso.slice(0, 10) : "";
}
