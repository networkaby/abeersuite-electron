"use client";

import Link from "next/link";
import { buildQuickActions } from "@/modules/lab/lib/quickActions";
import { moduleColor, moduleTint } from "@/shared/lib/format/moduleTheme";

/**
 * Slim vertical toolbar of Front Office quick actions, pinned to the far-right
 * edge (after the customer panel). Icon-only with hover tooltips so it stays a
 * thin "bar". Shares its action set with {@link QuickActionTiles} via
 * `buildQuickActions` so the two never drift.
 */
interface QuickActionBarProps {
    /** Called when the "New repair ticket" action is clicked. */
    onNewTicket: () => void;
}

export default function QuickActionBar({ onNewTicket }: QuickActionBarProps) {
    const actions = buildQuickActions({ onNewTicket });
    const btn =
        "inline-flex h-11 w-11 items-center justify-center rounded-lg transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100";

    return (
        <div className="hidden lg:flex lg:sticky lg:top-4 h-fit flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-sm">
            {actions.map((a) => {
                const Icon = a.icon;
                if (a.soon) {
                    return (
                        <button
                            key={a.label}
                            type="button"
                            disabled
                            className={btn}
                            style={{ backgroundColor: moduleTint(a.module, 16), color: moduleColor(a.module) }}
                            title={`${a.label} — soon`}
                            aria-label={a.label}
                        >
                            <Icon size={19} />
                        </button>
                    );
                }
                if (a.href) {
                    return (
                        <Link
                            key={a.label}
                            href={a.href}
                            className={btn}
                            style={{ backgroundColor: moduleTint(a.module, 16), color: moduleColor(a.module) }}
                            title={`${a.label} · ${a.hint}`}
                            aria-label={a.label}
                        >
                            <Icon size={19} />
                        </Link>
                    );
                }
                return (
                    <button
                        key={a.label}
                        type="button"
                        onClick={a.onClick}
                        className={btn}
                            style={{ backgroundColor: moduleTint(a.module, 16), color: moduleColor(a.module) }}
                        title={`${a.label} · ${a.hint}`}
                        aria-label={a.label}
                    >
                        <Icon size={19} />
                    </button>
                );
            })}
        </div>
    );
}
