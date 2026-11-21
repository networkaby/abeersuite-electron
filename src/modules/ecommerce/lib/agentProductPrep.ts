import "server-only";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { photosForAi } from "@/shared/lib/shop/photoMark";
import { AI_PHOTO_LIMITS } from "@/shared/lib/constants/ai";
import { COMPATIBLE_SPEC } from "@/shared/lib/shop/compatibility";
import { getR2Text, isR2Configured, messagesBucket, putR2 } from "@/shared/lib/storage/r2";
import type { ProductCopy } from "@/modules/ecommerce/lib/aiProductCopy";
import { aiRuns, nextStep, noteItems, readShopDraft, trimRuns, withClosed, type PrepProblem, type PrepRun, type ShopDraft } from "@/modules/ecommerce/lib/productAdmin";
import type { ShopStatus } from "@/generated/prisma/enums";
import { updateShopProduct, type ShopProductPatch } from "@/modules/ecommerce/lib/updateShopProduct";
import { startAi } from "@/modules/ecommerce/lib/shopWaiting";
import { parkInAttention } from "@/modules/ecommerce/lib/shopAttention";
import { arrangeFrom, checkWrittenCopy, writtenCopySchema } from "@/modules/ecommerce/lib/aiVerifiedCopy";
import { readGivenPages, type PageRead, type PageSearch } from "@/modules/ecommerce/lib/aiPageReader";
import { checkFact, cmOf, gramsOf, normForCheck } from "@/modules/ecommerce/lib/aiFactCheck";
import { BOX_TYPES, BOX_TYPE_KEYS, PHOTO_KINDS, PHOTO_REMOVE_REASONS, isEnough, isPhotoKind, missingMust, photoFloor, photoKindLabel, readPhotoChecklist, type BoxType, type PhotoChecklist, type PhotoChecklistItem, type PhotoKind, type PhotoRemoval, type PhotoRemoveReason, type PhotoSuggestion } from "@/modules/ecommerce/lib/photoChecklist";
import { cloudinarySignature } from "@/shared/lib/cloudinary";
import { isCloudinaryUrl } from "@/shared/lib/cloudinaryImage";
import { regenerateProductNamesSafe } from "@/modules/inventory/lib/regenerateNames";
import { AgentCopyError, pickableMasters, productForAgent, specsOf } from "@/modules/ecommerce/lib/agentProductCopy";

/**
 * Product prep — Claude's four-part loop (owner, 2026-11-16), separate from
 * product-copy (agentProductCopy.ts, untouched) and from our own Gemini AI.
 *
 *   Part 1 Prepare seed  — remove wrong data only; enough to search? fail → Attention
 *   Part 2 Search        — ONE search per product lifecycle; the read pages are SAVED
 *   Part 3 Process       — from the saved pages only: copy, brand, collections, shipping, photos → Draft
 *   Part 4 Verify        — no internet; ready, or Attention with only what is pending
 *
 * Only a MAJOR problem (one that would spoil the next part) stops a part.
 * The saved search lives in the private R2 bucket at ai-prep/<id>.json — no
 * schema change (owner chose this over a table). It is tied to the identity it
 * was searched for (brand + model + barcodes): when staff change those, the
 * saved search no longer counts and one new search is allowed.
 * Skills: .claude/skills/product-prep, .claude/skills/product-recheck.
 */

const galleryOf = (p: { galleryJson: unknown; imageUrl: string | null }) => productGalleryUrls(p.galleryJson as never, p.imageUrl);
const keyOf = (id: number) => `ai-prep/${id}.json`;
/**
 * One "Last run" line per product (owner, 2026-11-17): which part ran, when (India
 * time) and what came of it — staff and the owner decide from it whether to run
 * again. A new run replaces the old line.
 */
const LAST_RUN = /^Last run: /;
const lastRun = (part: number, result: string) =>
    `Last run: Part ${part} · ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} · ${result}`;
const isRunLine = (n: string) => /^Part \d done/.test(n) || LAST_RUN.test(n);

// ── Where a part leaves the product (owner, 2026-11-19) ───────────────────────
//
//   Part 1   ok → stays where it is · problem → Attention ("fix, then Start AI")
//   Part 2   ok or nothing found → stays · technical failure → Attention
//   Part 3   done → Draft · anything only staff can do → Attention
//   Part 4   verified → Ready · any problem → Attention
//   Part 5   photos (with Part 1) done → Draft · anything only staff can do → Attention
//
// A success's stage can be overridden per run (`then`) — the owner's instruction
// wins over the skill. Anything a human must do always goes to Attention, from any
// stage, Published too. Part 4 → Ready, never straight to Published, until the AI
// has earned that trust (owner, 2026-11-19).

export const THEN_STAGES = ["same", "waiting", "draft", "ready", "attention"] as const;
type Then = (typeof THEN_STAGES)[number];
const thenSchema = z.enum(THEN_STAGES).optional();
/** Where a successful part left the product, for its Last run line ("same" = where it was, Published too). */
const THEN_WORDS: Record<Then, string> = { same: "stage kept", waiting: "Waiting", draft: "Draft", ready: "Ready", attention: "Attention" };
/** What staff do after fixing, written at the end of every Attention reason. */
const AFTER_FIX = {
    start: "Fix it, then press Start AI — it goes back to Waiting and runs from Part 1.",
    recheck: "Fix it, then run Part 4 (product-recheck).",
} as const;
/** "PENDING (Part 4) — x" → "x": one open problem, whichever part wrote it. */
const OPEN_LINE = /^(PENDING|STOPPED|NOTE) \(Part \d\) — /;
const openText = (l: string) => l.trim().replace(OPEN_LINE, "").trim();
const MAIN_NOT_CLEAN = "main photo is not a clean product photo";
/**
 * One problem, however a part worded its tag or spacing — set-aside and repeats match on this.
 * The main-photo line carries the AI's reason in brackets, worded afresh each run, so it
 * matches on its fixed part: a temporary pass on it holds until a clean main photo is added.
 */
export const problemKey = (l: string) => {
    const k = openText(l).toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
    return k.startsWith(MAIN_NOT_CLEAN) ? MAIN_NOT_CLEAN : k;
};

/** The problems staff set aside ("can't fix now"): a part never raises them again, so they never block. */
async function asideKeys(id: number): Promise<Set<string>> {
    const r = await prisma.invProduct.findUnique({ where: { id }, select: { shopDraftJson: true } });
    return new Set((readShopDraft(r?.shopDraftJson)?.problems ?? []).filter((p) => p.asideAt).map((p) => problemKey(p.text)));
}
const notAside = (aside: Set<string>) => (l: string) => !aside.has(problemKey(l));

/**
 * One problem once (owner, 2026-11-20): the server's own photo lines ("Must photo
 * missing: Box back") already say which photos are missing, so the AI's own
 * wording of the same gap ("box front and back photos are missing") is dropped.
 */
const PHOTO_GAP = /\bphotos?\b[^.]*\bmissing\b|\bmissing\b[^.]*\bphotos?\b/i;
const notPhotoRestatement = (serverLines: string[]) => {
    const covered = serverLines.some((l) => /^Must photo missing/.test(openText(l)));
    return (l: string) => !covered || /^(Must photo missing|Main photo)/.test(openText(l)) || !PHOTO_GAP.test(l);
};

/**
 * After every prep call (owner, 2026-11-20): one run record (skill, part, from →
 * to stage, how many problems it found / fixed; last 10 kept) and the AI's open
 * problems rebuilt from the Attention reason the run left — red = STOPPED /
 * PENDING, yellow = NOTE. Staff {…} problems and set-aside ones stay until a run
 * reports them fixed (POST /fixed); an AI problem no longer in the reason was fixed and goes.
 */
export async function recordRun(id: number, skill: PrepRun["skill"], part: string, from: ShopStatus) {
    const r = await prisma.invProduct.findUnique({ where: { id }, select: { shopStatus: true, shopAttention: true, shopDraftJson: true } });
    if (!r) return;
    const info = readShopDraft(r.shopDraftJson);
    const now = new Date().toISOString();
    const before = info?.problems ?? [];
    const aside = before.filter((p) => p.asideAt);
    const staff = before.filter((p) => p.source === "staff" && !p.asideAt);
    const known = new Map(before.map((p) => [problemKey(p.text), p]));
    const seen = new Set([...aside, ...staff].map((p) => problemKey(p.text)));
    const open: PrepProblem[] = [];
    if (r.shopStatus === "ATTENTION") {
        for (const line of (r.shopAttention ?? "").split("\n").map((l) => l.trim())) {
            const m = /^(PENDING|STOPPED|NOTE) \(Part (\d)\) — /.exec(line);
            if (!m) continue;
            const key = problemKey(line);
            const part = Number(m[2]);
            const same = open.find((o) => problemKey(o.text) === key);
            if (same) { same.parts = [...new Set([...(same.parts ?? [same.part]), part])].sort(); continue; }
            if (seen.has(key)) continue;
            seen.add(key);
            const was = known.get(key);
            const parts = [...new Set([...(was && !was.asideAt && was.source !== "staff" ? (was.parts ?? [was.part]) : []), part])].sort();
            open.push({ text: openText(line), level: m[1] === "NOTE" ? "fix" : "stop", part, ...(parts.length > 1 && { parts }), at: was?.at ?? now });
        }
    }
    const problems = [...open.filter((p) => p.level === "stop"), ...open.filter((p) => p.level === "fix"), ...staff, ...aside];
    const wasOpen = new Set(before.filter((p) => !p.asideAt && p.source !== "staff").map((p) => problemKey(p.text)));
    const found = open.filter((p) => !wasOpen.has(problemKey(p.text))).length;
    const fixed = [...wasOpen].filter((k) => !open.some((p) => problemKey(p.text) === k)).length;
    const runs = trimRuns([...(info?.runs ?? []), { skill, part, at: now, from, to: r.shopStatus, ...(found && { found }), ...(fixed && { fixed }) }]);
    // AI problems this run no longer raises: closed by this run.
    const gone = before.filter((p) => !p.asideAt && p.source !== "staff" && !open.some((o) => problemKey(o.text) === problemKey(p.text)));
    const closed = gone.length ? withClosed(info, gone, `AI part ${part.split(" ")[0]}`, "fixed") : info?.closed;
    await prisma.invProduct.update({
        where: { id },
        data: { shopDraftJson: { ...info, runs, closed, problems: problems.length ? problems : undefined, asideCount: aside.length || undefined, noteCount: staff.length || undefined } as never },
    });
}

/**
 * Save a part's changes and leave the product at `to`. Draft / Attention go
 * through Draft (the stage before is remembered), Ready through Save as ready,
 * "same" changes no stage. `extra` adds to the saved draft notes / AI copy.
 */
async function leaveAt(id: number, to: Then, patch: ShopProductPatch, extra?: (info: ShopDraft | null) => Partial<ShopDraft>, reason?: string) {
    const draft = to === "draft" || to === "attention" ? ("save" as const) : to === "ready" ? ("ready" as const) : undefined;
    if (draft || Object.keys(patch).length) {
        const saved = await updateShopProduct(id, { ...patch, ...(draft && { draft }) });
        if (saved.response) {
            const err = (await saved.response.json().catch(() => null)) as { error?: string } | null;
            throw new AgentCopyError(err?.error ?? "Could not save the product");
        }
    }
    if (extra) {
        const row = await prisma.invProduct.findUniqueOrThrow({ where: { id }, select: { shopDraftJson: true } });
        const info = readShopDraft(row.shopDraftJson);
        await prisma.invProduct.update({ where: { id }, data: { shopDraftJson: { ...info, ...extra(info) } as never } });
    }
    if (to === "attention") await parkInAttention([id], (reason ?? "Needs staff — see the notes.").slice(0, 10000), "Claude", "any");
    // Draft with nothing left for staff: the old Attention reason is done with.
    else if (to === "draft") await prisma.invProduct.update({ where: { id }, data: { shopAttention: null, shopAttentionAt: null, shopAttentionBy: null } });
    else if (to === "waiting") await startAi([id]);
    return (await prisma.invProduct.findUniqueOrThrow({ where: { id }, select: { shopStatus: true } })).shopStatus;
}

/** An Attention reason: the open problems, what to do after, the Last run line and where it came from. */
async function attentionReason(id: number, part: number, open: string[], after: string, extra: string[] = []) {
    return [
        // A problem carried from an earlier part keeps that part's tag.
        ...open.map((x) => (OPEN_LINE.test(x) ? x : `PENDING (Part ${part}) — ${x}`)),
        ...extra,
        after,
        lastRun(part, `${open.length} for staff → Attention`),
        await originLine(id),
    ].filter(Boolean).join("\n");
}

type Identity = { brand: string; model: string; barcodes: string[] };
const identityKey = (i: Identity) => [i.brand, i.model, ...[...i.barcodes].sort()].map((x) => x.trim().toLowerCase()).join("|");

/** What is saved in R2 for one product. */
type PrepState = {
    /** 0 = no part run yet — only photo edits recorded. */
    part: 0 | 1 | 2 | 3 | 4;
    at: string;
    identity: Identity;
    search?: {
        at: string;
        found: PageSearch;
        /** url → Claude's verdict, as sent with the search. */
        verdicts: { url: string; accepted: boolean; why: string }[];
        labelFacts: Record<string, string>;
        seen: Record<string, string>;
        labelWebsite: string;
    };
    /**
     * The gallery as Part 5 left it (owner, 2026-11-20): those photos had their
     * treatment (edits, order), so the next Part 5 works only on photos added
     * after — an edited or newly added photo has a new link. "Redo" ignores it.
     */
    photosDone?: { at: string; urls: string[] };
    /**
     * Every photo edit still in use (owner, 2026-11-20): the edited link, the real
     * original (an edit of an edit keeps the first one) and what was done. Part 5
     * writes its "Photo n … (original: …)" lines from here on every run, so a
     * later run never loses the way back to the original.
     */
    edits?: { url: string; original: string; edit: string; at: string }[];
};

function requireR2() {
    if (!isR2Configured()) throw new AgentCopyError("R2 storage is not set up on this server — product prep needs it to save the search.");
}

async function readState(id: number): Promise<PrepState | null> {
    requireR2();
    const raw = await getR2Text(messagesBucket(), keyOf(id));
    if (!raw) return null;
    try { return JSON.parse(raw) as PrepState; } catch { return null; }
}

/**
 * One run of Parts 1–3 in a single call (owner, 2026-11-17): the saved state is
 * read once at the start and written once at the end — in between the parts
 * pass it along here instead of going back to R2.
 */
type RunCtx = { state: PrepState | null; identityChanged: boolean };

async function writeState(id: number, s: PrepState, run?: RunCtx) {
    if (run) { run.state = s; run.identityChanged = false; return; }
    requireR2();
    await putR2(messagesBucket(), keyOf(id), new TextEncoder().encode(JSON.stringify(s)).buffer as ArrayBuffer, "application/json");
}

async function currentIdentity(id: number): Promise<Identity> {
    const p = await prisma.invProduct.findUniqueOrThrow({
        where: { id },
        select: { modelNo: true, brand: { select: { name: true } }, codes: { where: { kind: { in: ["EAN", "UPC"] } }, select: { value: true } } },
    });
    return { brand: p.brand?.name ?? "", model: p.modelNo ?? "", barcodes: p.codes.map((c) => c.value) };
}

/** The saved state, or null when it was searched for another identity (staff changed brand / model / barcode). */
async function liveState(id: number, run?: RunCtx): Promise<{ state: PrepState | null; identityChanged: boolean }> {
    if (run) return run;
    const s = await readState(id);
    if (!s) return { state: null, identityChanged: false };
    const now = await currentIdentity(id);
    if (identityKey(now) !== identityKey(s.identity)) return { state: null, identityChanged: true };
    return { state: s, identityChanged: false };
}

/**
 * The stage a product came from before this work (owner, 2026-11-17): an
 * Attention note names it, so a product that was live can be published again
 * when the fix is small.
 */
const STAGE_WORDS: Record<string, string> = {
    PUBLISHED: "Published (live on the shop) before this check — if the fix is small, publish it again",
    READY: "Ready before this check — Save as ready again once fixed",
    UNPUBLISHED: "Unpublished before this check",
};
async function originLine(id: number): Promise<string> {
    const r = await prisma.invProduct.findUnique({ where: { id }, select: { shopStatus: true, shopDraftJson: true } });
    if (!r) return "";
    const work = r.shopStatus === "DRAFT" || r.shopStatus === "ATTENTION" || r.shopStatus === "WAITING";
    const from = work ? readShopDraft(r.shopDraftJson)?.stageBefore ?? "UNPUBLISHED" : r.shopStatus;
    return `Was ${STAGE_WORDS[from] ?? from}.`;
}

/** The part Part 4 last suggested ("… · next: Part 5 (photos …)"), from the Attention reason or the Draft notes. */
function suggestedNext(texts: string[]): 1 | 3 | 5 | null {
    for (const line of texts.flatMap((t) => t.split("\n"))) {
        const m = /^Last run: Part 4 .*· next: Part (\d)/.exec(line.trim());
        if (m) return Number(m[1]) as 1 | 3 | 5;
    }
    return null;
}

/**
 * Notes carry their part (owner, 2026-11-19): "Part 1 · Removed 1 wrong photo …".
 * A part that runs again REPLACES its own earlier lines — never a second copy —
 * and the other parts' lines stay. One Last run line on top, then Part 1 → 5.
 */
const PART_TAG = /^Part (\d) · /;
const partOf = (n: string) => Number((PART_TAG.exec(n) ?? /^Part (\d) done/.exec(n))?.[1] ?? 0);
function partNotes(old: string[], part: number, lines: string[], result: string): string[] {
    // Attention-reason lines (an open problem, "Was Published …", "Fix it, then …") belong to
    // the reason, not the notes — Save as ready copies them in; they would read as still open.
    const reasonLine = (n: string) => OPEN_LINE.test(n) || /^Was (Published|Ready|Unpublished)/.test(n) || (Object.values(AFTER_FIX) as string[]).includes(n);
    // Part 4's verdict is about the product as it was — any later part's change makes it old.
    const others = old.filter((n) => !LAST_RUN.test(n) && !/^Part \d done/.test(n) && !reasonLine(n) && partOf(n) !== part && (part === 4 || partOf(n) !== 4));
    const mine = [...new Set(lines.map((l) => l.trim()).filter(Boolean))].map((l) => (PART_TAG.test(l) ? l : `Part ${part} · ${l}`));
    // The same point written by another part shows once — the newest wording wins.
    const text = (n: string) => n.replace(PART_TAG, "");
    const fresh = new Set(mine.map(text));
    const all = [...new Set([...others.filter((n) => !fresh.has(text(n))), ...mine])].sort((a, b) => partOf(a) - partOf(b));
    return [lastRun(part, result), ...all].slice(0, 60);
}
/** The AI copy's notes without an old Last run line (only one shows, on the Draft notes). */
const aiCopyWithoutRun = (info: ShopDraft | null) => info?.aiCopy && { aiCopy: { ...info.aiCopy, notes: (info.aiCopy.notes ?? []).filter((n) => !isRunLine(n)) } };

/** Write a part's notes onto the Draft notes ("Notes for you"), replacing its earlier ones. */
async function addDraftNotes(id: number, part: number, lines: string[], result: string) {
    const row = await prisma.invProduct.findUniqueOrThrow({ where: { id }, select: { shopDraftJson: true } });
    const info = readShopDraft(row.shopDraftJson);
    const notes = partNotes(info?.notes ?? [], part, lines, result);
    await prisma.invProduct.update({ where: { id }, data: { shopDraftJson: { ...info, ...aiCopyWithoutRun(info), notes, notesAt: new Date().toISOString(), kept: undefined } as never } });
}

/** Copy a page photo (a URL Cloudinary fetches itself) or an edited photo's bytes into our Cloudinary (shop/products). Null when it fails. */
async function copyToOurPhotos(file: string | Blob): Promise<string | null> {
    const sig = await cloudinarySignature("shop/products");
    if (!sig) return null;
    const form = new FormData();
    form.append("file", file);
    form.append("api_key", sig.apiKey);
    form.append("timestamp", String(sig.timestamp));
    form.append("signature", sig.signature);
    form.append("folder", sig.folder);
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return null;
        return ((await res.json()) as { secure_url?: string }).secure_url ?? null;
    } catch {
        return null;
    }
}

// ── Edited photo (cut-out / blanked MRP / crop / straighten) ──────────────────────────────────────

export const PHOTO_EDITS = {
    cutout: "cut out onto white",
    blank: "covered MRP blanked",
    // Background kept — empty space cut away / a small tilt fixed (owner, 2026-11-21).
    crop: "cropped to the product",
    straighten: "straightened",
} as const;
export type PhotoEdit = keyof typeof PHOTO_EDITS;
const EDIT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Put an edited copy of photo n (1-based, as GET /api/agent/products/[id]/photos/[n])
 * in that photo's place (owner, 2026-11-19). The edit runs on Claude's side
 * (scripts/photo/*, free ISNet model); the original stays in our Cloudinary,
 * never deleted, and its link comes back so the part's notes can name it.
 */
export async function replacePhotoWithEdit(id: number, n: number, file: Blob | null, edit: PhotoEdit | "restore", restoreUrl?: string) {
    if (edit === "restore") {
        // Undo a bad edit: only a photo already in our own Cloudinary shop folder (the original the edit answered with).
        if (!restoreUrl || !isCloudinaryUrl(restoreUrl) || !restoreUrl.includes("/shop/products/")) throw new AgentCopyError("restore needs the original's link from our photo storage");
    } else if (!file || !file.type.startsWith("image/") || file.size === 0 || file.size > EDIT_MAX_BYTES) throw new AgentCopyError("Send one JPG / PNG / WebP image up to 10 MB");
    const p = await prisma.invProduct.findUnique({ where: { id }, select: { imageUrl: true, galleryJson: true } });
    if (!p) throw new AgentCopyError("Product not found");
    const gallery = galleryOf(p);
    const original = photosForAi(gallery)[n - 1];
    if (!original) throw new AgentCopyError(`No photo ${n} — the product has fewer photos`);
    const url = edit === "restore" ? restoreUrl! : await copyToOurPhotos(file!);
    if (!url) throw new AgentCopyError("Could not store the edited photo — Cloudinary is not set up or refused it");
    const next = gallery.map((u) => (u === original ? url : u));
    await updateShopProduct(id, { galleryUrls: next, galleryBase: gallery, imageUrl: next[0] ?? null });
    await recordEdit(id, original, url, edit);
    return { photo: n, url, original, edit: edit === "restore" ? "original restored" : PHOTO_EDITS[edit] };
}

/** Keep the edit record in the saved state: an edit of an edit keeps the first original; a restore drops the record. */
async function recordEdit(id: number, replaced: string, url: string, edit: PhotoEdit | "restore") {
    if (!isR2Configured()) return;
    const s: PrepState = (await readState(id)) ?? { part: 0, at: new Date().toISOString(), identity: await currentIdentity(id) };
    const was = s.edits?.find((e) => e.url === replaced);
    const rest = (s.edits ?? []).filter((e) => e.url !== replaced);
    const edits = edit === "restore" ? rest : [...rest, { url, original: was?.original ?? replaced, edit: was ? `${was.edit}, then ${PHOTO_EDITS[edit]}` : PHOTO_EDITS[edit], at: new Date().toISOString() }];
    await writeState(id, { ...s, edits });
}

/** "Photo 2: cut out onto white (original: …)" for every edit still in the gallery, numbered as `photos`. */
function editLines(state: PrepState | null, gallery: string[]) {
    const ours = photosForAi(gallery);
    return (state?.edits ?? []).filter((e) => ours.includes(e.url))
        .sort((a, b) => ours.indexOf(a.url) - ours.indexOf(b.url))
        .map((e) => `Photo ${ours.indexOf(e.url) + 1}: ${e.edit} (original: ${e.original})`);
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Everything product-copy's read gives, plus what the loop needs: title, group, shipping, old notes, the part done, the saved search. */
export async function productForPrep(id: number) {
    const base = await productForAgent(id);
    if (!base) return null;
    const p = await prisma.invProduct.findUniqueOrThrow({
        where: { id },
        select: {
            shopSubheading: true, shopAttention: true, shopDraftJson: true, photoChecklistJson: true,
            weightGrams: true, lengthCm: true, breadthCm: true, heightCm: true, updatedAt: true,
            group: { select: { name: true } },
        },
    });
    const draft = readShopDraft(p.shopDraftJson);
    const lastRunAt = aiRuns(draft?.runs).at(-1)?.at; // a staff move is not a run
    const { state, identityChanged } = await liveState(id);
    const search = state?.search;
    return {
        ...base,
        /** The online name (shown on the shop). `name` is our office name. */
        title: p.shopSubheading,
        /** Inventory group — drives GST. Never yours to change; note it when wrong. */
        group: p.group?.name ?? null,
        shipping: { weightGrams: p.weightGrams, lengthCm: p.lengthCm, breadthCm: p.breadthCm, heightCm: p.heightCm },
        /** The Attention reason now (a part that stopped), one problem per line. */
        attention: p.shopAttention,
        /** Notes in Draft — the earlier parts' notes and signs. */
        draftNotes: draft?.notes ?? [],
        /** Notes from the last Part 3 (aiCopy). */
        processNotes: draft?.aiCopy?.notes ?? [],
        prep: {
            /** The last 10 runs: { skill, part, at, from, to, found?, fixed? } — oldest first. */
            runs: aiRuns(draft?.runs), // the skills see their own runs only
            /**
             * The next step (owner, 2026-11-22) — the same line staff see at the end of AI notes.
             * When the owner says "follow next step", run exactly `nextStep.skill` part `nextStep.part`;
             * no `skill` means it is a staff step — leave the product alone. (`next` below is Part 4's own suggestion.)
             */
            nextStep: nextStep({
                stage: base.shopStatus, listed: base.shopStatus === "PUBLISHED", photos: base.photos.length, weight: !!p.weightGrams,
                description: !!base.currentDescription?.trim(), runs: draft?.runs ?? [],
                openProblems: (draft?.problems ?? []).filter((x) => !x.asideAt).length,
            }),
            /**
             * Staff (or anyone) changed the product after the last run (owner, 2026-11-20).
             * false + a run of the same part → skip it unless the owner says "redo".
             * The run itself saves the row a moment after its record, hence the margin.
             */
            // An open staff {…} problem always means "run again" — it is an instruction for this run.
            changedSinceRun: !lastRunAt || (draft?.noteCount ?? 0) > 0 || p.updatedAt.getTime() > Date.parse(lastRunAt) + 30_000,
            /**
             * The one shared open list: { text, level: stop | fix, part, source?: "staff", by?, asideAt? }.
             * source "staff" = a {…} instruction from the manual note — do it like any problem.
             * Set-aside ones never block, but stay until fixed. Anything you fixed (yours, staff's,
             * set aside) → POST /fixed { fixed: [its text] }.
             */
            problems: draft?.problems ?? [],
            /** The manual note as staff wrote it (Markdown). Only its {…} items are for you — they are already in `problems`. */
            staffNote: draft?.staffNote?.text ?? null,
            /** The last part finished (0 = none). Start at the next one. */
            partDone: state?.part ?? 0,
            /** The part Part 4 suggested last (5, 3 or 1), read back from its Last run line; null when none. */
            next: suggestedNext([p.shopAttention ?? "", ...(draft?.notes ?? [])]),
            /** Description empty → never written: Parts 1 + 2 + 3. Written (by hand or a part) → Parts 1 + 5 (photos). */
            path: (base.currentDescription ?? "").trim() ? ("part1+part5" as const) : ("part1+part2+part3" as const),
            /** When Part 5 last treated the photos; null = never. */
            photosDoneAt: state?.photosDone?.at ?? null,
            /** `photos` in the same order: done = treated by an earlier Part 5, new = added or changed since (treat these; "redo" = all). */
            /** Photo edits still in the gallery and their originals — restore with edit=restore + that original. */
            edits: editLines(state, base.photos),
            photoStatus: base.photos.map((url, i) => ({ n: i + 1, url, status: state?.photosDone?.urls.includes(url) ? ("done" as const) : ("new" as const) })),
            /** Staff changed brand / model / barcode after the search — the saved search is void; start again at Part 1. */
            identityChanged,
            /** True only when no search is saved for this identity. Part 2 refuses a second search. */
            searchAllowed: !search,
            searchedAt: search?.at ?? null,
            /** The saved pages: what Part 3 and Part 4 work from. Never search again. */
            pages: search?.found.pages.map((pg) => {
                const v = search.verdicts.find((x) => x.url === pg.url);
                return { url: pg.url, site: pg.site, maker: pg.maker, codeMatch: pg.codeMatch, accepted: pg.codeMatch || !!v?.accepted, why: v?.why ?? "", text: pg.text, photos: pg.photos };
            }) ?? [],
            dropped: search?.found.dropped ?? [],
            labelFacts: search?.labelFacts ?? {},
            seen: search?.seen ?? {},
            labelWebsite: search?.labelWebsite ?? "",
        },
        /** The product's photo list (owner, 2026-11-18): packing, shape, must / optional kinds, staff's "Not applicable" ticks. */
        photoList: (() => {
            const c = readPhotoChecklist(p.photoChecklistJson);
            return {
                box: c?.box ?? null,
                boxTypes: BOX_TYPES,
                shape: c?.shape ?? "",
                items: c?.items ?? [],
                /** Must photos missing and not ticked — Part 1 stops on them. */
                missing: missingMust(c),
                /** Must photos missing that the next search should look for online ("Not applicable" ones included). */
                findOnline: photosToFind(c),
            };
        })(),
    };
}

// ── The photo list (owner, 2026-11-18) ───────────────────────────────────────

/**
 * Every part sends what it sees in the photos: the packing, the product's shape /
 * size, which photo shows what, and whether the main photo is a clean product
 * photo. The must / optional kinds are the AI's own for THIS product — from how
 * the maker and good sellers show it, not a fixed table — on top of a fixed
 * floor (photoFloor: a clean product photo without the box; box front + back
 * when boxed). The server keeps the list on the product, never drops a must an
 * earlier part set, honours staff's "Not applicable" ticks, and works out what is
 * missing itself — the AI's word alone never passes a gallery.
 */
const photoCheckSchema = z.object({
    box: z.enum(BOX_TYPE_KEYS as [BoxType, ...BoxType[]]),
    /** The product's shape / size in a few words ("palm-size mouse", "1.5 m cable", "27-inch monitor"). */
    shape: z.string().trim().max(120).default(""),
    /** Each gallery photo (url as in our gallery, or a page photo you add) and the kind it shows. */
    tags: z.array(z.object({ url: z.string().url(), kind: z.string() })).max(60).default([]),
    /** Must / optional kinds for this product (photoKinds keys). */
    must: z.array(z.string()).default([]),
    nice: z.array(z.string()).default([]),
    /** Photo 1 is the product itself, sharp, without the box, with no logo, watermark or text on it (ours too). */
    mainClean: z.boolean(),
    mainWhy: z.string().trim().max(200).default(""),
    /**
     * Parts 3, 4 and 5 only (owner, 2026-11-18): they know the product better than
     * Part 1 did, so they may take an earlier must photo off the must list, each
     * with a reason. It becomes optional — the photo itself, if we have it, stays.
     * The fixed floor can never be dropped.
     */
    drop: z.array(z.object({ kind: z.string(), why: z.string().trim().min(5).max(200) })).max(20).default([]),
});
type PhotoCheck = z.infer<typeof photoCheckSchema>;

const PRODUCT_KINDS = new Set<string>(Object.entries(PHOTO_KINDS).filter(([, v]) => v.group === "product").map(([k]) => k));

/**
 * The product's photo list from a part's check, against `gallery` (the photos as
 * saved after this part). `alias` maps a page photo url to its copy in our storage.
 */
async function photoListOf(part: 1 | 3 | 4 | 5, id: number, c: PhotoCheck, gallery: string[], remove: PhotoRemoval[] = [], alias = new Map<string, string>()) {
    const row = await prisma.invProduct.findUnique({ where: { id }, select: { photoChecklistJson: true } });
    const prev = readPhotoChecklist(row?.photoChecklistJson);
    const kinds = (xs: string[]) => xs.filter(isPhotoKind) as PhotoKind[];
    const tagOf = new Map(c.tags.map((t) => [alias.get(t.url) ?? t.url, t.kind]));
    const have = new Set(kinds(gallery.map((u) => tagOf.get(u) ?? "")));
    const floor = new Set<PhotoKind>(photoFloor(c.box));
    // Part 1 knows least — it only adds. A later part's drop wins over an earlier must, never over the floor.
    const drops = part === 1 ? [] : c.drop.filter((d) => isPhotoKind(d.kind) && !floor.has(d.kind as PhotoKind));
    const dropped = new Set(drops.map((d) => d.kind as PhotoKind));
    const must = new Set<PhotoKind>([...floor, ...kinds(c.must), ...(prev?.items.filter((i) => i.must).map((i) => i.kind) ?? [])].filter((k) => !dropped.has(k)));
    const prevOf = new Map(prev?.items.map((i) => [i.kind, i]) ?? []);
    const order = [...have, ...must, ...kinds(c.nice), ...(prev?.items.map((i) => i.kind) ?? [])];
    const items: PhotoChecklistItem[] = [...new Set([...order, ...dropped])].map((kind) => {
        // Staff's own tick that the gallery has it stays.
        const done = have.has(kind) || prevOf.get(kind)?.done === true;
        // "Not applicable" only means something on a must photo still missing — cleared once it is dropped or there.
        const waived = prevOf.get(kind)?.waived && must.has(kind) && !done;
        return { kind, done, must: must.has(kind), ...(waived && { waived: true }) };
    });
    const main = gallery[0];
    const mainKind = main ? tagOf.get(main) : undefined;
    const mainProblem = !main
        ? "No photo at all — add a clean photo of the product itself."
        : !c.mainClean
            ? `Main photo is not a clean product photo${c.mainWhy ? ` (${c.mainWhy})` : ""} — put a clean photo of the product (no box, no logo or text) first.`
            : mainKind && !PRODUCT_KINDS.has(mainKind)
                ? "Main photo shows the box or a scene, not the product itself — put a clean product photo first."
                : null;
    // Staff's old "Can't do" tick (retired 2026-11-21 — a temporary pass in AI notes does this now)
    // still stops it blocking, so nothing passed earlier blocks again; a clean main photo clears it.
    const mainWaived = !!mainProblem && prev?.mainWaived === true;
    const mainBlock = mainWaived ? null : mainProblem;
    const checklist: PhotoChecklist = {
        items, enough: isEnough(items), at: new Date().toISOString(), remove, box: c.box, ...(c.shape && { shape: c.shape }),
        mainClean: !mainProblem, ...(mainWaived && { mainWaived: true }),
    };
    const missing = missingMust(checklist);
    const lines = [
        ...(mainBlock ? [mainBlock] : []),
        ...(missing.length ? [`Must photo missing: ${missing.map(photoKindLabel).join(", ")}`] : []),
    ];
    const dropNotes = drops.map((d) => `Photo "${photoKindLabel(d.kind as PhotoKind)}" no longer a must: ${d.why}${have.has(d.kind as PhotoKind) ? " — the photo we have stays." : ""}`);
    if (mainWaived) dropNotes.push(`Main photo is not clean${c.mainWhy ? ` (${c.mainWhy})` : ""} — staff ticked "Can't do", so it does not block.`);
    return { checklist, missing, mainProblem: mainBlock, lines, dropNotes };
}

/** What the next search should look for: must photos missing, ticked "Not applicable" or not. */
function photosToFind(c: PhotoChecklist | null) {
    return c?.items.filter((i) => i.must && !i.done).map((i) => photoKindLabel(i.kind)) ?? [];
}

// ── Part 1: prepare the seed (remove wrong data only) ─────────────────────────

const removal = z.object({ url: z.string().url(), why: z.string(), note: z.string().max(200).default("") });
const lines = z.array(z.string().trim().min(1).max(300)).max(40).default([]);

export const part1Schema = z.object({
    /** Photos you are SURE are wrong (another product, exact duplicate, unusable) — removed now. */
    remove: z.array(removal).max(30).default([]),
    /** Photos you are NOT sure about — left for staff with a Remove button. */
    suggestRemove: z.array(removal).max(30).default([]),
    /** Wrong data to clear. Group is never cleared (GST) — note it instead. */
    clear: z.object({
        brand: z.boolean().default(false),
        title: z.boolean().default(false),
        description: z.boolean().default(false),
        collections: z.boolean().default(false),
        /** Spec labels to drop. */
        specs: z.array(z.string()).max(50).default([]),
        shipping: z.boolean().default(false),
    }).default({ brand: false, title: false, description: false, collections: false, specs: [], shipping: false }),
    /** MAJOR problems: any → the product stops in Attention. */
    major: lines,
    /** Minor problems — notes, the loop goes on. */
    notes: lines,
    /** After the clean-up, is what is left enough to search (brand + model, part code, barcode or clear box text)? */
    enough: z.boolean(),
    /** When not enough: what staff must add ("a box / label photo", "the model no."). */
    need: z.string().trim().max(300).default(""),
    /** The photo list — a must photo missing (not ticked "Not applicable") or a main photo that is not clean stops Part 1, for better seed. */
    photos: photoCheckSchema,
    /** Where to leave the product when Part 1 is fine — the owner's instruction; default: where it is. */
    then: thenSchema,
});

/**
 * `photosNext`: Part 1 runs with Part 5 in one call (owner, 2026-11-20) — no
 * search follows, and Part 5 fixes the main photo and the must photos itself, so
 * "not enough to search" and the photo list do not stop Part 1; only a real
 * problem (`major`) does.
 */
export async function savePart1(id: number, b: z.infer<typeof part1Schema>, run?: RunCtx, photosNext = false) {
    requireR2();
    const p = await prisma.invProduct.findUnique({ where: { id }, select: { imageUrl: true, galleryJson: true, specsJson: true } });
    if (!p) throw new AgentCopyError("Product not found");
    const gallery = galleryOf(p);
    const gone = new Set(b.remove.map((r) => r.url).filter((u) => gallery.includes(u)));
    const patch: ShopProductPatch = {};
    const done: string[] = [];
    if (gone.size) {
        patch.galleryUrls = gallery.filter((u) => !gone.has(u));
        patch.imageUrl = patch.galleryUrls[0] ?? null;
        done.push(`Removed ${gone.size} wrong photo(s): ${b.remove.filter((r) => gone.has(r.url)).map((r) => r.note || r.why).join("; ")}.`);
    }
    if (b.clear.brand) { patch.brandId = null; done.push("Brand cleared (wrong)."); }
    if (b.clear.title) { patch.shopSubheading = null; done.push("Online name cleared (wrong)."); }
    if (b.clear.description) { patch.shopDescription = null; done.push("Description cleared (wrong)."); }
    if (b.clear.collections) { patch.collectionIds = []; done.push("Collections cleared (wrong)."); }
    if (b.clear.specs.length) {
        const drop = new Set(b.clear.specs.map((k) => k.trim().toLowerCase()));
        patch.specs = Object.fromEntries(Object.entries(specsOf(p.specsJson) ?? {}).filter(([k]) => !drop.has(k.trim().toLowerCase())));
        done.push(`Spec rows cleared (wrong): ${b.clear.specs.join(", ")}.`);
    }
    if (b.clear.shipping) {
        Object.assign(patch, { weightGrams: null, lengthCm: null, breadthCm: null, heightCm: null });
        done.push("Shipping weight / size cleared (wrong).");
    }
    const unsure = b.suggestRemove
        .filter((r) => gallery.includes(r.url) && !gone.has(r.url))
        .map((r) => `Check photo ${gallery.indexOf(r.url) + 1}: ${r.note || r.why} — remove it if it is wrong.`);

    const list = await photoListOf(1, id, b.photos, patch.galleryUrls ?? gallery);
    patch.photoChecklist = list.checklist;
    const searchStop = !photosNext && !b.enough;
    const aside = notAside(await asideKeys(id));
    const photoStop = (photosNext ? [] : list.lines).filter(aside);
    const major = b.major.filter(aside);
    if (major.length > 0 || searchStop || photoStop.length > 0) {
        const reason = [
            ...major.map((m) => `STOPPED (Part 1) — ${m}`),
            ...photoStop.map((m) => `STOPPED (Part 1) — ${m}`),
            ...(searchStop ? [`STOPPED (Part 1) — not enough to search${b.need ? `: ${b.need}` : ""}.`] : []),
            ...done, ...unsure, ...b.notes,
            AFTER_FIX.start,
            lastRun(1, "stopped → Attention"),
            await originLine(id),
        ];
        await leaveAt(id, "attention", patch, undefined, reason.filter(Boolean).join("\n"));
        return { result: "attention" as const, removed: gone.size, notes: reason.length };
    }
    await leaveAt(id, b.then ?? "same", patch);
    // A search saved for this same identity is kept (one search per lifecycle).
    const { state: prev } = await liveState(id, run);
    await writeState(id, { ...(prev?.search && { search: prev.search }), ...(prev?.photosDone && { photosDone: prev.photosDone }), ...(prev?.edits && { edits: prev.edits }), part: prev?.search ? Math.max(prev.part, 1) as PrepState["part"] : 1, at: new Date().toISOString(), identity: await currentIdentity(id) }, run);
    const find = photosToFind(list.checklist);
    const findNote = !find.length || photosNext ? [] : prev?.search
        ? [`Not applicable (staff): ${find.join(", ")} — already searched once, so they stay missing unless they are on a saved page or the owner asks for a new search.`]
        : [`Not applicable (staff): ${find.join(", ")} — the search looks for them online.`];
    await addDraftNotes(id, 1, [...done, ...unsure, ...b.notes, ...findNote], "done");
    return { result: "part1" as const, removed: gone.size, notes: done.length + unsure.length + b.notes.length, findOnline: find };
}

// ── Part 2: the one search, saved ─────────────────────────────────────────────

const record = z.record(z.string(), z.coerce.string()).default({});

export const part2Schema = z.object({
    /** Every page read, accepted or not. Empty = the search found nothing usable. */
    pages: z.array(z.object({ url: z.string().url(), accepted: z.boolean(), why: z.string().trim().max(300).default("") })).max(8).default([]),
    labelFacts: record,
    seen: record,
    labelWebsite: z.string().trim().max(200).default(""),
    /** Only when the owner asks to run Part 2 again: replaces the saved search. */
    again: z.boolean().default(false),
    /** The search itself failed (tool down, error) — not "found nothing". The product goes to Attention, nothing is saved. */
    failed: z.string().trim().min(3).max(300).optional(),
    /** Where to leave the product after a good search — the owner's instruction; default: where it is. */
    then: thenSchema,
});

/** Part 2 could not search at all → Attention; the one search is not used up. */
async function searchFailed(id: number, why: string) {
    const reason = [
        `STOPPED (Part 2) — the search failed: ${why}. Nothing was saved, the one search is not used up.`,
        "Run Part 2 again later.",
        lastRun(2, "search failed → Attention"),
        await originLine(id),
    ];
    await leaveAt(id, "attention", {}, undefined, reason.filter(Boolean).join("\n"));
    return { result: "attention" as const, failed: why };
}

export async function savePart2(id: number, b: z.infer<typeof part2Schema>, run?: RunCtx) {
    const { state, identityChanged } = await liveState(id, run);
    if (!state || state.part < 1) throw new AgentCopyError(identityChanged ? "Brand / model / barcode changed since Part 1 — run Part 1 again first." : "Part 1 is not done for this product — run it first.");
    if (state.search && !b.again) throw new AgentCopyError(`Already searched on ${state.search.at.slice(0, 10)} — one search per product. Use the saved pages (Part 3); send "again": true only when the owner asks.`);
    if (b.failed) return searchFailed(id, b.failed);
    const p = await prisma.invProduct.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const identity = await currentIdentity(id);
    let found: PageSearch;
    try {
        found = !b.pages.length ? { pages: [], dropped: [], searchNote: "The search found no usable page" } : await readGivenPages({
            urls: b.pages.map((x) => x.url),
            brand: identity.brand || p.name.split(/\s+/)[0] || "",
            labelSite: b.labelWebsite,
            codes: [...identity.barcodes, ...(identity.model ? [identity.model] : [])],
        });
    } catch (e) {
        // Reading the pages broke on our side — a technical failure, not "nothing found".
        return searchFailed(id, `reading the pages broke (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
    }
    const verdicts = b.pages.map((x) => ({ url: x.url, accepted: x.accepted, why: x.why }));
    const accepted = found.pages.filter((pg) => pg.codeMatch || verdicts.find((v) => v.url === pg.url)?.accepted);
    const next: PrepState = {
        // No good page is not a stop (owner, 2026-11-17): searching again gains
        // nothing without new seed, so Part 3 goes on from the label and photos.
        part: 2,
        at: new Date().toISOString(),
        identity,
        search: { at: new Date().toISOString(), found, verdicts, labelFacts: b.labelFacts, seen: b.seen, labelWebsite: b.labelWebsite },
        ...(state.photosDone && { photosDone: state.photosDone }),
        ...(state.edits && { edits: state.edits }),
    };
    await writeState(id, next, run);
    await addDraftNotes(id, 2, [
        accepted.length
            ? `Searched once: ${accepted.length} page(s) kept (${accepted.map((pg) => pg.site).join(", ")}).`
            : "Searched once: no maker or seller page matched — the copy is from the label and photos only.",
    ], accepted.length ? `${accepted.length} page(s) kept` : "no good page — label only");
    if (b.then && b.then !== "same") await leaveAt(id, b.then, {});
    return {
        result: accepted.length ? ("part2" as const) : ("no-good-page" as const),
        read: found.pages.map((pg) => ({ url: pg.url, site: pg.site, maker: pg.maker, codeMatch: pg.codeMatch, accepted: accepted.includes(pg) })),
        dropped: found.dropped,
        /** Must photos still missing — Part 3 adds them from the kept pages when sure. */
        findOnline: photosToFind(readPhotoChecklist((await prisma.invProduct.findUnique({ where: { id }, select: { photoChecklistJson: true } }))?.photoChecklistJson)),
    };
}

// ── Shared by Part 3 and Part 5: sources, shipping, Model No, photos ───────────

type Facts = { labelFacts: Record<string, string>; seen: Record<string, string> };
type ProductRow = {
    name: string; namePart: string | null; modelNo: string | null; imageUrl: string | null; galleryJson: unknown;
    specsJson: unknown; brandId: number | null; brand: { name: string } | null; weightGrams: number | null; lengthCm: number | null; shopDraftJson: unknown;
};
const productSelect = {
    name: true, namePart: true, modelNo: true, imageUrl: true, galleryJson: true, specsJson: true, brandId: true,
    brand: { select: { name: true } }, weightGrams: true, lengthCm: true, shopDraftJson: true,
} as const;

/** "label" → the printed facts; a url → that kept page. Null when it is neither. */
function sourceOf(src: string, facts: Facts, trusted: PageRead[]): { site: string; norm: string; maker?: boolean } | null {
    const t = src.trim();
    if (t.toLowerCase() === "label") return { site: "the label", norm: normForCheck([...Object.entries(facts.labelFacts).flat(), ...Object.entries(facts.seen).flat()].join(" ")) };
    return trusted.find((x) => x.url === t) ?? null;
}

/** Shipping: fill only when empty, and say where it came from; a filled one only gets a note. */
function applyShipping(sh: Shipping | undefined, p: ProductRow, facts: Facts, trusted: PageRead[], patch: ShopProductPatch, notes: string[]) {
    if (!sh) return;
    const src = sh.source.trim();
    const pg = sourceOf(src, facts, trusted);
    if (!pg) { notes.push(`Shipping not used: "${src}" is not the label or a kept page.`); return; }
    const w = sh.weight && checkFact(pg.norm, "Weight", sh.weight) ? gramsOf(sh.weight) : null;
    const d = sh.dimensions && checkFact(pg.norm, "Dimensions", sh.dimensions) ? cmOf(sh.dimensions) : null;
    if (w && !p.weightGrams) patch.weightGrams = w;
    else if (w && p.weightGrams && Math.abs(w - p.weightGrams) / p.weightGrams > 0.25) notes.push(`Weight: ours ${p.weightGrams} g, ${pg.site} says ${w} g — check (ours may include packing).`);
    if (d && !p.lengthCm) [patch.lengthCm, patch.breadthCm, patch.heightCm] = d;
    else if (d && p.lengthCm) notes.push(`Parcel size on ${pg.site}: ${d.join(" × ")} cm — ours is already filled, not changed.`);
    if (patch.weightGrams || patch.lengthCm) {
        notes.push(src.toLowerCase() === "label"
            ? "Weight / size as printed on the box, not weighed by us — add wrapper and packing weight if needed."
            : `Weight / size taken from ${pg.site}, not weighed by us — add wrapper and packing weight if needed.`);
    }
}

/** Model No to fill: only when ours is empty, the code is really on the source, and the product is not local (unbranded) goods. */
function modelNoToFill(m: ModelNoFix | undefined, p: ProductRow, facts: Facts, trusted: PageRead[], notes: string[]): string | null {
    // Local (unbranded) goods carry one-off codes — their Model No is left to staff (owner, 2026-11-17).
    if (!m || /unbranded|special|generic/i.test(p.brand?.name ?? "")) return null;
    const src = sourceOf(m.source, facts, trusted);
    if (!src || !src.norm.includes(normForCheck(m.value))) { notes.push(`Model No "${m.value}" not found on the label or a kept page — not filled.`); return null; }
    if (p.modelNo?.trim()) {
        if (normForCheck(p.modelNo) !== normForCheck(m.value)) notes.push(`Model No is "${p.modelNo}", the ${m.source.trim().toLowerCase() === "label" ? "box" : "maker"} says "${m.value}" — check.`);
        return null;
    }
    return m.value;
}

/**
 * Write the Model No. It feeds the office name: the custom part often already holds
 * the code ("2m POR 1624") — it is taken out there so the rebuilt name shows it once
 * (owner, 2026-11-17); a custom part that is ONLY the code is left alone (an empty
 * one would stop the name ever being rebuilt). Then the name is rebuilt, as an inventory edit does.
 */
async function writeModelNo(id: number, p: ProductRow, value: string) {
    const chunks = value.match(/[a-z]+|[0-9]+/gi) ?? [];
    const inPart = chunks.length ? new RegExp(`(^|[^a-z0-9])${chunks.join("[\\s._-]*")}(?![a-z0-9])`, "gi") : null;
    const stripped = p.namePart && inPart?.test(p.namePart) ? p.namePart.replace(inPart, "$1").replace(/\s{2,}/g, " ").trim() : undefined;
    await prisma.invProduct.update({ where: { id }, data: { modelNo: value, ...(stripped && { namePart: stripped }) } });
    if (stripped !== "") await regenerateProductNamesSafe({ ids: [id] });
}

/** Photos: sure ones applied to `patch` now (added ones copied into our storage first), the rest offered to staff. */
async function applyPhotos(ph: PhotoPlan, p: ProductRow, trusted: PageRead[], patch: ShopProductPatch, notes: string[]) {
    const gallery = galleryOf(p);
    const onPage = new Map(trusted.flatMap((pg) => pg.photos.map((u) => [u, pg] as const)));
    const gone = new Set(ph.remove.map((r) => r.url).filter((u) => gallery.includes(u)));
    const wanted = ph.add.filter((x) => onPage.has(x.url) && !gallery.includes(x.url)).slice(0, AI_PHOTO_LIMITS.total);
    for (const x of ph.add) if (!onPage.has(x.url)) notes.push(`Photo not on a kept page — not added: ${x.url}`);
    // Copied into our Cloudinary first, as staff's Add does (AiPhotoPicker): the
    // shop and product page only show our own photo hosts, and the maker's link may move.
    const copyOf = new Map<string, string>();
    const failed: typeof wanted = [];
    for (const x of wanted) {
        const ours = await copyToOurPhotos(x.url);
        if (ours) copyOf.set(x.url, ours); else failed.push(x);
    }
    if (failed.length) notes.push(`${failed.length} photo(s) could not be copied to our storage — offered to add by hand instead.`);
    const added = wanted.filter((x) => copyOf.has(x.url));
    let next = [...gallery.filter((u) => !gone.has(u)), ...added.map((x) => copyOf.get(x.url)!)];
    const ordered = [...new Set(ph.order.map((u) => copyOf.get(u) ?? u).filter((u) => next.includes(u)))];
    if (ordered.length) next = [...ordered, ...next.filter((u) => !ordered.includes(u))];
    if (gone.size || added.length || ordered.length) {
        patch.galleryUrls = next;
        patch.imageUrl = next[0] ?? null;
        if (gone.size) notes.push(`Removed ${gone.size} wrong photo(s): ${ph.remove.filter((r) => gone.has(r.url)).map((r) => r.note || r.why).join("; ")}.`);
        if (added.length) notes.push(`Added ${added.length} photo(s) from ${[...new Set(added.map((x) => onPage.get(x.url)!.site))].join(", ")} — check they show this exact model and colour.`);
    }
    if (added.some((x) => !onPage.get(x.url)?.maker)) notes.push("Some added photos are from a seller's page, not the maker's.");
    const suggested: PhotoSuggestion[] = [...ph.suggest, ...failed]
        .filter((x) => onPage.has(x.url) && !next.includes(x.url))
        .map((x) => ({ url: x.url, site: onPage.get(x.url)!.site, kind: isPhotoKind(x.kind) ? x.kind : null }));
    const ours = photosForAi(next);
    const nOf = (u: string) => ours.indexOf(u) + 1;
    const arrange = arrangeFrom({ order: [], look: ph.look.filter((x) => nOf(x.url) > 0).map((x) => ({ ...x, photo: nOf(x.url), crop: x.crop, focus: x.focus, background: x.background })) }, ours, new Set());
    const remove = ph.suggestRemove.filter((r) => next.includes(r.url) && r.why in PHOTO_REMOVE_REASONS).map((r) => ({ url: r.url, why: r.why as PhotoRemoveReason, note: r.note }));
    return { removed: gone.size, added: added.length, ordered: ordered.length > 0, suggested, arrange, gallery: next, remove, alias: copyOf };
}

// ── Part 3: process from the saved pages ──────────────────────────────────────

const photoPick = z.object({ url: z.string().url(), kind: z.string().optional() });
const shippingSchema = z.object({ weight: z.string().trim().max(60).optional(), dimensions: z.string().trim().max(80).optional(), source: z.string().trim().max(500) });
/** The maker's model / part code as printed ("label" or a kept page url) — filled only when our Model No is empty. */
const modelNoSchema = z.object({ value: z.string().trim().min(1).max(100), source: z.string().trim().max(500) });
const photoPlanSchema = z.object({
    /** From the saved pages, sure: added to the gallery now. */
    add: z.array(photoPick).max(15).default([]),
    /** From the saved pages, not sure: shown to staff to add. */
    suggest: z.array(photoPick).max(15).default([]),
    /** Our photos, sure wrong: removed now. */
    remove: z.array(removal).max(30).default([]),
    /** Our photos, not sure: Remove buttons for staff. */
    suggestRemove: z.array(removal).max(30).default([]),
    /** The gallery in order (our kept photos + added ones) — applied now. */
    order: z.array(z.string().url()).max(40).default([]),
    look: z.array(z.object({
        url: z.string().url(), crop: z.string().optional(), focus: z.string().optional(),
        fixes: z.array(z.string()).default([]), rotate: z.coerce.number().catch(0).default(0),
        background: z.string().optional(), why: z.string().trim().max(120).default(""),
    })).max(30).default([]),
}).default({ add: [], suggest: [], remove: [], suggestRemove: [], order: [], look: [] });
type Shipping = z.infer<typeof shippingSchema>;
type ModelNoFix = z.infer<typeof modelNoSchema>;
type PhotoPlan = z.infer<typeof photoPlanSchema>;

export const part3Schema = z.object({
    /** The improved copy, keys as `writing` says, with specSources ("label" or a saved page url). */
    copy: z.record(z.string(), z.unknown()),
    brandId: z.number().int().positive().optional(),
    /** The collections, main first — they REPLACE the ones set now. */
    collectionIds: z.array(z.number().int().positive()).min(1).max(10),
    shipping: shippingSchema.optional(),
    modelNo: modelNoSchema.optional(),
    photos: photoPlanSchema,
    /** The photo list after your changes — tags may name the page photos you add. */
    photoCheck: photoCheckSchema,
    /** Information only (what you did, where a fact came from) — never blocks. */
    notes: lines,
    /** What only staff can do (create a brand, fix the group, check the real unit) — any line → Attention. */
    staff: lines,
    /** Where to leave the product when nothing is left for staff — the owner's instruction; default: Draft. */
    then: thenSchema,
});

export async function savePart3(id: number, b: z.infer<typeof part3Schema>, run?: RunCtx) {
    const { state, identityChanged } = await liveState(id, run);
    if (!state?.search || state.part < 2) throw new AgentCopyError(identityChanged ? "Brand / model / barcode changed since the search — start again at Part 1." : "No saved search — Part 2 is not done.");
    const s = state.search;
    const p: ProductRow = await prisma.invProduct.findUniqueOrThrow({ where: { id }, select: productSelect });

    // The fact check, exactly as product-copy's — but on the SAVED pages, no download.
    const letterOf = new Map(s.found.pages.map((pg, i) => [pg.url, String.fromCharCode(65 + i)]));
    const raw = b.copy as Record<string, unknown>;
    const sources = raw.specSources && typeof raw.specSources === "object" ? (raw.specSources as Record<string, unknown>) : {};
    const written = writtenCopySchema.safeParse({
        ...raw,
        pages: s.found.pages.map((pg, i) => {
            const v = s.verdicts.find((x) => x.url === pg.url);
            return { page: String.fromCharCode(65 + i), accepted: !!v?.accepted, why: v?.why ?? "" };
        }),
        specSources: Object.fromEntries(Object.entries(sources).map(([k, v]) => {
            const t = String(v ?? "").trim();
            return [k, t.toLowerCase() === "label" ? "label" : letterOf.get(t) ?? ""];
        })),
    });
    if (!written.success) throw new AgentCopyError(`copy does not match the keys in "writing": ${written.error.issues.slice(0, 3).map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    const checked = checkWrittenCopy(p.name, { labelFacts: s.labelFacts, seen: s.seen }, s.found, written.data);

    // Part 1 / Part 2 notes sit in the Draft notes, which this save replaces —
    // carried over (signs left out) so staff still see what Part 1 found.
    // The Draft notes (Parts 1, 2, 4, 5) move into the AI copy, which this save
    // replaces; this part's own earlier lines are replaced, never doubled.
    const earlier = readShopDraft(p.shopDraftJson)?.notes ?? [];
    const notes = [...b.notes];
    const patch: ShopProductPatch = { shopDescription: checked.copy.shopDescription, shopSubheading: checked.copy.title };

    // Specs: improved rows replace ours with the same label; our other rows stay.
    const compat = checked.copy.compatibility.flatMap((g) => g.models);
    const rows = Object.entries({ ...checked.copy.specs, ...(compat.length && { [COMPATIBLE_SPEC]: compat.join(", ") }) }).filter(([, v]) => v.trim());
    if (rows.length) {
        const theirs = new Set(rows.map(([k]) => k.trim().toLowerCase()));
        patch.specs = { ...Object.fromEntries(Object.entries(specsOf(p.specsJson) ?? {}).filter(([k]) => !theirs.has(k.trim().toLowerCase()))), ...Object.fromEntries(rows) };
    }

    // Brand: from the list only; not in it → a note, no stop (Part 4 checks it again).
    const masters = await pickableMasters();
    const staff: string[] = [...b.staff];
    if (b.brandId) {
        const br = masters.brands.find((x) => x.id === b.brandId);
        if (!br) staff.push(`Brand id ${b.brandId} is not an active brand — not set. Create the brand, then set it.`);
        else if (p.brandId !== br.id) { patch.brandId = br.id; notes.push(`Brand set to "${br.name}"${p.brand?.name ? ` (was "${p.brand.name}")` : ""}.`); }
    }
    // Collections: set fresh (replace), main first.
    const unknown = b.collectionIds.filter((c) => !masters.collections.some((x) => x.id === c));
    if (unknown.length) notes.push(`Collection id ${unknown.join(", ")} does not exist — not set.`);
    const cols = b.collectionIds.filter((c) => !unknown.includes(c));
    if (cols.length) patch.collectionIds = [...new Set(cols)];

    const facts = { labelFacts: s.labelFacts, seen: s.seen };
    applyShipping(b.shipping, p, facts, checked.trusted, patch, notes);
    const fillModelNo = modelNoToFill(b.modelNo, p, facts, checked.trusted, notes);
    const ph = await applyPhotos(b.photos, p, checked.trusted, patch, notes);
    const list = await photoListOf(3, id, b.photoCheck, ph.gallery, ph.remove, ph.alias);
    patch.photoChecklist = list.checklist;
    notes.push(...list.dropNotes);
    const own3 = staff.filter(notPhotoRestatement(list.lines));
    const open = [...new Set([...own3, ...list.lines])].filter(notAside(await asideKeys(id)));
    const runResult = open.length ? `${open.length} for staff → Attention` : `done → ${THEN_WORDS[b.then ?? "draft"]}`;

    const draft: ProductCopy = {
        ...checked.copy,
        note: `Written by Claude (product prep, from the saved search of ${s.at.slice(0, 10)}); ${checked.copy.note}`,
        notes: partNotes(earlier, 3, notes, runResult),
        photoChecklist: list.checklist,
        ...(ph.arrange && { photoArrange: ph.arrange }),
        photoSuggestions: ph.suggested,
    };
    if (fillModelNo) draft.notes = partNotes(earlier, 3, [...notes, `Model No filled: ${fillModelNo} (from the ${b.modelNo!.source.toLowerCase() === "label" ? "box" : "maker page"}).`], runResult);
    const shopStatus = await leaveAt(
        id, open.length ? "attention" : b.then ?? "draft", patch,
        () => ({ aiCopy: draft, notes: undefined, notesAt: undefined, kept: undefined }),
        open.length ? await attentionReason(id, 3, open, AFTER_FIX.recheck) : undefined,
    );
    if (fillModelNo) await writeModelNo(id, p, fillModelNo);
    // Model No is part of the identity the search was saved for — keep it matching.
    await writeState(id, { ...state, part: 3, at: new Date().toISOString(), ...(fillModelNo && { identity: await currentIdentity(id) }) }, run);
    return {
        result: open.length ? ("attention" as const) : ("part3" as const), shopStatus, staff: open,
        kept: { specs: checked.copy.specs, highlights: checked.copy.highlights, warranty: checked.copy.warranty },
        unsure: checked.copy.unsure, flags: checked.copy.flags,
        photos: { removed: ph.removed, added: ph.added, ordered: ph.ordered, suggested: ph.suggested.length },
        notes: draft.notes,
    };
}

// ── Part 5: photos (with Part 1, no search, no text) ───────────────────────────────────────────────────────────

export const part5Schema = z.object({
    photos: photoPlanSchema,
    photoCheck: photoCheckSchema,
    /** Information only — never blocks. One line per photo: what was done, or why it was left. */
    notes: lines,
    /** What only staff can do (a reshoot, a revised-MRP sticker) — any line → Attention. */
    staff: lines,
    /** The open problems in the Attention reason now that you FIXED, copied as they are written. Every other one stays open. */
    fixed: z.array(z.string().trim().min(1)).max(40).default([]),
    /** Where to leave the product when nothing is left for staff — the owner's instruction; default: Draft. */
    then: thenSchema,
}).strict();

/** The server's own photo lines: worked out fresh by every part, never carried over. */
const SERVER_PHOTO_LINE = /^(Main photo |No photo at all|Must photo missing)/;

/**
 * Part 5 — photos (owner, 2026-11-20; was "touch-up" 2026-11-17): for a product
 * that already has its text — written by staff before the loop existed, or by an
 * earlier Part 3 — always run with Part 1 in one call (/run { part1, part5 }).
 * Photos only: no search, no text, specs or names. The edits (cut-out, covered
 * MRP) are put in before the call through /api/agent/products/[id]/photos/[n];
 * here come the removals, adds / suggestions from the saved search, order and
 * the photo list. The gallery it leaves is remembered (photosDone) so the next
 * Part 5 works only on photos added after. → Draft, or Attention when anything
 * is left only staff can do; Part 4 checks it after.
 */
export async function savePart5(id: number, b: z.infer<typeof part5Schema>, run?: RunCtx) {
    const p: ProductRow & { shopAttention: string | null } = await prisma.invProduct.findUniqueOrThrow({
        where: { id }, select: { ...productSelect, shopAttention: true },
    }).catch(() => { throw new AgentCopyError("Product not found"); });
    const { state, identityChanged } = await liveState(id, run);
    if (!state || state.part < 1) throw new AgentCopyError(identityChanged ? "Brand / model / barcode changed — send part1 and part5 together to /run." : "Part 1 is not done for this product — send part1 and part5 together to /run.");
    const search = state.search;
    const trusted = search ? search.found.pages.filter((pg) => pg.codeMatch || search.verdicts.find((v) => v.url === pg.url)?.accepted) : [];
    const notes: string[] = [...b.notes];
    const patch: ShopProductPatch = {};

    const ph = await applyPhotos(b.photos, p, trusted, patch, notes);
    if (!trusted.length && (b.photos.add.length || b.photos.suggest.length)) notes.push("No saved search for this product — photos can only be added by hand.");
    const list = await photoListOf(5, id, b.photoCheck, ph.gallery, ph.remove, ph.alias);
    patch.photoChecklist = list.checklist;
    notes.push(...list.dropNotes, ...editLines(state, ph.gallery));

    // What is still open for staff (owner, 2026-11-19): the problems in the Attention
    // reason now, minus the ones Claude says it fixed (by their exact text — no word
    // guessing), minus the server's photo lines (worked out fresh above), plus new ones.
    const fixed = new Set(b.fixed.map(openText));
    const carried = (p.shopAttention ?? "").split("\n")
        .map((l) => l.trim())
        .filter((l) => OPEN_LINE.test(l) && !SERVER_PHOTO_LINE.test(openText(l)) && !fixed.has(openText(l)));
    const open = [...new Set([...list.lines, ...carried.filter(notPhotoRestatement(list.lines)), ...b.staff.filter(notPhotoRestatement(list.lines))])].filter(notAside(await asideKeys(id)));
    const runResult = open.length ? `${open.length} for staff → Attention` : `photos done → ${THEN_WORDS[b.then ?? "draft"]}`;

    await leaveAt(id, open.length ? "attention" : b.then ?? "draft", patch, (info) => {
        const ai = info?.aiCopy;
        // Staff's Add buttons live on the AI copy; a product written by hand has none,
        // so its photo offers go in the notes instead of being lost.
        const offers = ai ? [] : ph.suggested.map((x) => `Photo to add${x.kind ? ` (${photoKindLabel(x.kind)})` : ""}, found on ${x.site} — add it if it is this exact model: ${x.url}`);
        return {
            notes: partNotes(info?.notes ?? [], 5, [...notes, ...offers], runResult),
            notesAt: new Date().toISOString(),
            kept: undefined,
            ...(ai && {
                aiCopy: {
                    ...ai,
                    notes: (ai.notes ?? []).filter((n) => !isRunLine(n)),
                    photoChecklist: list.checklist,
                    ...(ph.arrange ? { photoArrange: ph.arrange } : {}),
                    photoSuggestions: [...ph.suggested, ...(ai.photoSuggestions ?? [])].filter((x, i, all) => all.findIndex((y) => y.url === x.url) === i),
                },
            }),
        };
    }, open.length ? await attentionReason(id, 5, open, AFTER_FIX.recheck) : undefined);
    await writeState(id, { ...state, photosDone: { at: new Date().toISOString(), urls: ph.gallery } }, run);
    return {
        result: open.length ? ("attention" as const) : ("part5" as const),
        photos: { removed: ph.removed, added: ph.added, ordered: ph.ordered, suggested: ph.suggested.length },
        staff: open, notes,
    };
}

// ── One call: Part 1 + 2 + 3, or Part 1 + 5 ───────────────────────────────────

export const runSchema = z.object({
    part1: part1Schema,
    /** The one search. Left out when the product already has a saved search (rerun). */
    part2: part2Schema.optional(),
    /** No description yet: Part 1 → 2 → 3. */
    part3: part3Schema.optional(),
    /** Description already there (owner, 2026-11-20): Part 1 → 5, photos only, no search. */
    part5: part5Schema.optional(),
})
    .refine((x) => !!x.part3 !== !!x.part5, "Send part3 (with part2 when there is no saved search) or part5 — one of them")
    .refine((x) => !(x.part5 && x.part2), "Part 5 takes no search — send part1 + part5");

/**
 * A run with no stop is one call, like product-copy: Part 1 → (2 →) 3, or
 * Part 1 → 5 — R2 read once and written once. A major problem in Part 1 ends it
 * there (Attention, the cleaned data and notes kept); the parts' own endpoints
 * stay for a run that restarts at a given part.
 */
export async function runParts(id: number, b: z.infer<typeof runSchema>) {
    const run: RunCtx = await liveState(id);
    const p1 = await savePart1(id, b.part1, run, !!b.part5);
    if (p1.result === "attention") {
        // Part 1 stopped: the saved state did not change, nothing to write.
        return { result: "attention" as const, stoppedAt: 1, part1: p1 };
    }
    if (b.part5) {
        try {
            return { ...(await savePart5(id, b.part5, run)), part1: p1 };
        } finally {
            if (run.state) await writeState(id, run.state);
        }
    }
    const p2 = b.part2 ? await savePart2(id, b.part2, run) : null;
    if (p2?.result === "attention") return { result: "attention" as const, stoppedAt: 2, part1: p1, part2: p2 };
    if (!b.part2 && !run.state?.search) throw new AgentCopyError("No saved search for this product — send part2 (the search) in the run.");
    try {
        const p3 = await savePart3(id, b.part3!, run);
        return { ...p3, part1: p1, part2: p2 };
    } finally {
        // The search is never lost, even when Part 3 is refused (422) — the next run reuses it.
        if (run.state) await writeState(id, run.state);
    }
}

// ── Part 4: verify (no internet) ──────────────────────────────────────────────

export const part4Schema = z.object({
    /** What is still wrong or not done. */
    pending: lines,
    /** Smaller problems. Any line here still sends the product to Attention (owner, 2026-11-17). */
    notes: lines,
    /** Which part to run next (owner, 2026-11-17): part5 = photos only (run with Part 1), part3 = text wrong — rewrite from the saved search, part1 = start again. */
    next: z.enum(["part5", "part3", "part1"]).optional(),
    /** The photo list as you see it now — the server checks the must photos and the main photo itself. */
    photoCheck: photoCheckSchema,
    /**
     * Missing must photos you found among the saved pages' photos (owner, 2026-11-18):
     * Part 4 changes no photo itself — it says who can fix each gap. On a saved page →
     * Part 5 adds it; not → staff take it or tick "Not applicable".
     */
    onPages: z.array(z.object({ kind: z.string(), url: z.string().url() })).max(20).default([]),
    /** Where to leave a verified product — the owner's instruction; default: Ready (never Published yet). */
    then: thenSchema,
});
const NEXT_WORDS = { part5: "Part 5 (photos — with Part 1, no search)", part3: "Part 3 (rewrite from the saved search)", part1: "Part 1 (start again)" } as const;

/**
 * Part 4: any problem at all — pending or a note — parks the product in
 * Attention with every line, even a Published one (owner, 2026-11-17: off the
 * shop is fine). Only a product with nothing found is verified.
 */
export async function savePart4(id: number, input: z.infer<typeof part4Schema>) {
    const row = await prisma.invProduct.findUnique({ where: { id }, select: { imageUrl: true, galleryJson: true } });
    if (!row) throw new AgentCopyError("Product not found");
    // Photos are checked here, not taken on the AI's word (owner, 2026-11-18: a
    // one-photo product with our logo on the main photo passed).
    const list = await photoListOf(4, id, input.photoCheck, galleryOf(row));
    // The list itself is saved (not the product) so staff see the must rows and can tick "Not applicable".
    await prisma.invProduct.update({ where: { id }, data: { photoChecklistJson: list.checklist } });
    // Who fixes each missing must photo: a photo really on a kept saved page → Part 5; else staff.
    const { state: saved } = await liveState(id).catch(() => ({ state: null }));
    const search = saved?.search;
    const kept = search ? search.found.pages.filter((pg) => pg.codeMatch || search.verdicts.find((v) => v.url === pg.url)?.accepted) : [];
    const siteOf = new Map(kept.flatMap((pg) => pg.photos.map((u) => [u, pg.site] as const)));
    const where = new Map(input.onPages.filter((x) => isPhotoKind(x.kind) && siteOf.has(x.url)).map((x) => [x.kind as PhotoKind, siteOf.get(x.url)!]));
    const onPage = list.missing.filter((k) => where.has(k));
    const byStaff = list.missing.filter((k) => !where.has(k));
    const photoLines = [
        ...(list.mainProblem ? [list.mainProblem] : []),
        ...(onPage.length ? [`Must photo missing, on a saved page: ${onPage.map((k) => `${photoKindLabel(k)} (${where.get(k)})`).join(", ")}`] : []),
        ...(byStaff.length ? [`Must photo missing: ${byStaff.map(photoKindLabel).join(", ")}`] : []),
    ];
    const aside = notAside(await asideKeys(id));
    const restated = notPhotoRestatement(photoLines);
    const b = { ...input, pending: [...photoLines, ...input.pending.filter(restated)].filter(aside), notes: input.notes.filter(restated).filter(aside), next: input.next ?? (photoLines.length ? ("part5" as const) : undefined) };
    const problems = b.pending.length + b.notes.length;
    if (problems) {
        const reason = [
            ...b.pending.map((x) => `PENDING (Part 4) — ${x}`),
            ...b.notes.map((x) => `NOTE (Part 4) — ${x}`),
            ...list.dropNotes,
            lastRun(4, `${problems} problem(s) → Attention${b.next ? ` · next: ${NEXT_WORDS[b.next]}` : ""}`),
        ];
        await parkInAttention([id], [...reason, await originLine(id)].filter(Boolean).join("\n").slice(0, 10000), "Claude", "any");
        // The earlier result lines ("Part 4 done — verified", an old Last run) would sit
        // beside this new one and contradict it (owner, 2026-11-18) — dropped.
        await addDraftNotes(id, 4, [], `${problems} problem(s) → Attention`);
        return { result: "attention" as const, pending: b.pending.length, notes: b.notes.length };
    }
    const { state } = await liveState(id).catch(() => ({ state: null }));
    if (state) await writeState(id, { ...state, part: 4, at: new Date().toISOString() });
    // Verified → Ready (owner, 2026-11-19); staff press Publish. Straight to Published
    // only once the AI has earned that trust.
    const to = input.then ?? "ready";
    const shopStatus = await leaveAt(id, to, {}, (info) => ({
        ...aiCopyWithoutRun(info),
        notes: partNotes(info?.notes ?? [], 4, [...list.dropNotes, `Verified${to === "ready" ? " — moved to Ready, press Publish." : "."}`], `verified → ${to === "same" ? "stage kept" : to}`),
        notesAt: new Date().toISOString(),
    }));
    return { result: "verified" as const, shopStatus };
}

// ── Staff: "can't fix now" (owner, 2026-11-20) ────────────────────────────────

/**
 * Set a problem aside, or bring it back. Aside: it leaves the Attention reason
 * (so it no longer reads as open) and no part raises it again, but it stays on
 * the product with who and when — the products list's "Set aside" tab finds it.
 * Back: it is open again; the next run raises it if it is still true.
 */
export async function setProblemAside(id: number, text: string, aside: boolean, by: string) {
    const r = await prisma.invProduct.findUnique({ where: { id }, select: { shopAttention: true, shopDraftJson: true } });
    if (!r) throw new AgentCopyError("Product not found");
    const info = readShopDraft(r.shopDraftJson);
    const key = problemKey(text);
    const list = info?.problems ?? [];
    if (!list.some((p) => problemKey(p.text) === key)) throw new AgentCopyError("That problem is not on the product any more — reload.");
    const now = new Date().toISOString();
    const problems = list.map((p) => problemKey(p.text) !== key ? p : aside ? { ...p, asideBy: by, asideAt: now } : { ...p, asideBy: undefined, asideAt: undefined });
    const asideCount = problems.filter((p) => p.asideAt).length;
    const attention = aside && r.shopAttention
        ? r.shopAttention.split("\n").filter((l) => !(OPEN_LINE.test(l.trim()) && problemKey(l) === key)).join("\n")
        : r.shopAttention;
    await prisma.invProduct.update({
        where: { id },
        data: { shopDraftJson: { ...info, problems, asideCount: asideCount || undefined } as never, shopAttention: attention },
    });
    return { problems };
}

// ── Manual note + fixed + search (owner, 2026-11-20) ──────────────────────────

/**
 * Save the manual note (one Markdown box; empty = remove). Its {…} items are the
 * staff's open problems in the shared list: a new item is added, a removed one
 * goes, an unchanged one keeps its date and any "can't fix now" tick.
 */
export async function saveStaffNote(id: number, text: string, by: string) {
    const r = await prisma.invProduct.findUnique({ where: { id }, select: { shopDraftJson: true } });
    if (!r) throw new AgentCopyError("Product not found");
    const info = readShopDraft(r.shopDraftJson);
    const now = new Date().toISOString();
    const clean = text.trim();
    const list = info?.problems ?? [];
    const oldStaff = new Map(list.filter((p) => p.source === "staff").map((p) => [problemKey(p.text), p]));
    const staff: PrepProblem[] = noteItems(clean).map((t) => oldStaff.get(problemKey(t)) ?? { text: t, level: "fix", part: 0, at: now, source: "staff", by });
    const problems = [...staff, ...list.filter((p) => p.source !== "staff")];
    const asideCount = problems.filter((p) => p.asideAt).length;
    const noteCount = staff.filter((p) => !p.asideAt).length;
    const removed = [...oldStaff.values()].filter((p) => !staff.some((x) => problemKey(x.text) === problemKey(p.text)));
    const closed = removed.length ? withClosed(info, removed, by, "removed") : info?.closed;
    await prisma.invProduct.update({
        where: { id },
        data: { shopDraftJson: { ...info, closed, staffNote: clean ? { text: clean, by, at: now } : undefined, staffNotes: undefined, problems: problems.length ? problems : undefined, asideCount: asideCount || undefined, noteCount: noteCount || undefined } as never },
    });
    return { staffNote: clean ? { text: clean, by, at: now } : null, problems };
}

/**
 * A run fixed these open problems (any source — AI, staff {…}, set aside): they
 * leave the list and the Attention reason; a staff one turns into "✓ …" in the
 * note so it is not picked up again. Text not on the list comes back in `unknown`.
 */
export async function markFixed(id: number, texts: string[]) {
    const r = await prisma.invProduct.findUnique({ where: { id }, select: { shopAttention: true, shopDraftJson: true } });
    if (!r) throw new AgentCopyError("Product not found");
    const info = readShopDraft(r.shopDraftJson);
    const keys = new Set(texts.map(problemKey));
    const list = info?.problems ?? [];
    const gone = list.filter((p) => keys.has(problemKey(p.text)));
    const problems = list.filter((p) => !keys.has(problemKey(p.text)));
    let note = info?.staffNote;
    for (const p of gone.filter((x) => x.source === "staff")) {
        if (note) note = { ...note, text: note.text.replace(/\{([^{}]+)\}/g, (m, inner: string) => (problemKey(inner) === problemKey(p.text) ? `✓ ${inner.trim()}` : m)) };
    }
    const attention = r.shopAttention?.split("\n").filter((l) => !(OPEN_LINE.test(l.trim()) && keys.has(problemKey(l)))).join("\n") ?? null;
    await prisma.invProduct.update({
        where: { id },
        data: {
            shopDraftJson: { ...info, closed: gone.length ? withClosed(info, gone, "AI", "fixed") : info?.closed, staffNote: note, problems: problems.length ? problems : undefined, asideCount: problems.filter((p) => p.asideAt).length || undefined, noteCount: problems.filter((p) => p.source === "staff" && !p.asideAt).length || undefined } as never,
            shopAttention: attention,
        },
    });
    const found = new Set(gone.map((p) => problemKey(p.text)));
    return { fixed: gone.map((p) => p.text), unknown: texts.filter((t) => !found.has(problemKey(t))), open: problems };
}

/**
 * Every product with an open problem whose words match `q` (all words, any
 * order; empty = every product with one) — "check the open problems that say
 * box back". Reads only rows that have problems.
 */
export async function findProblems(q: string, limit = 200) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = await prisma.invProduct.findMany({
        where: { OR: [{ shopStatus: "ATTENTION" }, { shopDraftJson: { path: ["asideCount"], gt: 0 } }, { shopDraftJson: { path: ["noteCount"], gt: 0 } }] },
        select: { id: true, sku: true, name: true, shopStatus: true, shopAttention: true, shopDraftJson: true },
        orderBy: { id: "desc" },
    });
    const out = [];
    for (const r of rows) {
        const info = readShopDraft(r.shopDraftJson);
        const list: { text: string; level: string; source: string; aside: boolean }[] = (info?.problems ?? []).length
            ? info!.problems!.map((p) => ({ text: p.text, level: p.level, source: p.source === "staff" ? `staff (${p.by ?? "?"})` : `part ${p.part}`, aside: !!p.asideAt }))
            : (r.shopAttention ?? "").split("\n").filter((l) => OPEN_LINE.test(l.trim())).map((l) => ({ text: openText(l), level: /^NOTE/.test(l.trim()) ? "fix" : "stop", source: "attention", aside: false }));
        const hits = list.filter((p) => words.every((w) => p.text.toLowerCase().includes(w)));
        if (hits.length) out.push({ sku: r.sku, id: r.id, name: r.name, stage: r.shopStatus, problems: hits });
        if (out.length >= limit) break;
    }
    return { count: out.length, products: out };
}
