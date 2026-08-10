"use client";

import Link from "next/link";
import { buildQuickActions } from "@/modules/lab/lib/quickActions";
import { moduleColor, moduleTint } from "@/shared/lib/format/moduleTheme";

interface QuickActionTilesProps {
    /** Called when the "New repair ticket" tile is clicked. */
    onNewTicket: () => void;
}

export default function QuickActionTiles({ onNewTicket }: QuickActionTilesProps) {
    const tiles = buildQuickActions({ onNewTicket });

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
                                className="inline-flex h-11 w-11 items-center justify-center rounded-md"
                                style={{ backgroundColor: moduleTint(tile.module, 16), color: moduleColor(tile.module) }}
                            >
                                <Icon size={22} />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="truncate font-medium text-foreground">
                                        {tile.label}
                                    </span>
                                    {tile.soon && (
                                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
