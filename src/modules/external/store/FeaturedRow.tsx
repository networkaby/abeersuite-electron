import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ProductCard from "@/modules/external/shop/ProductCard";
import type { ShopProductPublic } from "@/lib/shop/product-public";

export default function FeaturedRow({
    id,
    eyebrow,
    title,
    subtitle,
    products,
    accent = "primary",
}: {
    id?: string;
    eyebrow?: string;
    title: string;
    subtitle?: string;
    products: ShopProductPublic[];
    accent?: "primary" | "violet" | "emerald";
}) {
    if (products.length === 0) return null;

    const accentText =
        accent === "violet"
            ? "text-violet-600 dark:text-violet-400"
            : accent === "emerald"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-primary";

    return (
        <section id={id} className="border-b border-border/60 scroll-mt-24 sm:scroll-mt-20">
            <div className="mx-auto max-w-6xl px-3 py-10 sm:px-4 sm:py-12">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4 sm:mb-6">
                    <div className="min-w-0">
                        {eyebrow ? (
                            <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${accentText}`}>{eyebrow}</p>
                        ) : null}
                        <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
                        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
                    </div>
                    <Link
                        href="#catalog"
                        className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-muted-foreground touch-manipulation hover:text-primary"
                    >
                        See all in catalog
                        <ArrowRight className="size-4" />
                    </Link>
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
