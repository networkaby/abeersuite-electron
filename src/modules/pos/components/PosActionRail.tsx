"use client";

// ── PosActionRail ─────────────────────────────────────────────────────────────
// Narrow vertical action rail pinned to the far-right edge of the POS screen
// (full height, beside the customer panel).
//
// ► To add / remove / reorder buttons, edit POS_RAIL_ACTIONS in
//   src/shared/lib/constants/quickActions.ts. This component only
//   wires the handlers keyed by each action's `key` (e.g. rcv/exp).

import { Fragment } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { POS_RAIL_ACTIONS, type PosRailAccessKey } from "@/shared/lib/constants/quickActions";

// Same pastel hue language as the header (PosTopBar's `tint`) — colored icon +
// label with a soft hover wash, dark-mode paired. Keyed by the `tint` field each
// rail action declares in constants.ts.
const tint = {
    emerald: "text-emerald-700 hover:bg-emerald-100/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30",
    amber:   "text-amber-700 hover:bg-amber-100/60 dark:text-amber-300 dark:hover:bg-amber-950/30",
    indigo:  "text-indigo-700 hover:bg-indigo-100/60 dark:text-indigo-300 dark:hover:bg-indigo-950/30",
    sky:     "text-sky-700 hover:bg-sky-100/60 dark:text-sky-300 dark:hover:bg-sky-950/30",
    violet:  "text-violet-700 hover:bg-violet-100/60 dark:text-violet-300 dark:hover:bg-violet-950/30",
    rose:    "text-rose-700 hover:bg-rose-100/60 dark:text-rose-300 dark:hover:bg-rose-950/30",
    cyan:    "text-cyan-700 hover:bg-cyan-100/60 dark:text-cyan-300 dark:hover:bg-cyan-950/30",
    teal:    "text-teal-700 hover:bg-teal-100/60 dark:text-teal-300 dark:hover:bg-teal-950/30",
} as const;

export type PosActionRailProps = {
    onExp: () => void;
    onRcv: () => void;
    onHelp: () => void;
    onTicket: () => void;
    onEnquiry: () => void;
    onTask: () => void;
    onDeal: () => void;
    onLead: () => void;
    onChat: () => void;
    canExp?: boolean;
    canRcv?: boolean;
    /** Unread chat count — badges the Chat button. */
    chatUnread?: number;
};

export function PosActionRail({ onExp, onRcv, onHelp, onTicket, onEnquiry, onTask, onDeal, onLead, onChat, canExp = true, canRcv = true, chatUnread = 0 }: PosActionRailProps) {
    const handlers: Record<string, () => void> = { rcv: onRcv, exp: onExp, help: onHelp, ticket: onTicket, enquiry: onEnquiry, task: onTask, deal: onDeal, lead: onLead, chat: onChat };
    const flags: Record<PosRailAccessKey, boolean> = { canRcv, canExp };
    const badges: Record<string, number> = { chat: chatUnread };
    // The help ("?") action is pinned to the BOTTOM of the rail, apart from the
    // other buttons: rendered in its own mt-auto block below the main group.
    const helpAction = POS_RAIL_ACTIONS.find((a) => a.key === "help");
    const mainActions = POS_RAIL_ACTIONS.filter((a) => a.key !== "help");

    return (
        <aside className="flex w-16 shrink-0 flex-col items-stretch gap-1 border-l border-border bg-muted/30 p-1.5">
            {mainActions.map((a) => {
                if (a.can && !flags[a.can]) return null;
                const onClick =
                    a.kind === "action"
                        ? (handlers[a.key] ?? (() => { }))
                        : () => toast.info(`${a.label} — coming soon`);
                return (
                    <Fragment key={a.key}>
                        {a.divider && <div className="my-1 border-t border-border/70" />}
                        <RailButton icon={<a.icon size={16} />} label={a.label} onClick={onClick} title={a.title} tint={a.tint ? tint[a.tint] : undefined} badge={badges[a.key]} />
                    </Fragment>
                );
            })}

            {helpAction && (
                <div className="mt-auto">
                    {helpAction.divider && <div className="my-1 border-t border-border/70" />}
                    <RailButton
                        icon={<helpAction.icon size={16} />}
                        label={helpAction.label}
                        onClick={handlers.help ?? (() => { })}
                        title={helpAction.title}
                        tint={helpAction.tint ? tint[helpAction.tint] : undefined}
                    />
                </div>
            )}
        </aside>
    );
}

function RailButton({
    icon,
    label,
    onClick,
    title,
    tint,
    badge,
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    title?: string;
    tint?: string;
    badge?: number;
}) {
    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            title={title ?? label}
            className={`relative flex h-auto flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium ${tint ?? ""}`}
        >
            {!!badge && (
                <span className="absolute right-1.5 top-1 rounded-full bg-primary px-1 py-0.5 text-[9px] font-bold leading-none text-primary-foreground">
                    {badge > 99 ? "99+" : badge}
                </span>
            )}
            {icon}
            {label}
        </Button>
    );
}
