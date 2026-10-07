import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import type { StorefrontCategory } from "@/shared/lib/shop/storefrontProducts";

/** Where a category opens — the shop's filtered list for now; the app's own
 *  product list comes with the shopping phase. */
export function categoryHref(name: string): string {
    return `/shop?category=${encodeURIComponent(name)}`;
}

/**
 * Round category tiles, four to a row. `limit` keeps Home to two rows and adds
 * an "All" tile that opens the Categories tab; the tab itself passes no limit.
 */
export default function AppCategoryGrid({
    categories,
    limit,
    allHref,
}: {
    categories: StorefrontCategory[];
    limit?: number;
    allHref?: string;
}) {
    const shown = limit ? categories.slice(0, limit - 1) : categories;
    const tile = "flex flex-col items-center gap-1.5 text-center active:opacity-70";
    const circle = "relative flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-white";
    return (
        <ul className="grid grid-cols-4 gap-x-2 gap-y-4 px-4">
            {shown.map((c) => (
                <li key={c.name}>
                    <Link href={categoryHref(c.name)} className={tile}>
                        <span className={circle}>
                            <ShopRemoteImage src={c.fallbackImageUrl} alt="" fill sizes="64px" className="object-contain p-1.5" />
                        </span>
                        <span className="line-clamp-2 text-[11px] leading-tight">{c.name}</span>
                    </Link>
                </li>
            ))}
            {limit && allHref && categories.length > shown.length && (
                <li>
                    <Link href={allHref} className={tile}>
                        <span className={`${circle} bg-primary/10 text-primary`}>
                            <LayoutGrid className="size-6" />
                        </span>
                        <span className="text-[11px] leading-tight">All</span>
                    </Link>
                </li>
            )}
        </ul>
    );
}
