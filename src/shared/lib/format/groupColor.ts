// Deterministic colour per Trial-Balance account-group name — same group
// always gets the same colour, cycling through a fixed palette so a brand-new
// group (e.g. a new loan sub-group) gets a colour automatically, no code change.

const PALETTE = [
    { bg: "bg-blue-50 dark:bg-blue-900/25",   text: "text-blue-700 dark:text-blue-300",   border: "border-blue-200 dark:border-blue-800",   bar: "bg-blue-500" },
    { bg: "bg-green-50 dark:bg-green-900/25", text: "text-green-700 dark:text-green-300", border: "border-green-200 dark:border-green-800", bar: "bg-green-500" },
    { bg: "bg-amber-50 dark:bg-amber-900/25", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800", bar: "bg-amber-500" },
    { bg: "bg-purple-50 dark:bg-purple-900/25", text: "text-purple-700 dark:text-purple-300", border: "border-purple-200 dark:border-purple-800", bar: "bg-purple-500" },
    { bg: "bg-pink-50 dark:bg-pink-900/25",   text: "text-pink-700 dark:text-pink-300",   border: "border-pink-200 dark:border-pink-800",   bar: "bg-pink-500" },
    { bg: "bg-cyan-50 dark:bg-cyan-900/25",   text: "text-cyan-700 dark:text-cyan-300",   border: "border-cyan-200 dark:border-cyan-800",   bar: "bg-cyan-500" },
    { bg: "bg-orange-50 dark:bg-orange-900/25", text: "text-orange-700 dark:text-orange-300", border: "border-orange-200 dark:border-orange-800", bar: "bg-orange-500" },
    { bg: "bg-indigo-50 dark:bg-indigo-900/25", text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-200 dark:border-indigo-800", bar: "bg-indigo-500" },
] as const;

export type GroupColor = (typeof PALETTE)[number];

export function groupColor(name: string): GroupColor {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(hash) % PALETTE.length];
}
