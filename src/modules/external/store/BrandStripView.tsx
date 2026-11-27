import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";

export type BrandStripBrand = { name: string; imageUrl: string | null; slug: string | null };

/**
 * Presentational half of the brand strip — takes its brands as a prop.
 *
 * Split out from BrandStrip (which is an async Server Component that queries
 * Prisma) so the Customize Home live preview, a client component, can render
 * the REAL strip with brands it fetched over the API. One markup, two callers;
 * the storefront and the preview can't drift apart.
 */
export default function BrandStripView({
    brands,
    eyebrow = "Trusted brands",
    title = "Original products from leading manufacturers",
    moreHref,
}: {
    brands: BrandStripBrand[];
    eyebrow?: string;
    title?: string;
    /** "All brands" link to the full list when the strip shows only some. */
    moreHref?: string;
}) {
    if (brands.length === 0) return null;
    return (
        <section className="border-b border-border/60 bg-background">
            <div className="mx-auto max-w-6xl px-3 py-8 sm:px-4 sm:py-10">
                <div className="mb-6 flex items-end justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
                        <h2 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
                    </div>
                    {moreHref ? (
                        <Link href={moreHref} className="text-sm font-semibold text-primary hover:underline">
                            All brands →
                        </Link>
                    ) : null}
                </div>
                <ul className="-mx-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-3 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] sm:-mx-4 sm:gap-10 sm:px-4">
                    {brands.map((b) => {
                        const tileClass =
                            "group flex h-[4.5rem] w-[7.5rem] shrink-0 snap-start touch-manipulation items-center justify-center rounded-xl border border-border/60 bg-card p-3 grayscale transition-all active:scale-[0.98] sm:h-20 sm:w-32 sm:p-4 hover:border-primary/40 hover:bg-card hover:grayscale-0";
                        const logo = (
                            <ShopRemoteImage
                                src={b.imageUrl!}
                                alt={b.name}
                                width={96}
                                height={48}
                                unoptimized
                                className="h-10 w-full object-contain opacity-70 transition-opacity group-hover:opacity-100"
                            />
                        );
                        return (
                            <li key={b.name} title={b.name} className="shrink-0 snap-start">
                                {b.slug ? (
                                    <Link href={`/${b.slug}`} className={tileClass}>
                                        {logo}
                                    </Link>
                                ) : (
                                    <div className={tileClass}>{logo}</div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
}
