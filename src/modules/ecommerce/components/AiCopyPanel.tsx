"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { extractApiError } from "@/shared/lib/api";
import { fetchAiCopy, useCanUseAiCopy, type ProductCopy } from "@/modules/ecommerce/lib/aiCopyClient";

type SpecRow = { k: string; v: string };

export const SEARCH_SKIPPED_NOTE = "Online search is not available on this Gemini key (free tier) — written from name and photo only. Check the specs.";

/** Fill the blanks only: an existing label keeps the value staff typed. */
export function mergeAiSpecs(rows: SpecRow[], specs: Record<string, string>): SpecRow[] {
    const kept = rows.filter((r) => r.k.trim());
    const have = new Set(kept.map((r) => r.k.trim().toLowerCase()));
    const added = Object.entries(specs)
        .filter(([k, v]) => k.trim() && v.trim() && !have.has(k.trim().toLowerCase()))
        .map(([k, v]) => ({ k, v }));
    return [...kept, ...added].length ? [...kept, ...added] : [{ k: "", v: "" }];
}

// "Generate with AI" on the product form. Auto-fill never overrides staff:
// empty Description / Online name / spec labels are filled straight away;
// anything already typed gets a preview with a Use button instead.
export default function AiCopyPanel({
    productId,
    name,
    imageUrl,
    description,
    subheading,
    specPairs,
    onDescription,
    onSubheading,
    onSpecs,
}: {
    productId?: number;
    name: string;
    imageUrl: string | null;
    description: string;
    subheading: string;
    specPairs: SpecRow[];
    onDescription: (v: string) => void;
    onSubheading: (v: string) => void;
    onSpecs: (rows: SpecRow[]) => void;
}) {
    const canUse = useCanUseAiCopy();
    const [search, setSearch] = useState(true);
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState<ProductCopy | null>(null);

    if (!canUse) return null;

    const run = async (fresh: boolean) => {
        if (!productId) { toast.error("Save the product first, then generate"); return; }
        if (!name.trim()) { toast.error("Name is required"); return; }
        setBusy(true);
        try {
            const copy = await fetchAiCopy({ productId, name: name.trim(), imageUrl, search }, { fresh });
            setDraft(copy);
            const filled: string[] = [];
            if (!description.trim()) { onDescription(copy.shopDescription); filled.push("description"); }
            if (!subheading.trim() || subheading.trim() === name.trim()) { onSubheading(copy.title); filled.push("online name"); }
            const merged = mergeAiSpecs(specPairs, copy.specs);
            if (merged.filter((r) => r.k.trim()).length > specPairs.filter((r) => r.k.trim()).length) {
                onSpecs(merged);
                filled.push("specs");
            }
            toast.success(filled.length ? `AI filled ${filled.join(", ")} — review, then Save` : "AI draft ready — use what you like, then Save");
            if (copy.searchSkipped) toast.warning(SEARCH_SKIPPED_NOTE);
        } catch (e) {
            toast.error(extractApiError(e, "AI could not write this product"));
        } finally {
            setBusy(false);
        }
    };

    const descDiffers = draft && description.trim() && description.trim() !== draft.shopDescription.trim();
    const titleDiffers = draft && subheading.trim() && subheading.trim() !== draft.title.trim();

    return (
        <div className="space-y-3 rounded-md border border-dashed border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(false)}>
                    <Sparkles className="size-4" />
                    {busy ? "Writing…" : draft ? "Generate again" : "Generate with AI"}
                </Button>
                <div className="flex items-center gap-2">
                    <Switch id="ai-search" checked={search} onCheckedChange={setSearch} />
                    <Label htmlFor="ai-search" className="text-sm">Search online for exact specs</Label>
                </div>
            </div>
            {draft && (
                <div className="space-y-2 text-sm">
                    {draft.searchSkipped && <p className="text-xs text-amber-600">{SEARCH_SKIPPED_NOTE}</p>}
                    {titleDiffers && (
                        <DraftRow label="Online name" text={draft.title} onUse={() => onSubheading(draft.title)} />
                    )}
                    {descDiffers && (
                        <DraftRow label="Description" text={draft.shopDescription} onUse={() => onDescription(draft.shopDescription)} />
                    )}
                    <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(true)}>
                            Ask AI fresh (new charge)
                        </Button>
                    </div>
                    {draft.sources.length > 0 && (
                        <div>
                            <p className="text-muted-foreground text-xs">Sources — check specs before saving:</p>
                            <ul className="mt-1 space-y-0.5">
                                {draft.sources.map((s) => (
                                    <li key={s.url}>
                                        <a href={s.url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 text-xs hover:underline">
                                            <ExternalLink className="size-3" />
                                            {s.title}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function DraftRow({ label, text, onUse }: { label: string; text: string; onUse: () => void }) {
    return (
        <div className="rounded-md bg-muted/40 p-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium">AI {label}</span>
                <Button type="button" size="sm" variant="outline" onClick={onUse}>Use</Button>
            </div>
            <p className="mt-1 whitespace-pre-line">{text}</p>
        </div>
    );
}
