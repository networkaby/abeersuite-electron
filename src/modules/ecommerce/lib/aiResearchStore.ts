import "server-only";
import { z } from "zod";
import { AI_RESEARCH_STORE } from "@/shared/lib/constants/ai";
import { R2_MESSAGES_BUCKET } from "@/shared/lib/constants/whatsapp";
import { getR2Text, isR2Configured, putR2 } from "@/shared/lib/storage/r2";

// What a Verified run found (steps 1–2) kept outside the DB, so "Photos only"
// can run step 5 later without paying for the Check call or searching again
// (owner, 2026-10-25). Temporary and cheap on purpose: one file per product in
// R2, each run overwrites it, anything old or for another name is ignored, and
// it may be deleted any time — a miss just means the research runs again.

const researchSchema = z.object({
    at: z.number(),
    /** The name the search was made for — a renamed product searches again. */
    name: z.string(),
    /** Web photos from the pages the run read, best first. */
    web: z.array(z.object({ url: z.string(), site: z.string() })),
});
export type AiResearch = z.infer<typeof researchSchema>;

const keyFor = (productId: number) => `${AI_RESEARCH_STORE.prefix}${productId}.json`;

/** The saved research for this product and name, or null (none, too old, renamed, R2 off or failing). */
export async function loadResearch(productId: number, name: string): Promise<AiResearch | null> {
    if (!isR2Configured()) return null;
    try {
        const raw = await getR2Text(R2_MESSAGES_BUCKET, keyFor(productId));
        if (!raw) return null;
        const r = researchSchema.parse(JSON.parse(raw));
        const fresh = Date.now() - r.at < AI_RESEARCH_STORE.maxAgeDays * 86_400_000;
        return fresh && r.name.trim() === name.trim() ? r : null;
    } catch (e) {
        console.warn("[aiResearchStore] read failed", e);
        return null;
    }
}

/** Save quietly — a failed save never fails the AI run. */
export async function saveResearch(productId: number, r: Omit<AiResearch, "at">): Promise<void> {
    if (!isR2Configured()) return;
    try {
        const body = new TextEncoder().encode(JSON.stringify({ ...r, at: Date.now() }));
        await putR2(R2_MESSAGES_BUCKET, keyFor(productId), body.buffer as ArrayBuffer, "application/json");
    } catch (e) {
        console.warn("[aiResearchStore] save failed", e);
    }
}
