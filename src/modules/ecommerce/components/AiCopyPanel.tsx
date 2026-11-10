"use client";

import { useState } from "react";
import { useValueChange } from "@/shared/hooks/useValueChange";
import axios from "axios";
import { toast } from "sonner";
import { ExternalLink, Images, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api";
import { fetchAiCopy, fetchAiPhotos, type PhotoAdvice, type ProductCopy } from "@/modules/ecommerce/lib/aiCopyClient";
import { FlowButtons, PhotoAiSwitch, PremiumSwitch, useCopyFlow, usePhotoAi, usePremiumAi } from "@/modules/ecommerce/components/AiCopyControls";
import { AiPhotoArrange, AiPhotoPicker } from "@/modules/ecommerce/components/AiPhotoPicker";
import type { PhotoChecklist, PhotoKind } from "@/modules/ecommerce/lib/photoChecklist";

type SpecRow = { k: string; v: string };

/** How the draft was made, what looks wrong in our own data, and what staff should check before saving. */
export function AiDraftNotes({ draft }: { draft: ProductCopy }) {
    const sourced = Object.entries(draft.specSources ?? {});
    return (
        <>
            <p className="text-muted-foreground text-xs">{draft.note}</p>
            {draft.flags.length > 0 && <DataFlags flags={draft.flags} />}
            {(draft.notes?.length ?? 0) > 0 && (
                <div className="text-xs text-sky-800 dark:text-sky-300">
                    <p className="font-medium">Notes for you:</p>
                    <ul className="ml-4 list-disc">
                        {draft.notes!.map((n) => <li key={n}>{n}</li>)}
                    </ul>
                </div>
            )}
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
    savedDraft,
    onDiscardSaved,
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
    onParked,
    onGallery,
}: {
    /** Claude's (Cowork) copy, already written onto the product — shown for its notes and photo advice. */
    savedDraft?: ProductCopy | null;
    onDiscardSaved?: () => void;
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
    /** The server parked the product in Attention on a clash — reload the row. */
    onParked?: () => void;
    /** Photo AI's order / look, applied to the gallery. */
    onGallery: (next: (g: string[]) => string[]) => void;
}) {
    const [flow, setFlow] = useCopyFlow();
    const [premium, setPremium] = usePremiumAi();
    const [photoAi, setPhotoAi] = usePhotoAi();
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState<ProductCopy | null>(savedDraft ?? null);
    // Showing Claude's saved draft (not one generated here). A draft arriving with a
    // later load shows the same way; one cleared by Save / Discard goes away.
    const [fromSaved, setFromSaved] = useState(!!savedDraft);
    if (useValueChange(savedDraft ?? null)) {
        if (savedDraft) { setDraft(savedDraft); setFromSaved(true); }
        else if (fromSaved) { setDraft(null); setFromSaved(false); }
    }
    // Verified stopped at the photo check: our own data disagrees with itself.
    const [checkFlags, setCheckFlags] = useState<string[] | null>(null);
    // The server parked the product in Attention on that clash (same as Claude's).
    const [parked, setParked] = useState(false);
    const onClash = (e: unknown): boolean => {
        if (!axios.isAxiosError(e) || e.response?.status !== 422) return false;
        const body = e.response.data as { flags?: string[]; parked?: boolean };
        if (!body.flags?.length) return false;
        setCheckFlags(body.flags);
        setParked(!!body.parked);
        if (body.parked) { toast.info("Parked in Attention — check the real unit, then Save as draft or Save as ready"); onParked?.(); }
        return true;
    };
    // "Photos only" answer — newer than the draft's own photo advice.
    const [photoRun, setPhotoRun] = useState<PhotoAdvice | null>(null);

    const run = async (fresh: boolean) => {
        if (!productId) { toast.error("Save the product first, then generate"); return; }
        if (!name.trim()) { toast.error("Name is required"); return; }
        setBusy(true);
        setCheckFlags(null);
        try {
            const copy = await fetchAiCopy({ productId, name: name.trim(), imageUrls, flow, premium, photoAi }, { fresh });
            setDraft(copy);
            setFromSaved(false);
            setPhotoRun(null);
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
            if (!onClash(e)) toast.error(extractApiError(e, "AI could not write this product"));
        } finally {
            setBusy(false);
        }
    };

    const runPhotos = async () => {
        if (!productId) { toast.error("Save the product first, then generate"); return; }
        if (!name.trim()) { toast.error("Name is required"); return; }
        setBusy(true);
        setCheckFlags(null);
        try {
            const advice = await fetchAiPhotos({ productId, name: name.trim(), imageUrls, premium });
            setPhotoRun(advice);
            if (advice.photoChecklist) onPhotoChecklist(advice.photoChecklist);
            toast.success(advice.savedSearch ? "Photo advice ready — used the last search" : "Photo advice ready — searched first, saved for next time");
        } catch (e) {
            if (!onClash(e)) toast.error(extractApiError(e, "Photo AI could not answer"));
        } finally {
            setBusy(false);
        }
    };
    const photoView = photoRun ?? draft;

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
                {flow === "verified" && <PhotoAiSwitch value={photoAi} onChange={setPhotoAi} disabled={busy} />}
                {flow === "verified" && (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void runPhotos()}
                        title="One AI call on the last run's search; with none saved it searches first">
                        <Images className="size-4" />
                        Photos only
                    </Button>
                )}
                <FlowButtons value={flow} onChange={setFlow} disabled={busy} />
            </div>
            {flow === "verified" && (
                <p className="text-muted-foreground text-xs">
                    {photoAi
                        ? `Photo AI on: one extra AI call${premium ? " (paid key allowed)" : " (free keys only — skipped if none is free)"} — photo checklist, remove advice, labelled suggestions.`
                        : "Photo AI off: photos suggested without labels, no AI cost."}
                </p>
            )}
            {checkFlags && <DataFlags flags={checkFlags} title={parked ? "Not written — parked in Attention. Check the real unit:" : "Not written — fix this product's data first:"} />}
            {photoRun && !draft && (
                <div className="space-y-2 text-sm">
                    {photoRun.photoArrange && <AiPhotoArrange arrange={photoRun.photoArrange} gallery={imageUrls} onGallery={onGallery} />}
                    {photoRun.photoSuggestions && <AiPhotoPicker suggestions={photoRun.photoSuggestions} checklist={photoChecklist} onAdd={onAddPhotos} />}
                </div>
            )}
            {draft && (
                <div className="space-y-2 text-sm">
                    {fromSaved && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-violet-50 px-2 py-1.5 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
                            <span>Written onto this product by Claude (checked by the server) — the product is in Draft. Review, then Save as ready.</span>
                            {onDiscardSaved && (
                                <Button type="button" size="sm" variant="ghost" onClick={onDiscardSaved}>Discard draft</Button>
                            )}
                        </div>
                    )}
                    {fromSaved && <DraftRow label="Specs" text={Object.entries(draft.specs).map(([k, v]) => `${k}: ${v}`).join("\n")} onUse={() => onSpecs(mergeAiSpecs(specPairs, draft.specs))} />}
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
                    {photoView?.photoArrange && (
                        <AiPhotoArrange arrange={photoView.photoArrange} gallery={imageUrls} onGallery={onGallery} />
                    )}
                    {photoView?.photoSuggestions && (
                        <AiPhotoPicker suggestions={photoView.photoSuggestions} checklist={photoChecklist} onAdd={onAddPhotos} />
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
