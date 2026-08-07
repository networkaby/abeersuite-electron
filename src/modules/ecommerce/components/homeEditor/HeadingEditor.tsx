"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HomeSectionContent } from "@/shared/lib/shop/homeLayout";

type HeadingField = "eyebrow" | "title" | "subtitle";

/**
 * Simple eyebrow/title/subtitle fields, reused by every section whose real
 * content is data-driven (categories, rails, deal of the day, brand strip,
 * full catalogue) or not wired up yet (coupon strip, wishlist nudge, …) —
 * only the heading is ever admin-authored, the data itself comes live from
 * the catalogue (or, for the not-wired-yet types, will once they're built).
 * A blank field just means the component's own built-in default text shows.
 */
export default function HeadingEditor({
    content,
    onChange,
    fields = ["eyebrow", "title", "subtitle"],
    placeholders,
}: {
    content: HomeSectionContent;
    onChange: (next: HomeSectionContent) => void;
    fields?: HeadingField[];
    placeholders?: Partial<Record<HeadingField, string>>;
}) {
    const set = (patch: Partial<HomeSectionContent>) => onChange({ ...content, ...patch });

    return (
        <div className="space-y-2">
            {fields.includes("eyebrow") ? (
                <div className="grid gap-1">
                    <Label className="text-xs font-normal">Eyebrow</Label>
                    <Input
                        value={content.eyebrow ?? ""}
                        onChange={(e) => set({ eyebrow: e.target.value })}
                        placeholder={placeholders?.eyebrow}
                    />
                </div>
            ) : null}
            {fields.includes("title") ? (
                <div className="grid gap-1">
                    <Label className="text-xs font-normal">Title</Label>
                    <Input
                        value={content.title ?? ""}
                        onChange={(e) => set({ title: e.target.value })}
                        placeholder={placeholders?.title}
                    />
                </div>
            ) : null}
            {fields.includes("subtitle") ? (
                <div className="grid gap-1">
                    <Label className="text-xs font-normal">Subtitle</Label>
                    <Input
                        value={content.subtitle ?? ""}
                        onChange={(e) => set({ subtitle: e.target.value })}
                        placeholder={placeholders?.subtitle}
                    />
                </div>
            ) : null}
        </div>
    );
}
