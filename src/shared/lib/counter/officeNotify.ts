import "server-only";
import { z } from "zod";
import { WRITE_API_URL, shouldWriteLocal } from "@/shared/lib/prisma/counterMode";
import { ACTING_USER_HEADER, COUNTER_KEY_REFUSED } from "@/shared/lib/auth/counterRelayAuth";
import { counterAuthorization, forgetCounterKey } from "./relayKey";
import type { NotifyResult } from "@/shared/lib/whatsapp/notifyBill";

/**
 * A counter asks the office to send a customer message.
 *
 * A counter holds no Meta / push / email keys, so it never sends itself. Under
 * `WRITE_MODE=v_live` the save runs at the office, which sends. Under `live` the save
 * runs here, straight into Supabase — so after it, the counter asks the office to send
 * for that document (`POST /api/counter/notify`). The office decides everything:
 * posted or not, Auto send, template, customer, and once per document.
 */

/** Its own header, not `Authorization`: the proxy turns that one into a session. */
export const COUNTER_KEY_HEADER = "x-abeer-counter-key";

const id = z.number().int().positive();
const kind = z.string().min(1).max(80);
export const officeNotifySchema = z.discriminatedUnion("what", [
    z.object({ what: z.literal("bill"), kind, id, manual: z.boolean().optional() }),
    z.object({ what: z.literal("bill-email"), kind, id }),
    z.object({ what: z.literal("repair"), kind: z.enum(["REPAIR_RECEIVED", "REPAIR_READY"]), id, manual: z.boolean().optional() }),
    z.object({ what: z.literal("deal"), id }),
    z.object({ what: z.literal("help"), id }),
    z.object({ what: z.literal("ticket-wa"), kind, id }),
    z.object({ what: z.literal("ticket-email"), kind, id }),
]);
export type OfficeNotifyJob = z.infer<typeof officeNotifySchema>;

const TIMEOUT_MS = 30_000;
/** Waits before each try. Staff waiting on a button get the short list. */
const AUTO_WAITS_MS = [0, 3_000, 15_000, 40_000];
const MANUAL_WAITS_MS = [0, 2_000];

const skipped = (reason: string): NotifyResult => ({ status: "skipped", reason });

/** Never throws. A repeat is safe: the office sends once per document. */
export async function askOffice(job: OfficeNotifyJob, opts: { staffWaiting?: boolean } = {}): Promise<NotifyResult> {
    try {
        // Saved on the replica (outage, or WRITE_MODE=local): the office does not have it yet.
        if (shouldWriteLocal() || !WRITE_API_URL) return skipped("counter");

        // Loaded here: `@/auth` at module level would pull sign-in into every sender.
        const { auth } = await import("@/auth");
        const user = (await auth())?.user as { id?: string | number; permissions?: string[]; roleLabel?: string } | undefined;
        // The env super admin is not a database user, so the office cannot check them.
        const envAdmin = user?.roleLabel === "Super Admin" && user.permissions?.includes("admin:bypass");
        if (!user?.id || envAdmin) return skipped("counter");

        for (const wait of opts.staffWaiting ? MANUAL_WAITS_MS : AUTO_WAITS_MS) {
            if (wait) await new Promise((r) => setTimeout(r, wait));
            const result = await tryOnce(job, String(user.id));
            if (result) return result;
        }
        console.error(`[office-notify] ${job.what} ${job.id}: office did not answer — message not sent.`);
        return skipped("office not reachable");
    } catch (e) {
        console.error(`[office-notify] ${job.what} ${job.id} failed`, e);
        return skipped("error");
    }
}

/** The office's answer, or null when it is worth another try. */
async function tryOnce(job: OfficeNotifyJob, userId: string): Promise<NotifyResult | null> {
    const key = await counterAuthorization();
    if (!key) return skipped("counter");
    let res: Response;
    let body: { status?: NotifyResult["status"]; reason?: string; error?: string; code?: string } | null;
    try {
        res = await fetch(new URL("/api/counter/notify", WRITE_API_URL!), {
            method: "POST",
            headers: { "content-type": "application/json", [COUNTER_KEY_HEADER]: key, [ACTING_USER_HEADER]: userId },
            body: JSON.stringify(job),
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        body = await res.json().catch(() => null);
    } catch (e) {
        console.warn(`[office-notify] ${job.what} ${job.id}:`, e instanceof Error ? e.message : e);
        return null;
    }
    if (res.ok && body?.status) return { status: body.status, reason: body.reason };
    if (res.status >= 500 || res.status === 429) return null;
    if (body?.code === COUNTER_KEY_REFUSED) forgetCounterKey();
    console.error(`[office-notify] ${job.what} ${job.id}: office answered ${res.status} ${body?.error ?? ""}`);
    return skipped(res.status === 404 ? "office app is older than this counter" : "office refused");
}
