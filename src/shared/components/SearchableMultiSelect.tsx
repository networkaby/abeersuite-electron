"use client";

// Several values from one searchable list: the picked ones show as chips, the
// box below adds another (SearchableSelect, so search + "+ New…" work the same
// as everywhere else). Order is kept — with `primaryLabel` the first chip is
// marked as the main one and any other chip can be made main with a click.

import { Star, X } from "lucide-react";
import { SearchableSelect, type SearchableSelectOption } from "@/shared/components/SearchableSelect";

export interface SearchableMultiSelectProps<V extends string | number> {
    value: V[];
    options: SearchableSelectOption<V>[];
    onChange: (next: V[]) => void;
    placeholder?: string;
    onCreate?: () => Promise<V | null>;
    createLabel?: string;
    /** When set, the first chip is the main one ("Main" tooltip on its star). */
    primaryLabel?: string;
}

export function SearchableMultiSelect<V extends string | number>({
    value, options, onChange, placeholder = "Add…", onCreate, createLabel, primaryLabel,
}: SearchableMultiSelectProps<V>) {
    const byValue = new Map(options.map((o) => [o.value, o]));
    const remaining = options.filter((o) => !value.includes(o.value));
    const add = (v: V | null) => { if (v != null && !value.includes(v)) onChange([...value, v]); };

    return (
        <div className="space-y-1.5">
            {value.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {value.map((v, i) => {
                        const o = byValue.get(v);
                        const main = primaryLabel != null && i === 0;
                        return (
                            <span
                                key={String(v)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${main ? "border-primary bg-primary/10" : "bg-muted/40"}`}
                            >
                                {primaryLabel != null ? (
                                    <button
                                        type="button"
                                        title={main ? primaryLabel : `Make ${primaryLabel.toLowerCase()}`}
                                        onClick={() => { if (!main) onChange([v, ...value.filter((x) => x !== v)]); }}
                                        className={main ? "text-primary" : "text-muted-foreground hover:text-foreground"}
                                    >
                                        <Star className={`size-3 ${main ? "fill-current" : ""}`} />
                                    </button>
                                ) : null}
                                {o ? (o.leaf ?? o.label) : `#${v}`}
                                <button
                                    type="button"
                                    aria-label="Remove"
                                    onClick={() => onChange(value.filter((x) => x !== v))}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <X className="size-3" />
                                </button>
                            </span>
                        );
                    })}
                </div>
            ) : null}
            <SearchableSelect<V>
                value={null}
                options={remaining}
                onChange={add}
                placeholder={placeholder}
                clearable={false}
                onCreate={onCreate}
                createLabel={createLabel}
            />
        </div>
    );
}
