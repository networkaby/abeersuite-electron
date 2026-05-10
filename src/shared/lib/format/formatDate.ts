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
