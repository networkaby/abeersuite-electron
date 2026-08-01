"use client";

import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/format/utils";
import type { HeroSlide } from "@/shared/lib/shop/storeContent";

const ROTATE_MS = 6000;

const ACCENT_DOT: Record<HeroSlide["accent"], string> = {
    primary: "bg-primary",
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
};

const ACCENT_TEXT: Record<HeroSlide["accent"], string> = {
    primary: "text-primary",
    violet: "text-violet-300",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
};

export default function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
    const [active, setActive] = useState(0);
    const [paused, setPaused] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const touchResumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const total = slides.length;

    const goTo = useCallback(
        (idx: number) => {
            if (total === 0) return;
            setActive(((idx % total) + total) % total);
        },
        [total],
    );

    const next = useCallback(() => goTo(active + 1), [active, goTo]);
    const prev = useCallback(() => goTo(active - 1), [active, goTo]);

    useEffect(() => {
        if (paused || total <= 1) return;
        timerRef.current = setInterval(() => {
            setActive((a) => (a + 1) % total);
        }, ROTATE_MS);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [paused, total]);

    useEffect(() => {
        return () => {
            if (touchResumeRef.current) clearTimeout(touchResumeRef.current);
        };
    }, []);

    if (total === 0) return null;

    return (
        <section
            className="relative isolate touch-pan-y overflow-hidden border-b border-border/80 bg-black"
            aria-roledescription="carousel"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            onTouchStart={() => {
                if (touchResumeRef.current) clearTimeout(touchResumeRef.current);
                setPaused(true);
            }}
            onTouchEnd={() => {
                if (touchResumeRef.current) clearTimeout(touchResumeRef.current);
                touchResumeRef.current = setTimeout(() => setPaused(false), 4000);
            }}
        >
            <div className="relative h-[min(78svh,480px)] sm:h-[480px] lg:h-[520px]">
                {slides.map((s, i) => (
                    <div
                        key={s.id}
                        className={cn(
                            "absolute inset-0 transition-opacity duration-700 ease-out",
                            i === active ? "opacity-100" : "pointer-events-none opacity-0",
                        )}
                        aria-hidden={i !== active}
                    >
                        <ShopRemoteImage
                            src={s.imageUrl}
                            alt={s.imageAlt}
                            fill
                            priority={i === 0}
                            sizes="100vw"
                            className="object-cover"
                        />
                        <div className="absolute inset-0 bg-linear-to-r from-black/85 via-black/55 to-black/25 sm:from-black/80 sm:via-black/40 sm:to-transparent" />
                        <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/30 to-transparent sm:from-black/60 sm:via-transparent" />
                        <div className="relative mx-auto flex h-full max-w-6xl items-end pb-28 pt-10 sm:items-center sm:pb-0 sm:pt-0 px-4 sm:px-6">
                            <div className="max-w-xl text-white">
                                <p
                                    className={cn(
                                        "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em]",
                                        ACCENT_TEXT[s.accent],
                                    )}
                                >
                                    <span className={cn("inline-block size-1.5 rounded-full", ACCENT_DOT[s.accent])} />
                                    {s.eyebrow}
                                </p>
                                {/* h2, not h1: a slide is a promotion, not the page's
                                    subject — and three rotating h1s meant the page had
                                    no stable heading at all. The h1 lives on the page. */}
                                <h2 className="mt-3 text-balance text-3xl font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-6xl">
                                    {s.title}
                                </h2>
                                <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/90 sm:mt-4 sm:text-lg">
                                    {s.subtitle}
                                </p>
                                <div className="mt-6 flex w-full max-w-md flex-col gap-3 sm:mt-7 sm:flex-row sm:flex-wrap sm:items-center">
                                    <Button
                                        asChild
                                        size="lg"
                                        className="h-12 w-full touch-manipulation rounded-full px-7 shadow-lg sm:h-11 sm:w-auto"
                                    >
                                        <Link href={s.ctaHref} className="inline-flex items-center justify-center gap-2">
                                            {s.ctaLabel}
                                            <ArrowRight className="size-4" />
                                        </Link>
                                    </Button>
                                    <Button
                                        asChild
                                        size="lg"
                                        variant="outline"
                                        className="h-12 w-full touch-manipulation rounded-full border-white/40 bg-white/10 px-6 text-white backdrop-blur hover:bg-white/20 hover:text-white sm:h-11 sm:w-auto"
                                    >
                                        <Link href="#catalog">Browse all</Link>
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}

                {total > 1 ? (
                    <>
                        <button
                            type="button"
                            onClick={prev}
                            aria-label="Previous slide"
                            className="absolute bottom-23 left-2 z-10 flex size-11 touch-manipulation items-center justify-center rounded-full border border-white/35 bg-black/45 text-white backdrop-blur-md transition active:bg-black/60 sm:bottom-auto sm:left-3 sm:top-1/2 sm:size-10 sm:-translate-y-1/2"
                        >
                            <ChevronLeft className="size-5" />
                        </button>
                        <button
                            type="button"
                            onClick={next}
                            aria-label="Next slide"
                            className="absolute bottom-23 right-2 z-10 flex size-11 touch-manipulation items-center justify-center rounded-full border border-white/35 bg-black/45 text-white backdrop-blur-md transition active:bg-black/60 sm:bottom-auto sm:right-3 sm:top-1/2 sm:size-10 sm:-translate-y-1/2"
                        >
                            <ChevronRight className="size-5" />
                        </button>

                        <div className="absolute bottom-4 left-0 right-0 z-10 flex items-center justify-center gap-1 py-2 sm:bottom-5 sm:gap-2">
                            {slides.map((s, i) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    aria-label={`Go to slide ${i + 1}`}
                                    aria-current={i === active}
                                    onClick={() => goTo(i)}
                                    className="touch-manipulation p-2"
                                >
                                    <span
                                        className={cn(
                                            "block h-1.5 rounded-full transition-all",
                                            i === active ? "w-8 bg-white" : "w-3 bg-white/45 active:bg-white/80",
                                        )}
                                    />
                                </button>
                            ))}
                        </div>
                    </>
                ) : null}
            </div>
        </section>
    );
}
