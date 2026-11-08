/**
 * Ticket timelines (help, repair, deal) hold one TicketLog per WhatsApp
 * message, written as "💬 WhatsApp (Name): text" / "💬 WhatsApp (Staff - Name): text".
 * This folds a sender's back-to-back lines into one run so each screen can
 * show them as one card: name once, each message with its time. A different
 * sender, a non-WhatsApp entry or a 30-minute gap starts a new run.
 * Display only — the saved note keeps its prefix. Client-safe (no server code).
 */

/** The fields a timeline line needs; every ticket kind's log row has them. */
export type ChatLogLike = { id: number; note?: string | null; body?: string | null; createdAt: string | Date; author?: unknown };

export type ChatRun<L> = {
    kind: "chat";
    key: string;
    name: string;
    /** Written by our side (staff or the app), not the customer. */
    staff: boolean;
    /** Sent by the app itself (auto-reply, bill, ticket menu) — no person wrote it. */
    auto: boolean;
    lines: { log: L; text: string }[];
};
export type TimelineItem<L> = { kind: "log"; log: L } | ChatRun<L>;

/** A new card starts after this much quiet between two lines of a run. */
const RUN_GAP_MS = 30 * 60 * 1000;
const WA_PREFIX = /^💬 WhatsApp \((Staff - )?([^)]*)\):\s?/;

/** Name the app writes under for messages it sends by itself. */
export const AUTO_SENDER = "System";

/** Timeline in the order given (newest first on every screen today). */
export function groupTicketChat<L extends ChatLogLike>(logs: L[]): TimelineItem<L>[] {
    const out: TimelineItem<L>[] = [];
    let run: ChatRun<L> | null = null;
    let lastAt = 0;
    for (const log of logs) {
        const note = log.note ?? log.body ?? "";
        const a = (log.author ?? null) as { channel?: string; userName?: string } | null;
        const m = a?.channel === "WHATSAPP" ? note.match(WA_PREFIX) : null;
        if (!m) { out.push({ kind: "log", log }); run = null; continue; }
        const staff = !!m[1];
        const name = m[2] || a?.userName || "Customer";
        const at = new Date(log.createdAt).getTime();
        const text = note.slice(m[0].length);
        if (run && run.staff === staff && run.name === name && Math.abs(lastAt - at) <= RUN_GAP_MS) {
            run.lines.push({ log, text });
        } else {
            run = { kind: "chat", key: `chat-${log.id}`, name, staff, auto: staff && name === AUTO_SENDER, lines: [{ log, text }] };
            out.push(run);
        }
        lastAt = at;
    }
    return out;
}

/** "20:35" — the time shown beside each message of a run. */
export function chatLineTime(at: string | Date): string {
    return new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
