import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import type { HeroSlide } from "@/shared/lib/shop/storeContent";
import { toAppHref } from "@/modules/external/shopApp/appPaths";

/**
 * The home banners as swipeable cards — the same slides the website's hero
 * shows (Customize Home), but card-sized: the whole card is the tap, and the
 * next card peeks in from the right. Pure scroll-snap, no script.
 */
export default function AppHeroSwiper({ slides }: { slides: HeroSlide[] }) {
    if (slides.length === 0) return null;
    return (
        <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {slides.map((s) => (
                <li key={s.id} className={`shrink-0 snap-start ${slides.length > 1 ? "w-[88%]" : "w-full"}`}>
                    <Link href={s.ctaHref.startsWith("#") ? toAppHref("/shop") : toAppHref(s.ctaHref)} className="relative block aspect-[16/9] overflow-hidden rounded-2xl bg-black">
                        <ShopRemoteImage src={s.imageUrl} alt={s.imageAlt} fill sizes="90vw" className="object-cover opacity-80" />
                        <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />
                        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                            {s.eyebrow && <p className="text-[10px] font-semibold uppercase tracking-widest text-white/80">{s.eyebrow}</p>}
                            <p className="mt-0.5 text-lg font-bold leading-tight">{s.title}</p>
                            <p className="mt-1.5 inline-block rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">{s.ctaLabel}</p>
                        </div>
                    </Link>
                </li>
            ))}
        </ul>
    );
}
