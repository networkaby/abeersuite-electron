"use client";

// ── PosActionRail ─────────────────────────────────────────────────────────────
// Narrow vertical action rail pinned to the far-right edge of the POS screen
// (full height, beside the customer panel).
//
// ► To add / remove / reorder buttons, just edit the RAIL_ACTIONS array below.
//   - kind "action" → runs a wired handler (keyed by `key` in the `handlers` map
//     built in the component; e.g. rcv/exp). Optionally gated by an access flag.
//   - kind "soon"   → placeholder that toasts "<label> — coming soon".
//   - `divider: true` draws a separator line above that button.

import { Fragment } from "react";
import {
    Banknote, HandCoins, HelpCircle, TicketPlus, Pause, StickyNote, Percent, Tag, Users, Printer,
    type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type PosActionRailProps = {
    onExp: () => void;
    onRcv: () => void;
    onHelp: () => void;
    onTicket: () => void;
    canExp?: boolean;
    canRcv?: boolean;
};

// Access-flag keys a button can be gated by (map to PosActionRailProps flags).
type AccessKey = "canRcv" | "canExp";

type RailAction = {
    /** Stable id — for "action" buttons this also picks the handler. */
    key: string;
    label: string;
    icon: LucideIcon;
    kind: "action" | "soon";
    title?: string;
    /** Draw a separator line above this button. */
    divider?: boolean;
    /** Hide the button unless this access flag is true. */
    can?: AccessKey;
};

// ⇩ Edit this list to add / remove / reorder rail buttons.
const RAIL_ACTIONS: RailAction[] = [
    { key: "rcv", label: "Rcv", icon: HandCoins, kind: "action", can: "canRcv", title: "Collect a payment from a customer into this counter's till — posts a receipt voucher" },
    { key: "exp", label: "Exp", icon: Banknote, kind: "action", can: "canExp", title: "Record a counter expenditure (tea, sundry…) — posts a payment voucher from the counter's till" },

    { key: "help", label: "Help", icon: HelpCircle, kind: "action", divider: true, title: "POS help & keyboard shortcuts" },

    { key: "ticket", label: "Ticket", icon: TicketPlus, kind: "action", title: "Create a repair ticket for a customer" },
    // { key: "hold", label: "Hold", icon: Pause, kind: "soon" },
    // { key: "note", label: "Note", icon: StickyNote, kind: "soon" },
    // { key: "disc", label: "Disc", icon: Percent, kind: "soon" },
    // { key: "price", label: "Price", icon: Tag, kind: "soon" },
    // { key: "split", label: "Split", icon: Users, kind: "soon" },
    // { key: "print", label: "Print", icon: Printer, kind: "soon" },
];

export function PosActionRail({ onExp, onRcv, onHelp, onTicket, canExp = true, canRcv = true }: PosActionRailProps) {
    const handlers: Record<string, () => void> = { rcv: onRcv, exp: onExp, help: onHelp, ticket: onTicket };
    const flags: Record<AccessKey, boolean> = { canRcv, canExp };

    return (
        <aside className="flex w-16 shrink-0 flex-col items-stretch gap-1 border-l border-border bg-muted/30 p-1.5">
            {RAIL_ACTIONS.map((a) => {
                if (a.can && !flags[a.can]) return null;
                const onClick =
                    a.kind === "action"
                        ? (handlers[a.key] ?? (() => { }))
                        : () => toast.info(`${a.label} — coming soon`);
                return (
                    <Fragment key={a.key}>
                        {a.divider && <div className="my-1 border-t border-border/70" />}
                        <RailButton icon={<a.icon size={16} />} label={a.label} onClick={onClick} title={a.title} />
                    </Fragment>
                );
            })}
        </aside>
    );
}

function RailButton({
    icon,
    label,
    onClick,
    title,
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    title?: string;
}) {
    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            title={title ?? label}
            className="flex h-auto flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium"
        >
            {icon}
            {label}
        </Button>
    );
}
