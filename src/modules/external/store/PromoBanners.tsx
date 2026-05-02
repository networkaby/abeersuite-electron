import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PromoBanner } from "@/lib/shop/store-content";

const HEIGHT_CLASS: Record<NonNullable<PromoBanner["height"]>, string> = {
    sm: "aspect-[5/3] sm:aspect-[16/9]",
    md: "aspect-[4/3] sm:aspect-[16/8]",
    lg: "aspect-[4/3] sm:aspect-[16/7]",
};

export default function PromoBanners({
    banners,
    columns = 2,
    className,
}: {
    banners: PromoBanner[];
    columns?: 2 | 3;
    className?: string;
}) {
    if (banners.length === 0) return null;

    const gridCls =
        columns === 3
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            : "grid gap-4 sm:grid-cols-2";

    return (
        <section className={cn("border-b border-border/60 bg-muted/20", className)}>
            <div className="mx-auto max-w-6xl px-4 py-10">
                <ul className={gridCls}>
                    {banners.map((b) => (
                        <li key={b.id}>
                            <Link
                                href={b.ctaHref}
                                className="group relative block overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
                            >
                                <div className={cn("relative w-full bg-muted", HEIGHT_CLASS[b.height ?? "md"])}>
                                    <Image
                                        src={b.imageUrl}
                                        alt={b.imageAlt}
                                        fill
                                        sizes={columns === 3 ? "(max-width:1024px) 100vw, 33vw" : "(max-width:640px) 100vw, 50vw"}
                                        className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                                    />
                                    <div className="absolute inset-0 bg-linear-to-r from-black/75 via-black/35 to-transparent" />
                                    <div className="absolute inset-0 flex flex-col justify-center gap-2 p-6 text-white sm:p-8">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85">
                                            {b.eyebrow}
                                        </p>
                                        <h3 className="max-w-[14rem] text-2xl font-bold leading-tight sm:text-3xl">
                                            {b.title}
                                        </h3>
                                        {b.subtitle ? (
                                            <p className="max-w-[18rem] text-sm text-white/85 sm:text-base">{b.subtitle}</p>
                                        ) : null}
                                        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold text-white backdrop-blur transition group-hover:bg-white/35">
                                            {b.ctaLabel}
                                            <ArrowRight className="size-4" />
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
