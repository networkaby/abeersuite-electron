/**
 * Did Meta refuse a message, or do we not know? The one place that decides.
 *
 *  - `refused` — Meta said no in a readable 4xx, or we never called it. Nothing
 *    went out, so another number (or another shape) may be tried.
 *  - `unclear` — timeout, dropped connection, 5xx, unreadable reply, a 200
 *    without a message id, Meta's "unknown / temporary" errors. The customer may
 *    have the message, so nothing more is sent automatically.
 *
 * Pure (no server-only): the screens read the wording, the tests fake `fetch`.
 */
import { WA_SEND_TIMEOUT_MS } from "@/shared/lib/constants/whatsapp";

export const WA_UNCLEAR_TEXT =
    "Not sure if it reached — WhatsApp did not confirm. Check with the customer before sending again.";

/** A Graph call failed; `message` is safe to show staff. Unclear unless proven refused. */
export class MetaApiError extends Error {
    override name = "MetaApiError";
    readonly outcome: "refused" | "unclear";
    constructor(message: string, outcome: "refused" | "unclear" = "unclear") {
        super(message);
        this.outcome = outcome;
    }
}

/** Anything that is not a proven refusal is unclear. */
export const isWaRefused = (e: unknown): boolean => e instanceof MetaApiError && e.outcome === "refused";

const unclear = (detail: string) => new MetaApiError(`${WA_UNCLEAR_TEXT} (${detail})`.slice(0, 500));

type SendReply = {
    messages?: { id?: string }[];
    error?: { message?: string; error_user_msg?: string; code?: number; is_transient?: boolean };
};

/** Meta's "something went wrong / try later" codes — they come as 4xx too, and prove nothing. */
const UNSURE_CODES = new Set([1, 2, 131000, 131016]);

/** POST one message; Meta's message id, or a MetaApiError carrying the outcome. */
export async function postWaMessage(url: string, token: string, body: unknown): Promise<string> {
    let status: number;
    let text: string;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
            signal: AbortSignal.timeout(WA_SEND_TIMEOUT_MS),
        });
        status = res.status;
        text = await res.text();
    } catch (e) {
        throw unclear(e instanceof Error ? e.message : String(e));
    }
    let json: SendReply | null = null;
    try {
        json = JSON.parse(text);
    } catch {
        /* unreadable — unclear below */
    }
    const id = json?.messages?.[0]?.id;
    if (status >= 200 && status < 300 && !json?.error && id) return id;

    const err = json?.error;
    const why = err?.error_user_msg || err?.message || "";
    const refused =
        status >= 400 && status < 500 && status !== 408 &&
        typeof err?.code === "number" && !UNSURE_CODES.has(err.code) && !err.is_transient;
    if (refused) throw new MetaApiError(why || `Meta refused it (${status}, code ${err.code})`, "refused");
    throw unclear(`Meta answered ${status}${why || text ? `: ${why || text.slice(0, 200)}` : ""}`);
}

/** Outcome of a WhatsApp send as saved in `waStatus` / `waError`. */
export type WaOutcome = { status: string; messageId?: string; error?: string };

/** Send; on a proven refusal try `others` in turn. The first unclear result ends it.
 *  All refused → the first refusal's reason. */
export async function sendWithFallback(
    first: () => Promise<string>,
    others: () => Promise<(() => Promise<string>)[]> = async () => [],
): Promise<WaOutcome> {
    const attempt = async (send: () => Promise<string>): Promise<WaOutcome> => {
        try {
            return { status: "sent", messageId: await send() };
        } catch (e) {
            const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
            return { status: isWaRefused(e) ? "failed" : "unclear", error };
        }
    };
    const start = await attempt(first);
    if (start.status !== "failed") return start;
    for (const send of await others()) {
        const next = await attempt(send);
        if (next.status !== "failed") return next;
    }
    return start;
}

/** What staff read when a message was processed but its WhatsApp did not clearly go; else null. */
export function waProblem(wa: string | null | undefined): string | null {
    if (wa === "unclear" || wa === "pending") return WA_UNCLEAR_TEXT;
    return wa === "failed" ? "WhatsApp refused the message — it was not sent." : null;
}
