"use client";

// ── PosActionRail ─────────────────────────────────────────────────────────────
// Narrow vertical action rail pinned to the far-right edge of the POS screen
// (full height, beside the customer panel).
//
// ► To add / remove / reorder buttons, edit POS_RAIL_ACTIONS in
//   src/utils/constants.ts (alongside the sidebar nav). This component only
//   wires the handlers keyed by each action's `key` (e.g. rcv/exp).

import { Fragment } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { POS_RAIL_ACTIONS, type PosRailAccessKey } from "@/utils/constants";

export type PosActionRailProps = {
    onExp: () => void;
    onRcv: () => void;
    onHelp: () => void;
    onTicket: () => void;
    onEnquiry: () => void;
    canExp?: boolean;
    canRcv?: boolean;
};

export function PosActionRail({ onExp, onRcv, onHelp, onTicket, onEnquiry, canExp = true, canRcv = true }: PosActionRailProps) {
    const handlers: Record<string, () => void> = { rcv: onRcv, exp: onExp, help: onHelp, ticket: onTicket, enquiry: onEnquiry };
    const flags: Record<PosRailAccessKey, boolean> = { canRcv, canExp };

    return (
        <aside className="flex w-16 shrink-0 flex-col items-stretch gap-1 border-l border-border bg-muted/30 p-1.5">
            {POS_RAIL_ACTIONS.map((a) => {
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
