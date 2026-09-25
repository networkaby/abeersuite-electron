/**
 * One icon = one concept, app-wide.
 *
 * The nav grew to the point where ClipboardList stood for 22 different things
 * and Wallet for 18 — at which point the icon column stops being a signal and
 * the operator reads text labels every time. This guard keeps that from coming
 * back: it fails when a single lucide icon is bound to more than one concept
 * across the sidebar (constants/nav.ts) and the Quick Actions bar + POS rail
 * (constants/quickActions.ts).
 *
 * Run: pnpm check:nav-icons   (also part of pnpm precommit)
 *
 * Legitimate pairs — a list item and its matching "+" create action, or an
 * in/out pair of the same voucher — are declared in ALLOWED below.
 */
import { readFileSync } from "node:fs";

const SRC = ["src/shared/lib/constants/nav.ts", "src/shared/lib/constants/quickActions.ts"];

/// Groups of labels that MAY share one icon, because they are one concept
/// wearing two labels. Keep this list short and justified.
const ALLOWED: string[][] = [
    ["Person", "Person +"],
    ["Companies", "Companies +"],
    ["Help Desk", "Help Ticket +", "New Help +"],
    ["Rejection In +", "Rejection Out +"],
    ["Work Flow", "Workflow"],
    ["Print Templates", "Thermal Printer"],
    ["Account Ledger", "Ledgers"],
    ["Bank Book", "Loans Book"],
    ["Masters", "Groups"],
    ["Deals", "New Deal +", "Deal"],
    ["Task", "New Task +"],
];

const canonical = new Map<string, string>();
for (const group of ALLOWED) for (const label of group) canonical.set(label, group[0]);

const lines = SRC.flatMap((f) => readFileSync(f, "utf8").split("\n"));
const byIcon = new Map<string, Set<string>>();

for (const line of lines) {
    if (line.trimStart().startsWith("//")) continue; // commented-out entries don't ship
    const icon = /icon: ([A-Za-z0-9]+)/.exec(line)?.[1];
    const label = /label: "([^"]+)"/.exec(line)?.[1];
    if (!icon || !label || icon === "LucideIcon") continue;
    const concept = canonical.get(label) ?? label;
    if (!byIcon.has(icon)) byIcon.set(icon, new Set());
    byIcon.get(icon)!.add(concept);
}

const clashes = [...byIcon.entries()].filter(([, concepts]) => concepts.size > 1);

if (clashes.length === 0) {
    console.log(`✓ nav icons: ${byIcon.size} icons, one concept each`);
    process.exit(0);
}

console.error(`✗ nav icons: ${clashes.length} icon(s) bound to more than one concept\n`);
for (const [icon, concepts] of clashes.sort((a, b) => b[1].size - a[1].size)) {
    console.error(`  ${icon} → ${[...concepts].sort().join(", ")}`);
}
console.error(
    "\nGive each concept its own icon in src/shared/lib/constants/nav.ts or quickActions.ts, or — if they really are" +
    "\none concept — add the labels to ALLOWED in scripts/check-nav-icons.ts.",
);
process.exit(1);
