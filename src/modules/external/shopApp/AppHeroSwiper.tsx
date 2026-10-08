"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import type { HeroSlide } from "@/shared/lib/shop/storeContent";
import { toAppHref } from "@/modules/external/shopApp/appPaths";

const AUTO_MS = 4000;

/**
 * The home banners — the website hero's own slides (Customize Home) — as full
 * width cards that slide by themselves every few seconds, with dots; a swipe
 * takes over and the timer starts again from there.
 */
export default function AppHeroSwiper({ slides }: { slides: HeroSlide[] }) {
    const strip = useRef<HTMLUListElement>(null);
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (slides.length < 2) return;
        const t = setTimeout(() => {
            const el = strip.current;
            if (!el) return;
            const next = (index + 1) % slides.length;
            el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
        }, AUTO_MS);
        return () => clearTimeout(t);
    }, [index, slides.length]);

    if (slides.length === 0) return null;
    return (
        <div className="relative">
            <ul
                ref={strip}
                onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
                className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {slides.map((s, i) => (
                    <li key={s.id} className="w-full shrink-0 snap-center px-3">
                        <Link href={s.ctaHref.startsWith("#") ? toAppHref("/shop") : toAppHref(s.ctaHref)} className="relative block aspect-[2/1] overflow-hidden rounded-2xl bg-slate-900">
                            <ShopRemoteImage src={s.imageUrl} alt={s.imageAlt} fill sizes="100vw" className="object-cover opacity-75" priority={i === 0} />
                            <div className="absolute inset-0 bg-linear-to-r from-black/70 via-black/30 to-transparent" />
                            <div className="absolute inset-y-0 left-0 flex max-w-[70%] flex-col justify-center p-4 text-white">
                                {s.eyebrow && <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-300">{s.eyebrow}</p>}
                                <p className="mt-1 text-lg font-bold leading-tight">{s.title}</p>
                                <p className="mt-2 w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900">{s.ctaLabel}</p>
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>
            {slides.length > 1 && (
                <div className="mt-2 flex justify-center gap-1.5">
                    {slides.map((_, i) => (
                        <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"}`} />
                    ))}
                </div>
            )}
        </div>
    );
}
