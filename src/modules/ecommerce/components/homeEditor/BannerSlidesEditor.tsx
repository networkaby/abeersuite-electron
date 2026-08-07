"use client";

import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ShopImageField from "@/modules/ecommerce/components/ShopImageField";
import { newBannerSlide, type BannerSlide, type HomeSectionContent } from "@/shared/lib/shop/homeLayout";

const ACCENT_OPTIONS = [
    { value: "primary", label: "Primary (blue)" },
    { value: "violet", label: "Violet" },
    { value: "emerald", label: "Emerald" },
    { value: "amber", label: "Amber" },
] as const;

const HEIGHT_OPTIONS = [
    { value: "sm", label: "Small" },
    { value: "md", label: "Medium" },
    { value: "lg", label: "Large" },
] as const;

const COLUMN_OPTIONS = [
    { value: "1", label: "1 across (full width)" },
    { value: "2", label: "2 across" },
    { value: "3", label: "3 across" },
] as const;

/**
 * The slide list for one `banner`-kind section — hero slides, or the banners
 * of a promo strip.
 *
 * The section owns this list, so it is self-complete: a hero carousel is one
 * hero section with several slides, never several hero sections grouped at
 * render time. Each slide carries its OWN display period, so a festive slide
 * rotates out on its end date while its siblings keep showing; the section's
 * own Section No. / Priority / dates (edited above this) still govern whether
 * the section renders at all.
 */
export default function BannerSlidesEditor({
    content,
    onChange,
    isHero,
}: {
    content: HomeSectionContent;
    onChange: (next: HomeSectionContent) => void;
    /** Hero uses accent + a carousel; promo strips use height + a columns grid. */
    isHero: boolean;
}) {
    const slides = content.slides ?? [];

    const setSlides = (next: BannerSlide[]) => onChange({ ...content, slides: next });
    const update = (i: number, patch: Partial<BannerSlide>) =>
        setSlides(slides.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    const remove = (i: number) => setSlides(slides.filter((_, idx) => idx !== i));
    const move = (i: number, dir: -1 | 1) => {
        const target = i + dir;
        if (target < 0 || target >= slides.length) return;
        const next = [...slides];
        [next[i], next[target]] = [next[target], next[i]];
        setSlides(next);
    };

    return (
        <div className="space-y-3">
            {!isHero ? (
                <div className="grid gap-1 sm:w-56">
                    <Label className="text-xs font-normal">Banners across</Label>
                    <Select
                        value={String(content.columns ?? 1)}
                        onValueChange={(v) => onChange({ ...content, columns: Number(v) as 1 | 2 | 3 })}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {COLUMN_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            ) : null}

            {slides.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                    No {isHero ? "slides" : "banners"} yet — this section won't show on the storefront.
                </p>
            ) : null}

            {slides.map((slide, i) => (
                <div key={slide.id} className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                            {isHero ? "Slide" : "Banner"} {i + 1}
                            {slides.length > 1 && isHero ? ` of ${slides.length}` : ""}
                        </span>
                        <div className="flex items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                disabled={i === 0}
                                onClick={() => move(i, -1)}
                                aria-label={`Move ${isHero ? "slide" : "banner"} ${i + 1} up`}
                            >
                                <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                disabled={i === slides.length - 1}
                                onClick={() => move(i, 1)}
                                aria-label={`Move ${isHero ? "slide" : "banner"} ${i + 1} down`}
                            >
                                <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6 text-destructive"
                                onClick={() => remove(i)}
                                aria-label={`Remove ${isHero ? "slide" : "banner"} ${i + 1}`}
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-1">
                            <Label className="text-xs font-normal">Eyebrow</Label>
                            <Input
                                value={slide.eyebrow ?? ""}
                                onChange={(e) => update(i, { eyebrow: e.target.value })}
                                placeholder="Limited time"
                            />
                        </div>
                        <div className="grid gap-1">
                            <Label className="text-xs font-normal">Title</Label>
                            <Input
                                value={slide.title}
                                onChange={(e) => update(i, { title: e.target.value })}
                                placeholder="Up to 30% off Laptops"
                            />
                        </div>
                    </div>

                    <div className="grid gap-1">
                        <Label className="text-xs font-normal">Subtitle</Label>
                        <Input value={slide.subtitle ?? ""} onChange={(e) => update(i, { subtitle: e.target.value })} />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                        <ShopImageField
                            label="Image"
                            value={slide.imageUrl || null}
                            onChange={(url) => update(i, { imageUrl: url ?? "" })}
                            folder={isHero ? "shop/home/hero" : "shop/home/banners"}
                        />
                        <div className="grid gap-1">
                            <Label className="text-xs font-normal">Image alt text</Label>
                            <Input value={slide.imageAlt ?? ""} onChange={(e) => update(i, { imageAlt: e.target.value })} />
                        </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-1">
                            <Label className="text-xs font-normal">Button text</Label>
                            <Input
                                value={slide.ctaLabel ?? ""}
                                onChange={(e) => update(i, { ctaLabel: e.target.value })}
                                placeholder="Shop now"
                            />
                        </div>
                        <div className="grid gap-1">
                            <Label className="text-xs font-normal">Button link</Label>
                            <Input
                                value={slide.ctaHref ?? ""}
                                onChange={(e) => update(i, { ctaHref: e.target.value })}
                                placeholder="#catalog"
                            />
                        </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                        {isHero ? (
                            <div className="grid gap-1">
                                <Label className="text-xs font-normal">Accent colour</Label>
                                <Select
                                    value={slide.accent ?? "primary"}
                                    onValueChange={(v) => update(i, { accent: v as BannerSlide["accent"] })}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ACCENT_OPTIONS.map((o) => (
                                            <SelectItem key={o.value} value={o.value}>
                                                {o.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : (
                            <div className="grid gap-1">
                                <Label className="text-xs font-normal">Card height</Label>
                                <Select
                                    value={slide.height ?? "md"}
                                    onValueChange={(v) => update(i, { height: v as BannerSlide["height"] })}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {HEIGHT_OPTIONS.map((o) => (
                                            <SelectItem key={o.value} value={o.value}>
                                                {o.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="grid gap-1">
                            <Label className="text-xs font-normal">Show from</Label>
                            <Input
                                type="date"
                                value={slide.startAt ?? ""}
                                onChange={(e) => update(i, { startAt: e.target.value || undefined })}
                            />
                        </div>
                        <div className="grid gap-1">
                            <Label className="text-xs font-normal">Show until</Label>
                            <Input
                                type="date"
                                value={slide.endAt ?? ""}
                                onChange={(e) => update(i, { endAt: e.target.value || undefined })}
                            />
                        </div>
                    </div>
                </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={() => setSlides([...slides, newBannerSlide()])}>
                <Plus className="mr-1.5 size-3.5" /> Add {isHero ? "slide" : "banner"}
            </Button>
        </div>
    );
}
