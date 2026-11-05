import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { ArrowRight } from "lucide-react";
import { CATEGORY_IMAGES } from "@/shared/lib/shop/storeContent";

type CategoryEntry = {
    name: string;
    count: number;
    /** Optional fallback product image if the category isn't in CATEGORY_IMAGES. */
    fallbackImageUrl?: string | null;
};

export default function CategoryShowcase({
    categories,
    eyebrow = "Departments",
    title = "Shop by category",
    subtitle = "Tap a department to see everything in it.",
}: {
    categories: CategoryEntry[];
    eyebrow?: string;
    title?: string;
    subtitle?: string;
}) {
    if (categories.length === 0) return null;

    return (
        <section className="border-b border-border/60 bg-background">
            <div className="mx-auto max-w-6xl px-3 py-10 sm:px-4 sm:py-14">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
                        <h2 className="mt-2 text-xl font-bold tracking-tight sm:text-3xl">{title}</h2>
                        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
                    </div>
                </div>

                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                    {categories.map(({ name, count, fallbackImageUrl }) => {
                        const known = CATEGORY_IMAGES[name];
                        const imageUrl = known?.imageUrl ?? fallbackImageUrl ?? null;
                        const imageAlt = known?.imageAlt ?? `${name} category image`;

                        return (
                            <li key={name}>
                                <a
                                    // Open the shop filtered to this category. A same-page
                                    // "#cat-…" jump only worked when the Home layout also
                                    // carried the Full catalogue section; without it every tile was dead.
                                    href={`/shop?category=${encodeURIComponent(name)}`}
                                    className="group relative block touch-manipulation overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-all active:scale-[0.99] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
                                >
                                    <div className="relative aspect-[4/3] bg-muted">
                                        {imageUrl ? (
                                            <ShopRemoteImage
                                                src={imageUrl}
                                                alt={imageAlt}
                                                fill
                                                sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                                                className="object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                                            />
                                        ) : (
                                            <div className="flex size-full items-center justify-center text-muted-foreground text-sm">
                                                No image
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-linear-to-t from-black/65 via-black/20 to-transparent" />
                                        <span className="absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-0.5 text-xs font-semibold text-foreground shadow">
                                            {count} item{count === 1 ? "" : "s"}
                                        </span>
                                        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-white">
                                            <p className="text-base font-semibold leading-tight sm:text-lg">{name}</p>
                                            <span className="inline-flex size-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition group-hover:bg-white/35">
                                                <ArrowRight className="size-4" />
                                            </span>
                                        </div>
                                    </div>
                                </a>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
}
