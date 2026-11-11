"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Search box for master list pages. Pairs with `useListSearch`. Esc clears it. */
export function ListSearchInput({
    value,
    onChange,
    placeholder = "Search…",
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    return (
        <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
                type="search"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape" && value) {
                        e.stopPropagation();
                        onChange("");
                    }
                }}
                placeholder={placeholder}
                aria-label={placeholder}
                className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
            />
            {value ? (
                <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => onChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                    <X className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
