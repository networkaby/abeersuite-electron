import type { HelpLogDto } from "./types";

/** Lines from one WhatsApp sender in a row, shown as one card. */
export type ChatRun = { kind: "chat"; key: string; name: string; staff: boolean; lines: { log: HelpLogDto; text: string }[] };
export type TimelineItem = { kind: "log"; log: HelpLogDto } | ChatRun;

/** A new card starts after this much quiet between two lines of a run. */
const RUN_GAP_MS = 30 * 60 * 1000;
const WA_PREFIX = /^💬 WhatsApp \((Staff - )?([^)]*)\):\s?/;

/**
 * Folds the timeline (newest first) so a sender's back-to-back WhatsApp lines
 * share one card: name once, each message on its own line with its time. A
 * different sender, a non-WhatsApp entry or a 30-minute gap starts a new card.
 * Display only — the saved note keeps its "💬 WhatsApp (Name):" prefix.
 */
export function groupTimeline(logs: HelpLogDto[]): TimelineItem[] {
    const out: TimelineItem[] = [];
    let run: ChatRun | null = null;
    let lastAt = 0;
    for (const log of logs) {
        const m = (log.author as { channel?: string } | null)?.channel === "WHATSAPP" ? log.note?.match(WA_PREFIX) : null;
        if (!m) { out.push({ kind: "log", log }); run = null; continue; }
        const staff = !!m[1];
        const name = m[2] || log.author?.userName || "Customer";
        const at = new Date(log.createdAt).getTime();
        const text = log.note!.slice(m[0].length);
        if (run && run.staff === staff && run.name === name && Math.abs(lastAt - at) <= RUN_GAP_MS) {
            run.lines.push({ log, text });
        } else {
            run = { kind: "chat", key: `chat-${log.id}`, name, staff, lines: [{ log, text }] };
            out.push(run);
        }
        lastAt = at;
    }
    return out;
}
