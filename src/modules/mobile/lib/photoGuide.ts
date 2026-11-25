import type { ShopStatus } from "@/generated/prisma/enums";
import { readShopDraft, rowProblems, splitAttention } from "@/modules/ecommerce/lib/productAdmin";

/**
 * What the phone photo screen shows above the photos (owner, 2026-11-25): the
 * shop stage, why it is parked in Attention, and the AI / staff notes — photo
 * notes first — so staff know which photo to shoot.
 */
export type PhotoGuide = {
    stage: ShopStatus;
    attention?: { lines: string[]; by: string | null; at: string | null };
    /** Notes about photos — the "Shoot these" list. */
    shoot: string[];
    /** Every other open note. */
    other: string[];
};

const PHOTO_WORDS = /\b(photo|photos|picture|image|shoot|label|sticker|mrp|box|pack|packing|close-?up|back side|front|side view|blurry|blurred|background)\b/i;

type Row = { shopStatus: ShopStatus; shopAttention: string | null; shopAttentionBy: string | null; shopAttentionAt: Date | null; shopDraftJson: unknown };
export const photoGuideSelect = { shopStatus: true, shopAttention: true, shopAttentionBy: true, shopAttentionAt: true, shopDraftJson: true } as const;

export function photoGuide(p: Row): PhotoGuide {
    const info = readShopDraft(p.shopDraftJson);
    const ai = info?.aiCopy;
    const notes = [
        ...rowProblems(info, p.shopAttention).filter((r) => !r.aside).map((r) => r.text),
        ...(ai?.flags ?? []), ...(ai?.notes ?? []), ...(ai?.unsure ?? []), ...(info?.notes ?? []),
    ].map((t) => t.trim()).filter(Boolean);
    const all = [...new Set(notes)];
    const attention = p.shopStatus === "ATTENTION" || p.shopAttention
        ? { lines: splitAttention(p.shopAttention).rest, by: p.shopAttentionBy, at: p.shopAttentionAt?.toISOString() ?? null }
        : undefined;
    return {
        stage: p.shopStatus,
        ...(attention && { attention }),
        shoot: all.filter((t) => PHOTO_WORDS.test(t)),
        other: all.filter((t) => !PHOTO_WORDS.test(t)),
    };
}
