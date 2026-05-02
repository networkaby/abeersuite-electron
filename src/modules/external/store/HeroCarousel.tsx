"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HeroSlide } from "@/lib/shop/store-content";

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

    if (total === 0) return null;

    return (
        <section
            className="relative isolate overflow-hidden border-b border-border/80 bg-black"
            aria-roledescription="carousel"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
        >
            <div className="relative h-[420px] sm:h-[480px] lg:h-[520px]">
                {slides.map((s, i) => (
                    <div
                        key={s.id}
                        className={cn(
                            "absolute inset-0 transition-opacity duration-700 ease-out",
                            i === active ? "opacity-100" : "pointer-events-none opacity-0",
                        )}
                        aria-hidden={i !== active}
                    >
                        <Image
                            src={s.imageUrl}
                            alt={s.imageAlt}
                            fill
                            priority={i === 0}
                            sizes="100vw"
                            className="object-cover"
                        />
                        <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/40 to-transparent" />
                        <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />
                        <div className="relative mx-auto flex h-full max-w-6xl items-center px-4 sm:px-6">
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
                                <h1 className="mt-3 text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                                    {s.title}
                                </h1>
                                <p className="mt-4 max-w-lg text-base leading-relaxed text-white/85 sm:text-lg">
                                    {s.subtitle}
                                </p>
                                <div className="mt-7 flex flex-wrap items-center gap-3">
                                    <Button
                                        asChild
                                        size="lg"
                                        className="rounded-full px-7 shadow-lg"
                                    >
                                        <Link href={s.ctaHref} className="inline-flex items-center gap-2">
                                            {s.ctaLabel}
                                            <ArrowRight className="size-4" />
                                        </Link>
                                    </Button>
                                    <Button
                                        asChild
                                        size="lg"
                                        variant="outline"
                                        className="rounded-full border-white/40 bg-white/10 px-6 text-white backdrop-blur hover:bg-white/20 hover:text-white"
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
                            className="absolute left-3 top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/30 text-white backdrop-blur-md transition hover:bg-black/50 sm:flex"
                        >
                            <ChevronLeft className="size-5" />
                        </button>
                        <button
                            type="button"
                            onClick={next}
                            aria-label="Next slide"
                            className="absolute right-3 top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/30 text-white backdrop-blur-md transition hover:bg-black/50 sm:flex"
                        >
                            <ChevronRight className="size-5" />
                        </button>

                        <div className="absolute bottom-5 left-0 right-0 z-10 flex items-center justify-center gap-2">
                            {slides.map((s, i) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    aria-label={`Go to slide ${i + 1}`}
                                    aria-current={i === active}
                                    onClick={() => goTo(i)}
                                    className={cn(
                                        "h-1.5 rounded-full transition-all",
                                        i === active
                                            ? "w-8 bg-white"
                                            : "w-3 bg-white/40 hover:bg-white/70",
                                    )}
                                />
                            ))}
                        </div>
                    </>
                ) : null}
            </div>
        </section>
    );
}
