import Image from "next/image";
import { BRAND_LOGOS } from "@/lib/shop/store-content";

export default function BrandStrip() {
    if (BRAND_LOGOS.length === 0) return null;
    return (
        <section className="border-b border-border/60 bg-background">
            <div className="mx-auto max-w-6xl px-4 py-10">
                <div className="mb-6 flex items-end justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Trusted brands</p>
                        <h2 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">
                            Original products from leading manufacturers
                        </h2>
                    </div>
                </div>
                <ul className="-mx-4 flex gap-6 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:gap-10">
                    {BRAND_LOGOS.map((b) => (
                        <li
                            key={b.name}
                            title={b.name}
                            className="group flex h-20 w-32 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card p-4 grayscale transition-all hover:border-primary/40 hover:bg-card hover:grayscale-0"
                        >
                            <Image
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
