import Link from "next/link";
import type { VariantOption } from "@/shared/lib/shop/variants";

/** "Option: [Black] [Blue]" — each button opens that product's own page (lib/shop/variants.ts). */
export default function VariantPicker({ options, className = "" }: { options: VariantOption[]; className?: string }) {
    if (options.length < 2) return null;
    const current = options.find((o) => o.current);
    return (
        <div className={className}>
            <p className="mb-2 text-sm text-muted-foreground">
                Option{current ? <>: <span className="font-medium text-foreground">{current.label}</span></> : null}
            </p>
            <div className="flex flex-wrap gap-2">
                {options.map((o) =>
                    o.current ? (
                        <span
                            key={o.id}
                            aria-current="true"
                            className="rounded-lg border-2 border-primary bg-primary/5 px-3 py-1.5 text-sm font-medium"
                        >
                            {o.label}
                        </span>
                    ) : (
                        <Link
                            key={o.id}
                            href={o.href}
                            replace
                            scroll={false}
                            className={`rounded-lg border px-3 py-1.5 text-sm hover:border-primary ${
                                o.available ? "" : "text-muted-foreground line-through decoration-1"
                            }`}
                            title={o.available ? undefined : "Out of stock"}
                        >
                            {o.label}
                        </Link>
                    )
                )}
            </div>
        </div>
    );
}
