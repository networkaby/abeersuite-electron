// ── Counter help ─────────────────────────────────────────────────────────────
// User-facing POS guide for counter staff — opened in a new tab by F1 and the
// "?" rail button. Server component, no app state; content lives here so the
// register stays lean.

import { BookOpen, Keyboard, HandCoins, BadgeIndianRupee, Trash2, ArrowUpDown, CircleHelp } from "lucide-react";

const SHORTCUTS: { keys: string; label: string; notes: string }[] = [
    { keys: "/", label: "Product search", notes: "Focus the scan box — type name / scan barcode. In checkout, fills the rest of the bill into the focused payment line." },
    { keys: "F2", label: "Customer", notes: "Pick a customer / party. Works from anywhere; press again to change the current customer." },
    { keys: "F3", label: "Product Explorer", notes: "Browse the full catalogue visually — group, brand, category facets. Press again or Esc to close." },
    { keys: "F9", label: "Quick cash", notes: "Open checkout with the full bill on Cash — just confirm with Enter." },
    { keys: "F10", label: "Quick UPI", notes: "Open checkout with the full bill on the first payment account (UPI) — just confirm with Enter." },
    { keys: "Ctrl + Enter", label: "Checkout", notes: "Open checkout / save the bill. Needs items + a customer." },
    { keys: "Enter", label: "Confirm", notes: "Inside checkout, confirm the payment (Ctrl+Enter = confirm + print)." },
    { keys: "↑ ↓", label: "Move around", notes: "Move the selected cart line. Inside checkout, jump to the previous / next payment line." },
    { keys: "+ / −", label: "Quantity", notes: "Add / remove one of the selected cart line." },
    { keys: "Shift + Esc", label: "Clear bill", notes: "Start over — wipes items AND the customer (asks for confirmation first)." },
    { keys: "Esc", label: "Cancel", notes: "Clear the search box, close dialogs, cancel the clear-bill prompt." },
    { keys: "F1", label: "Help", notes: "Open this page in a new tab." },
    { keys: "F6", label: "New POS tab", notes: "Open a fresh register in a new tab — hold one bill per tab." },
];

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-medium">
                {icon}
                {title}
            </h2>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </section>
    );
}

export default function PosHelpPage() {
    return (
        <div className="mx-auto max-w-3xl space-y-4 p-6">
            <header className="space-y-1">
                <h1 className="flex items-center gap-2 font-heading text-xl font-semibold">
                    <CircleHelp size={20} className="text-primary" />
                    POS Counter Help
                </h1>
                <p className="text-sm text-muted-foreground">
                    Billing at the counter in a few keys — scan, pay, print. This page is also one
                    tap away: the <span className="font-medium text-foreground">?</span> button at the
                    bottom of the rail, or press <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">F1</kbd>.
                </p>
            </header>

            <Section icon={<BookOpen size={16} className="text-primary" />} title="Billing in 4 steps">
                <ol className="list-decimal space-y-1 pl-5">
                    <li><span className="font-medium text-foreground">Pick the customer</span> — press <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">F2</kbd> and search, or create one on the fly.</li>
                    <li><span className="font-medium text-foreground">Add items</span> — press <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">/</kbd>, scan the barcode or type the name, then <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">Enter</kbd>. <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">+</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">−</kbd> bump the quantity of the selected line.</li>
                    <li><span className="font-medium text-foreground">Take payment</span> — the quick way: <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">F9</kbd> for cash, <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">F10</kbd> for UPI. Or <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">Ctrl + Enter</kbd> for the full checkout (split payments, card, cheque…).</li>
                    <li><span className="font-medium text-foreground">Confirm</span> — <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">Enter</kbd> saves; <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">Ctrl + Enter</kbd> saves and prints.</li>
                </ol>
            </Section>

            <Section icon={<Keyboard size={16} className="text-primary" />} title="Keyboard shortcuts">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                                <th className="py-2 pr-4 font-medium">Key</th>
                                <th className="py-2 pr-4 font-medium">What it does</th>
                                <th className="py-2 font-medium">Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {SHORTCUTS.map((s) => (
                                <tr key={s.keys} className="border-b border-border/60 align-top last:border-0">
                                    <td className="py-2 pr-4 whitespace-nowrap">
                                        <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">{s.keys}</kbd>
                                    </td>
                                    <td className="py-2 pr-4 font-medium text-foreground">{s.label}</td>
                                    <td className="py-2 text-muted-foreground">{s.notes}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Section>

            <Section icon={<BadgeIndianRupee size={16} className="text-primary" />} title="Payments, the fast way">
                <ul className="list-disc space-y-1 pl-5">
                    <li><kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">F9</kbd> — full bill on <span className="font-medium text-foreground">Cash</span> (no change due), just confirm.</li>
                    <li><kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">F10</kbd> — full bill on <span className="font-medium text-foreground">UPI</span> (the first payment account).</li>
                    <li>Inside checkout, <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">/</kbd> fills the <span className="font-medium text-foreground">rest of the bill</span> into whichever payment line is focused (cash by default) — handy for splits like “₹200 cash, rest UPI”.</li>
                    <li><kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">↑</kbd> / <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">↓</kbd> inside checkout jump between the payment lines instead of tabbing.</li>
                    <li>Change the payment account (UPI 1 → UPI 2 → Card) from the line’s dropdown, or with the Share button to send the QR to the customer.</li>
                </ul>
            </Section>

            <Section icon={<Trash2 size={16} className="text-primary" />} title="Customer changed their mind?">
                <p>
                    <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-xs">Shift + Esc</kbd> clears the whole bill —
                    items, discounts and the customer — so you can start fresh with the next person.
                    It asks for confirmation first, so it can’t be pressed by accident.
                </p>
            </Section>

            <Section icon={<HandCoins size={16} className="text-primary" />} title="Rail buttons (right edge)">
                <ul className="list-disc space-y-1 pl-5">
                    <li><span className="font-medium text-foreground">Rcv</span> — collect a payment into the counter’s till (posts a receipt). Picking the party shows what they owe (Due) or hold with us (Advance), and what it becomes after this receipt.</li>
                    <li><span className="font-medium text-foreground">Exp</span> — record counter spending (tea, sundry…).</li>
                    <li><span className="font-medium text-foreground">Ticket / Enquiry</span> — log a repair job or a customer question.</li>
                    <li><span className="font-medium text-foreground">Task / Deal / Lead</span> — internal to-do, sales opportunity, or a new lead contact.</li>
                    <li><span className="font-medium text-foreground">?</span> — this help page.</li>
                </ul>
            </Section>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowUpDown size={12} /> One bill per POS tab — open more with <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[11px]">F6</kbd>.
            </p>
        </div>
    );
}
