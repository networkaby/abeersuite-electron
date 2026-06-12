export function timeAgo(date: Date | string): string {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
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
