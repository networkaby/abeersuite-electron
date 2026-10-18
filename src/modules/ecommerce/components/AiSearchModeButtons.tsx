"use client";

import { AI_SEARCH_MODES, type AiSearchMode } from "@/shared/lib/constants/ai";

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
