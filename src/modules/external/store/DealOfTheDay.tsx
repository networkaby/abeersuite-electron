import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Flame, ArrowRight } from "lucide-react";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { demoRating, productPath, type ShopProductPublic } from "@/shared/lib/shop/productPublic";

export default function DealOfTheDay({
    product,
    eyebrow = "Deal of the day",
    title = "Biggest savings — limited stock",
}: {
    product: ShopProductPublic | null;
    eyebrow?: string;
    title?: string;
}) {
    if (!product) return null;
    const img = product.galleryUrls[0] ?? product.imageUrl;
    const href = productPath(product);
    const { stars, reviewCount } = demoRating(product.id);
    const discountPct =
        product.mrpPaise && product.mrpPaise > product.pricePaise
            ? Math.round((1 - product.pricePaise / product.mrpPaise) * 100)
            : 0;
    const savings =
        product.mrpPaise && product.mrpPaise > product.pricePaise
            ? formatRupeesFromPaise(product.mrpPaise - product.pricePaise)
            : null;

    return (
        <section className="border-b border-border/60 bg-linear-to-br from-rose-500/5 via-background to-amber-500/5">
            <div className="mx-auto max-w-6xl px-3 py-10 sm:px-4 sm:py-12">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-600 dark:text-rose-400">
                            <Flame className="size-3.5" />
                            {eyebrow}
                        </p>
                        <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
                    </div>
                    <Link
                        href="#deals"
                        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-primary"
                    >
                        See all deals
                        <ArrowRight className="size-4" />
                    </Link>
                </div>

                <article className="mt-7 grid gap-0 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-md md:grid-cols-[1.1fr_1fr]">
                    <Link href={href} className="relative block aspect-[4/3] bg-muted md:aspect-auto md:min-h-[340px]">
                        {img ? (
                            <ShopRemoteImage
                                src={img}
                                alt={product.displayName}
                                fill
                                sizes="(max-width:768px) 100vw, 50vw"
                                className="object-cover transition-transform duration-500 hover:scale-[1.03]"
                            />
                        ) : (
                            <div className="flex size-full items-center justify-center text-muted-foreground text-sm">No image</div>
                        )}
                        {discountPct > 0 ? (
                            <Badge className="absolute left-4 top-4 rounded-full bg-rose-600 px-3 py-1 text-sm font-bold text-white shadow-md hover:bg-rose-600">
                                {discountPct}% OFF
                            </Badge>
                        ) : null}
                        {product.badge ? (
                            <Badge variant="secondary" className="absolute right-4 top-4 rounded-full shadow-sm">
                                {product.badge}
                            </Badge>
                        ) : null}
                    </Link>

                    <div className="flex flex-col gap-4 p-6 sm:p-8">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {product.category}
                        </p>
                        <Link
                            href={href}
                            className="text-2xl font-bold leading-tight tracking-tight transition-colors hover:text-primary sm:text-3xl"
                        >
                            {product.displayName}
                        </Link>

                        <div className="flex items-center gap-1 text-amber-500">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                    key={i}
                                    className={
                                        i < Math.round(stars)
                                            ? "size-4 fill-current"
                                            : "size-4 text-muted/40"
                                    }
                                />
                            ))}
                            <span className="ml-1 text-sm text-muted-foreground">
                                {stars.toFixed(1)} · {reviewCount} reviews
                            </span>
                        </div>

                        <div className="flex flex-wrap items-baseline gap-3">
                            <span className="text-3xl font-bold tabular-nums sm:text-4xl">
                                {formatRupeesFromPaise(product.pricePaise)}
                            </span>
                            {product.mrpPaise && product.mrpPaise > product.pricePaise ? (
                                <span className="text-base text-muted-foreground line-through tabular-nums">
                                    {formatRupeesFromPaise(product.mrpPaise)}
                                </span>
                            ) : null}
                            {savings ? (
                                <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400">
                                    Save {savings}
                                </Badge>
                            ) : null}
                        </div>

                        <p className="text-sm text-muted-foreground">
                            Limited time · Free shipping on this product · Razorpay secured.
                        </p>

                        <div className="mt-2 flex w-full flex-col gap-3 sm:mt-2 sm:w-auto sm:flex-row sm:flex-wrap">
                            <Button size="lg" asChild className="h-12 w-full touch-manipulation rounded-full px-7 shadow-md sm:h-11 sm:w-auto">
                                <Link href={href}>Buy now</Link>
                            </Button>
                            <Button size="lg" variant="outline" asChild className="h-12 w-full touch-manipulation rounded-full px-6 sm:h-11 sm:w-auto">
                                <Link href={href}>View details</Link>
                            </Button>
                        </div>
                    </div>
                </article>
            </div>
        </section>
    );
}
