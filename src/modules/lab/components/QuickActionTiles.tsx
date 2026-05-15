"use client";

import Link from "next/link";
import {
    Wrench,
    ShoppingCart,
    Truck,
    MessageSquarePlus,
    Package,
    CreditCard,
    Boxes,
} from "lucide-react";

interface QuickActionTilesProps {
    /** Called when the "New repair ticket" tile is clicked. */
    onNewTicket: () => void;
}

interface Tile {
    label: string;
    hint: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    accent: string;
    /** Either a navigation href OR a click handler (mutually exclusive). */
    href?: string;
    onClick?: () => void;
    /** Stub tiles show a "soon" badge and don't navigate. */
    soon?: boolean;
}

export default function QuickActionTiles({ onNewTicket }: QuickActionTilesProps) {
    const tiles: Tile[] = [
        {
            label: "New repair ticket",
            hint: "Customer dropped off a device",
            icon: Wrench,
            accent: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
            onClick: onNewTicket,
        },
        {
            label: "New POS sale",
            hint: "Counter sale to a walk-in",
            icon: ShoppingCart,
            accent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            href: "/vouchers/pos/new",
        },
        {
            label: "New delivery order",
            hint: "Send goods to a customer address",
            icon: Truck,
            accent: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
            href: "/office/ecommerce",
        },
        {
            label: "Log enquiry / lead",
            hint: "Phone, WhatsApp or walk-in query",
            icon: MessageSquarePlus,
            accent: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
            href: "/office/crm/leads/new",
        },
        {
            label: "Courier arrived (GRN)",
            hint: "Receive a parcel from a supplier",
            icon: Package,
            accent: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
            href: "/vouchers/grn/new",
        },
        {
            label: "Pay a bill",
            hint: "Electricity, rent, supplier payment",
            icon: CreditCard,
            accent: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
            href: "/vouchers/payments/new",
        },
        {
            label: "Internal request",
            hint: "Packaging, consumables, supplies",
            icon: Boxes,
            accent: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            soon: true,
        },
    ];

    return (
        <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quick actions
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {tiles.map((tile) => {
                    const Icon = tile.icon;
                    const inner = (
                        <>
                            <div
                                className={`inline-flex h-11 w-11 items-center justify-center rounded-md ${tile.accent}`}
                            >
                                <Icon size={22} />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="truncate font-medium text-foreground">
                                        {tile.label}
                                    </span>
                                    {tile.soon && (
                                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                            soon
                                        </span>
                                    )}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {tile.hint}
                                </div>
                            </div>
                        </>
                    );

                    const tileClasses =
                        "group flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-foreground/30 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:shadow-none";

                    if (tile.soon) {
                        return (
                            <button
                                key={tile.label}
                                type="button"
                                disabled
                                className={tileClasses}
                                title="Internal stock-request flow not yet implemented"
                            >
                                {inner}
                            </button>
                        );
                    }
                    if (tile.href) {
                        return (
                            <Link
                                key={tile.label}
                                href={tile.href}
                                className={tileClasses}
                            >
                                {inner}
                            </Link>
                        );
                    }
                    return (
                        <button
                            key={tile.label}
                            type="button"
                            onClick={tile.onClick}
                            className={tileClasses}
                        >
                            {inner}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
