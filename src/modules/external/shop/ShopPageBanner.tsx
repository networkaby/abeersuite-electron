import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import Link from "next/link";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { HERO_SLIDES } from "@/shared/lib/shop/storeContent";

type CategoryPill = { name: string; count: number };

export default function ShopPageBanner({
    productCount,
    categoryPills,
    activeQuery,
}: {
    productCount: number;
    categoryPills: CategoryPill[];
    activeQuery?: string;
}) {
    const heroImage = HERO_SLIDES[0]?.imageUrl;
    const categoryCount = categoryPills.length;
    const topPills = categoryPills.slice(0, 8);

    return (
        <section className="relative overflow-hidden border-b border-border/80 bg-linear-to-br from-primary/8 via-background to-violet-500/8">
            <div className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-16 size-64 rounded-full bg-primary/10 blur-3xl" />

            <div className="relative mx-auto max-w-6xl px-3 py-8 sm:px-4 sm:py-10 md:py-12">
                {heroImage ? (
                    <div className="relative mb-6 aspect-[21/9] w-full overflow-hidden rounded-2xl border border-border/60 bg-muted shadow-sm lg:hidden">
                        <ShopRemoteImage
                            src={heroImage}
                            alt="Electronics and IT hardware"
                            fill
                            className="object-cover"
                            sizes="100vw"
                            priority
                        />
                        <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-transparent" />
                    </div>
                ) : null}
                <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
                    <div>
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild>
                                        <Link href="/">Home</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>All products</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary sm:size-12">
                                <LayoutGrid className="size-5 sm:size-6" />
                            </span>
                            <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">
                                All products
                            </h1>
                        </div>

                        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-lg">
                            Browse the full {COMPANY_DETAILS.brandName} catalog in {COMPANY_DETAILS.currencySymbol} — filter
                            by category, search by name, and open every product for full specs.{" "}
                            <span className="text-foreground font-medium tabular-nums">
                                {productCount} product{productCount === 1 ? "" : "s"}
                            </span>{" "}
                            across{" "}
                            <span className="text-foreground font-medium tabular-nums">
                                {categoryCount} categor{categoryCount === 1 ? "y" : "ies"}
                            </span>
                            {activeQuery ? (
                                <>
                                    {" "}
                                    · results for <span className="text-foreground font-medium">&ldquo;{activeQuery}&rdquo;</span>
                                </>
                            ) : null}
                            .
                        </p>

                        {topPills.length > 0 ? (
                            <div className="mt-6">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                    Jump to category
                                </p>
                                <ul className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible">
                                    {topPills.map(({ name, count }) => (
                                        <li key={name} className="shrink-0 snap-start">
                                            <a
                                                href={`#cat-${encodeURIComponent(name)}`}
                                                className="inline-flex touch-manipulation items-center gap-1.5 rounded-full border border-border/80 bg-background/80 px-3 py-2 text-sm font-medium shadow-sm transition active:bg-muted hover:border-primary/50 hover:text-primary"
                                            >
                                                {name}
                                                <span className="text-xs text-muted-foreground tabular-nums">({count})</span>
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                            <Button
                                variant="outline"
                                size="lg"
                                className="h-12 w-full touch-manipulation rounded-full gap-2 sm:h-10 sm:w-auto"
                                asChild
                            >
                                <Link href="/">
                                    <ArrowLeft className="size-4" />
                                    Home &amp; deals
                                </Link>
                            </Button>
                            <a
                                href="#catalog"
                                className="min-h-11 text-center text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-0 sm:text-left"
                            >
                                Go to filters
                            </a>
                        </div>
                    </div>

                    {heroImage ? (
                        <div className="relative hidden min-h-[200px] overflow-hidden rounded-2xl border border-border/60 bg-muted shadow-lg lg:block">
                            <ShopRemoteImage
                                src={heroImage}
                                alt="Electronics and IT hardware"
                                fill
                                className="object-cover"
                                sizes="(min-width: 1024px) 40vw, 0"
                                priority
                            />
                            <div className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent" />
                            <p className="absolute bottom-4 left-4 right-4 text-sm font-medium text-white drop-shadow">
                                {COMPANY_DETAILS.tagline}
                            </p>
                        </div>
                    ) : null}
                </div>
            </div>
        </section>
    );
}
