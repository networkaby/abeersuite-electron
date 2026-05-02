import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { BRAND_LOGOS } from "@/lib/shop/store-content";

export default function BrandStrip() {
    if (BRAND_LOGOS.length === 0) return null;
    return (
        <section className="border-b border-border/60 bg-background">
            <div className="mx-auto max-w-6xl px-3 py-8 sm:px-4 sm:py-10">
                <div className="mb-6 flex items-end justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Trusted brands</p>
                        <h2 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">
                            Original products from leading manufacturers
                        </h2>
                    </div>
                </div>
                <ul className="-mx-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-3 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] sm:-mx-4 sm:gap-10 sm:px-4">
                    {BRAND_LOGOS.map((b) => (
                        <li
                            key={b.name}
                            title={b.name}
                            className="group flex h-[4.5rem] w-[7.5rem] shrink-0 snap-start touch-manipulation items-center justify-center rounded-xl border border-border/60 bg-card p-3 grayscale transition-all active:scale-[0.98] sm:h-20 sm:w-32 sm:p-4 hover:border-primary/40 hover:bg-card hover:grayscale-0"
                        >
                            <ShopRemoteImage
                                src={b.logoUrl}
                                alt={b.name}
                                width={96}
                                height={48}
                                unoptimized
                                className="h-10 w-auto max-w-full opacity-70 transition-opacity group-hover:opacity-100"
                            />
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
