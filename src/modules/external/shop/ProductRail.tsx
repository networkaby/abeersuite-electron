import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ProductCard from "@/modules/external/shop/ProductCard";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { cn } from "@/shared/lib/format/utils";

/**
 * One horizontally-scrolling row of product cards.
 *
 * The single rail used everywhere a row of products appears: the store home's
 * "Top picks" and "Today's deals", and the product page's "Similar products".
 * They render identically by construction — same card, same scroll behaviour,
 * same measurements — because they are the same component.
 *
 * Mobile-first: the row is a snap-scrolling strip at every width (a customer on
 * a phone swipes; there is no desktop-only grid variant to keep in sync).
 */
export default function ProductRail({
    id,
    eyebrow,
    title,
    subtitle,
    products,
    accent = "primary",
    /** Where "see all" points. Omit to hide the link entirely. */
    seeAllHref = "/shop",
    seeAllLabel = "See all in catalog",
    /** Home-page sections are separated by a rule; in-page rails supply their own. */
    bordered = true,
    className,
}: {
    id?: string;
    eyebrow?: string;
    title: string;
    subtitle?: string;
    products: ShopProductPublic[];
    accent?: "primary" | "violet" | "emerald";
    seeAllHref?: string | null;
    seeAllLabel?: string;
    bordered?: boolean;
    className?: string;
}) {
    if (products.length === 0) return null;

    const accentText =
        accent === "violet"
            ? "text-violet-600 dark:text-violet-400"
            : accent === "emerald"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-primary";

    return (
        <section id={id} className={cn(bordered && "border-b border-border/60", "scroll-mt-24 sm:scroll-mt-20", className)}>
            <div className={cn("mx-auto max-w-6xl", bordered && "px-3 py-10 sm:px-4 sm:py-12")}>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4 sm:mb-6">
                    <div className="min-w-0">
                        {eyebrow ? (
                            <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${accentText}`}>{eyebrow}</p>
                        ) : null}
                        <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
                        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
                    </div>
                    {seeAllHref ? (
                        <Link
                            href={seeAllHref}
                            className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-muted-foreground touch-manipulation hover:text-primary"
                        >
                            {seeAllLabel}
                            <ArrowRight className="size-4" />
                        </Link>
                    ) : null}
                </div>

                <div className="-mx-3 flex snap-x snap-mandatory gap-0 overflow-x-auto px-3 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] sm:-mx-4 sm:px-4">
                    <ul className="flex w-max items-stretch gap-4 pr-4 sm:gap-5">
                        {products.map((p) => (
                            <li
                                key={p.id}
                                className="flex w-[min(85vw,280px)] shrink-0 snap-start flex-col sm:w-[280px]"
                            >
                                <ProductCard product={p} className="min-h-0 flex-1" />
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
