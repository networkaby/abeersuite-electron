"use client";

// Several values from one searchable list: the picked ones show as chips, the
// box adds another (SearchableSelect, so search + "+ New…" work the same as
// everywhere else). Order is kept — with `primaryLabel` the first chip is
// marked as the main one and any other chip can be made main with a click.
//
// `showChips={false}` renders the add box alone, so a form can put the chips
// on a row of their own (<MultiSelectChips>) and keep the box in line with
// its neighbours however many are picked.

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
    /** false = the add box only; render <MultiSelectChips> elsewhere. */
    showChips?: boolean;
}

type ChipsProps<V extends string | number> = Pick<
    SearchableMultiSelectProps<V>,
    "value" | "options" | "onChange" | "primaryLabel"
>;

/** The picked values as chips: remove with ×, make main with the star. */
export function MultiSelectChips<V extends string | number>({ value, options, onChange, primaryLabel }: ChipsProps<V>) {
    if (value.length === 0) return null;
    const byValue = new Map(options.map((o) => [o.value, o]));
    return (
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
    );
}

export function SearchableMultiSelect<V extends string | number>({
    value, options, onChange, placeholder = "Add…", onCreate, createLabel, primaryLabel, showChips = true,
}: SearchableMultiSelectProps<V>) {
    const remaining = options.filter((o) => !value.includes(o.value));
    const add = (v: V | null) => { if (v != null && !value.includes(v)) onChange([...value, v]); };

    return (
        <div className="space-y-1.5">
            {showChips ? <MultiSelectChips value={value} options={options} onChange={onChange} primaryLabel={primaryLabel} /> : null}
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
