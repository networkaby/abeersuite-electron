"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api";
import { fetchAiCopy, type ProductCopy } from "@/modules/ecommerce/lib/aiCopyClient";
import { FlowButtons, PremiumSwitch, useCopyFlow, usePhotoAiOn, usePremiumAi } from "@/modules/ecommerce/components/AiCopyControls";
import { AiPhotoPicker } from "@/modules/ecommerce/components/AiPhotoPicker";
import type { PhotoChecklist, PhotoKind } from "@/modules/ecommerce/lib/photoChecklist";

type SpecRow = { k: string; v: string };

/** How the draft was made, what looks wrong in our own data, and what staff should check before saving. */
export function AiDraftNotes({ draft }: { draft: ProductCopy }) {
    const sourced = Object.entries(draft.specSources ?? {});
    return (
        <>
            <p className="text-muted-foreground text-xs">{draft.note}</p>
            {draft.flags.length > 0 && <DataFlags flags={draft.flags} />}
            {sourced.length > 0 && (
                <p className="text-muted-foreground text-xs">
                    Spec sources: {sourced.map(([k, v]) => `${k} — ${v}`).join(" · ")}
                </p>
            )}
            {draft.unsure.length > 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-400">
                    <p className="font-medium">Please check / add by hand:</p>
                    <ul className="ml-4 list-disc">
                        {draft.unsure.map((u) => <li key={u}>{u}</li>)}
                    </ul>
                </div>
            )}
        </>
    );
}

/** Our own product data looks wrong — staff fix the product, the AI never does. */
export function DataFlags({ flags, title = "Your product data may be wrong:" }: { flags: string[]; title?: string }) {
    return (
        <div className="text-destructive text-xs">
            <p className="font-medium">{title}</p>
            <ul className="ml-4 list-disc">
                {flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
        </div>
    );
}

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
    imageUrls,
    description,
    subheading,
    specPairs,
    onDescription,
    onSubheading,
    onSpecs,
    photoChecklist,
    onPhotoChecklist,
    onAddPhotos,
}: {
    productId?: number;
    name: string;
    /** Whole gallery, skip marks included — the server leaves the skipped ones out. */
    imageUrls: string[];
    description: string;
    subheading: string;
    specPairs: SpecRow[];
    onDescription: (v: string) => void;
    onSubheading: (v: string) => void;
    onSpecs: (rows: SpecRow[]) => void;
    /** Saved checklist under Product image — the AI's newer one replaces it. */
    photoChecklist: PhotoChecklist | null;
    onPhotoChecklist: (c: PhotoChecklist) => void;
    /** Picked web photos, already copied to our storage, with the kinds they fill. */
    onAddPhotos: (urls: string[], kinds: PhotoKind[]) => void;
}) {
    const [flow, setFlow] = useCopyFlow();
    const [premium, setPremium] = usePremiumAi();
    const photoAi = usePhotoAiOn();
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState<ProductCopy | null>(null);
    // Verified stopped at the photo check: our own data disagrees with itself.
    const [checkFlags, setCheckFlags] = useState<string[] | null>(null);

    const run = async (fresh: boolean) => {
        if (!productId) { toast.error("Save the product first, then generate"); return; }
        if (!name.trim()) { toast.error("Name is required"); return; }
        setBusy(true);
        setCheckFlags(null);
        try {
            const copy = await fetchAiCopy({ productId, name: name.trim(), imageUrls, flow, premium, photoAi }, { fresh });
            setDraft(copy);
            // A cached draft carries the advice of its own run — the saved ticks since then win.
            if (copy.photoChecklist && !copy.fromCache) onPhotoChecklist(copy.photoChecklist);
            const filled: string[] = [];
            if (!description.trim()) { onDescription(copy.shopDescription); filled.push("description"); }
            if (!subheading.trim() || subheading.trim() === name.trim()) { onSubheading(copy.title); filled.push("online name"); }
            const merged = mergeAiSpecs(specPairs, copy.specs);
            if (merged.filter((r) => r.k.trim()).length > specPairs.filter((r) => r.k.trim()).length) {
                onSpecs(merged);
                filled.push("specs");
            }
            toast.success(filled.length ? `AI filled ${filled.join(", ")} — review, then Save` : "AI draft ready — use what you like, then Save");
        } catch (e) {
            const flags = axios.isAxiosError(e) && e.response?.status === 422 ? (e.response.data as { flags?: string[] }).flags : undefined;
            if (flags?.length) setCheckFlags(flags);
            else toast.error(extractApiError(e, "AI could not write this product"));
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
                <PremiumSwitch value={premium} onChange={setPremium} disabled={busy} />
                <FlowButtons value={flow} onChange={setFlow} disabled={busy} />
            </div>
            {flow === "verified" && (
                <p className="text-muted-foreground text-xs">
                    Photo AI: {photoAi ? "on — photo checklist and labelled suggestions" : "off — photos suggested without labels (AI Setup → Verified)"}
                </p>
            )}
            {checkFlags && <DataFlags flags={checkFlags} title="Not written — fix this product's data first:" />}
            {draft && (
                <div className="space-y-2 text-sm">
                    <AiDraftNotes draft={draft} />
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
                    {draft.photoSuggestions && (
                        <AiPhotoPicker suggestions={draft.photoSuggestions} checklist={photoChecklist} onAdd={onAddPhotos} />
                    )}
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
