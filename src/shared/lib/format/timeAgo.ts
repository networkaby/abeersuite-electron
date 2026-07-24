export function timeAgo(date: Date | string): string {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// Compact elapsed-span label ("30m" / "2h" / "5d") for a millisecond duration.
// Shared by the Work Inbox SLA "… over" badge (how far past a status resolve time).
export function formatDuration(ms: number): string {
    const mins = Math.max(0, Math.floor(ms / 60000));
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
}

// Forward-looking counterpart of timeAgo — "in 2d" / "in 5h" / "now" for a future
// instant (used by the Work Inbox "Waiting" tab to show when a snoozed retry is due).
export function timeUntil(date: Date | string): string {
    const diff = new Date(date).getTime() - Date.now();
    if (diff <= 0) return "now";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    return `in ${Math.floor(hrs / 24)}d`;
}
