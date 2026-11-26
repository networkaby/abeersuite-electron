import type { ShopStatus } from "@/generated/prisma/enums";
import { attentionInfo, draftOf, problemText } from "@/modules/ecommerce/lib/productAdmin";

/**
 * What the phone photo screen shows above the photos (owner, 2026-11-25): the
 * shop stage, a short Attention line, and the open problems split into photo jobs
 * and the rest (owner, 2026-11-26) — numbered and coloured like the computer's
 * "Open problems" list, so "problem 3" is the same problem on both screens.
 */
export type GuideNote = { no: number; text: string; level: "stop" | "fix" | "tip" | "staff" };
export type PhotoGuide = {
    stage: ShopStatus;
    /** Who parked it and when, plus any reason a person wrote. The run's small print stays on the computer. */
    attention?: { lines: string[]; by: string | null; at: string | null };
    /** Photo jobs — the "Shoot these" list. */
    shoot: GuideNote[];
    /** Everything else — typed on the computer. */
    other: GuideNote[];
};

/**
 * A photo job names the photo itself. Words like "box" or "label" are not enough:
 * "Model No is empty — box back ticks MSD 001" is typing, not shooting.
 */
const PHOTO_JOB = /\b(photos?|pictures?|images?|shoot|reshoot|re-shoot|close-?up)\b/i;
/** Part runs' small print: of no use on the phone. */
const SMALL_PRINT = /^(Last run: |Was .* before this check)/;

type Row = { shopStatus: ShopStatus; shopAttention: string | null; shopAttentionBy: string | null; shopAttentionAt: Date | null; shopDraftJson: unknown };
export const photoGuideSelect = { shopStatus: true, shopAttention: true, shopAttentionBy: true, shopAttentionAt: true, shopDraftJson: true } as const;

export function photoGuide(p: Row): PhotoGuide {
    // Same list, same order as the computer (AiNotesBox); a temporary pass keeps its number but is not shown.
    const notes: GuideNote[] = (draftOf(p)?.problems ?? [])
        .map((x, i) => ({ x, no: i + 1 }))
        .filter(({ x }) => !x.asideAt)
        .map(({ x, no }) => ({ no, text: x.source === "staff" && x.by ? `${x.by}: ${x.text}` : problemText(x.text), level: x.source === "staff" ? ("staff" as const) : x.level }))
        .filter((n) => n.text);
    const attention = p.shopStatus === "ATTENTION" || p.shopAttention
        ? { lines: attentionInfo(p.shopAttention).filter((l) => !SMALL_PRINT.test(l)), by: p.shopAttentionBy, at: p.shopAttentionAt?.toISOString() ?? null }
        : undefined;
    return {
        stage: p.shopStatus,
        ...(attention && { attention }),
        shoot: notes.filter((n) => PHOTO_JOB.test(n.text)),
        other: notes.filter((n) => !PHOTO_JOB.test(n.text)),
    };
}
