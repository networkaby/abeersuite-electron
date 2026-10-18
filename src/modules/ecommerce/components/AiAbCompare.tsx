"use client";

import { Button } from "@/components/ui/button";
import { AI_SEARCH_MODES, type AiSearchMode } from "@/shared/lib/constants/ai";
import type { AiVersion, ProductCopy } from "@/modules/ecommerce/lib/aiCopyClient";

// The AI search trial (2026-10-19): staff choose a search mode, and when search
// changed the copy they see version A (photo only) beside B (with search) and
// keep one. Each pick is logged; the owner settles on one mode later and this
// file goes.

/** Off · When it helps · Always — option buttons in place of the old switch. */
export function SearchModeButtons({ value, onChange, disabled }: {
    value: AiSearchMode;
    onChange: (v: AiSearchMode) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Search online:</span>
            <div role="radiogroup" aria-label="Search online" className="inline-flex rounded-md border border-border p-0.5">
                {AI_SEARCH_MODES.map((m) => (
                    <button
                        key={m.value}
                        type="button"
                        role="radio"
                        aria-checked={value === m.value}
                        disabled={disabled}
                        onClick={() => onChange(m.value)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            value === m.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                        }`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Version A and B side by side (stacked on a phone), each with its own pick button. */
export function AbCompare({ draft, pickLabel, onPick }: {
    draft: ProductCopy;
    pickLabel: string;
    onPick: (picked: "A" | "B", version: AiVersion) => void;
}) {
    if (!draft.photoOnly) return null;
    const t = draft.stats.tokens;
    return (
        <div className="space-y-2">
            <p className="text-xs font-medium">Compare and keep one (test — your pick is recorded):</p>
            <div className="grid gap-2 md:grid-cols-2">
                <VersionCard
                    heading="A · Name and photo only"
                    cost={`${t.draft.toLocaleString("en-IN")} tokens`}
                    version={draft.photoOnly}
                    pickLabel={pickLabel}
                    onPick={() => onPick("A", draft.photoOnly!)}
                />
                <VersionCard
                    heading={`B · With online search (${draft.stats.verifiedFacts} fact${draft.stats.verifiedFacts === 1 ? "" : "s"} checked)`}
                    cost={`${(t.draft + t.search + t.polish).toLocaleString("en-IN")} tokens`}
                    version={draft}
                    pickLabel={pickLabel}
                    onPick={() => onPick("B", draft)}
                />
            </div>
        </div>
    );
}

function VersionCard({ heading, cost, version, pickLabel, onPick }: {
    heading: string;
    cost: string;
    version: AiVersion;
    pickLabel: string;
    onPick: () => void;
}) {
    const specs = Object.entries(version.specs);
    return (
        <div className="bg-muted/40 flex flex-col gap-1.5 rounded-md border border-border p-2 text-sm">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="text-xs font-semibold">{heading}</p>
                    <p className="text-muted-foreground text-xs">{cost}</p>
                </div>
                <Button type="button" size="sm" onClick={onPick}>{pickLabel}</Button>
            </div>
            <p className="font-medium">{version.title}</p>
            <p className="whitespace-pre-line">{version.shopDescription}</p>
            {specs.length > 0 && (
                <p className="text-muted-foreground text-xs">{specs.map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
            )}
            {version.unsure.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">Please check: {version.unsure.join("; ")}</p>
            )}
        </div>
    );
}
