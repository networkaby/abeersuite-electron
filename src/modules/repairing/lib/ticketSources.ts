// Catalog of ticket-data SOURCES an argument can bind to (client-safe — no prisma).
// A Work argument's `source` is either one of these paths (resolved LIVE from the
// ticket and shown read-only) or "user" (collected from the operator at completion).

export const USER_SOURCE = "user";

// A "context.<key>" source pulls a value a PREVIOUS worker produced (saved into
// Ticket.context at completion). This is how an outcome variable flows downstream:
// the producer's ask-arg `key` becomes the variable name, a later Work's supply arg
// reads it back via `context.<key>`. See resolveTicketSource below.
export const CONTEXT_PREFIX = "context.";
export const contextSource = (key: string) => `${CONTEXT_PREFIX}${key}`;
export const isContextSource = (source: string): boolean => source.startsWith(CONTEXT_PREFIX);

export const TICKET_SOURCES: { value: string; label: string; group: string }[] = [
    { value: "customer.name", label: "Customer name", group: "Customer" },
    { value: "customer.phone", label: "Customer phone", group: "Customer" },
    { value: "customer.email", label: "Customer email", group: "Customer" },
    { value: "device.type", label: "Device type", group: "Device" },
    { value: "device.brand", label: "Device brand", group: "Device" },
    { value: "device.model", label: "Device model", group: "Device" },
    { value: "device.problem", label: "Problem", group: "Device" },
    { value: "ticket.id", label: "Ticket #", group: "Ticket" },
    { value: "ticket.status", label: "Status", group: "Ticket" },
    // "Latest" meta sources — the most recent value of each kind on the ticket, wherever
    // it came from (not necessarily the immediately-previous step). Resolved from the
    // ticket's LOGS by the Work Inbox builder (not resolveTicketSource, which has no log
    // access). prevOutcome = last completion stamp; lastNote = latest human note.
    { value: "meta.prevOutcome", label: "Previous outcome", group: "Latest" },
    { value: "meta.lastNote", label: "Last note (instruction)", group: "Latest" },
    { value: USER_SOURCE, label: "Ask the helper", group: "Input" },
];

// Meta sources show on the Work Inbox card but resolve from the ticket LOGS, not its
// fields — the inbox builder fills them; resolveTicketSource returns null for them.
export const META_PREV_OUTCOME = "meta.prevOutcome";
export const META_LAST_NOTE = "meta.lastNote";

export type WorkArg = {
    key: string;
    label: string;
    source: string;             // a TICKET_SOURCES value, or USER_SOURCE
    kind?: "text" | "number";   // for user-given args (the input type)
    on?: "success" | "fail" | "always";  // user-given args: collect only on this outcome
};

export const isUserArg = (a: WorkArg): boolean => a.source === USER_SOURCE;

// Does a user-given arg apply to the outcome the operator pressed?
// kind: "Success" | "Unsuccess" | "Done" (the pending dialog's kind).
export function argMatchesOutcome(a: WorkArg, kind: string): boolean {
    const on = a.on ?? "always";
    if (on === "always") return true;
    if (on === "success") return kind === "Success";
    if (on === "fail") return kind === "Unsuccess";
    return false;
}

// slugify a label → a stable key for context storage (when no explicit key).
export const argKey = (a: WorkArg): string =>
    (a.key && a.key.trim()) || a.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "arg";

// A minimal shape the resolver reads from. Accepts EITHER a flattened account
// ({ name, phone, email } — what the ticket page already holds) OR the raw
// person/company relations — whichever is present wins.
export type TicketLike = {
    id: number;
    status?: string;
    ticketStatus?: { label?: string | null } | null;
    // Global variable bag — outcomes previous workers saved (flat key → value).
    context?: Record<string, unknown> | null;
    device?: {
        type?: string | null; brand?: string | null; model?: string | null; problem?: string | null;
        account?: {
            name?: string | null; phone?: string | null; email?: string | null;
            person?: { name?: string | null; phones?: { phone: string }[] | null; emails?: { email: string }[] | null } | null;
            company?: { name?: string | null; phones?: { phone: string }[] | null; emails?: { email: string }[] | null } | null;
        } | null;
    } | null;
};

// Resolve a bound source to a display string against a ticket. Returns null for
// USER_SOURCE (those are collected, not read) or when the value is absent.
export function resolveTicketSource(source: string, t: TicketLike): string | null {
    if (source === USER_SOURCE) return null;
    // Outcome variable from an earlier worker (Ticket.context["<key>"]).
    if (isContextSource(source)) {
        const v = t.context?.[source.slice(CONTEXT_PREFIX.length)];
        return v == null || v === "" ? null : String(v);
    }
    const acct = t.device?.account;
    const party = acct?.person ?? acct?.company ?? null;
    switch (source) {
        case "customer.name": return acct?.name ?? party?.name ?? null;
        case "customer.phone": return acct?.phone ?? party?.phones?.[0]?.phone ?? null;
        case "customer.email": return acct?.email ?? party?.emails?.[0]?.email ?? null;
        case "device.type": return t.device?.type ?? null;
        case "device.brand": return t.device?.brand ?? null;
        case "device.model": return t.device?.model ?? null;
        case "device.problem": return t.device?.problem ?? null;
        case "ticket.id": return `#${t.id}`;
        case "ticket.status": return t.ticketStatus?.label ?? t.status ?? null;
        default: return null;
    }
}

export function parseArgs(raw: unknown): WorkArg[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((a): a is WorkArg => !!a && typeof a === "object" && typeof (a as WorkArg).source === "string")
        .map((a) => ({ key: a.key ?? "", label: a.label ?? "", source: a.source, kind: a.kind === "number" ? "number" : "text", on: a.on ?? "always" }));
}

// The catalog of outcome variables that can be CONSUMED downstream: every "ask"
// (user) arg across all works produces a value in Ticket.context keyed by argKey().
// Returns de-duped { key, label } pairs for the supply-source picker.
export function outcomeVariables(works: { args?: unknown }[]): { key: string; label: string }[] {
    const seen = new Map<string, string>();
    for (const w of works) {
        for (const a of parseArgs(w.args)) {
            if (!isUserArg(a)) continue;
            const k = argKey(a);
            if (!seen.has(k)) seen.set(k, a.label || k);
        }
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
}
