import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parsePagination } from "@/shared/lib/api";
import {
    phoneMatchKey, phoneKeyVariants, normalizeDialedNumber, readCallerNumber, partialCliPrefix,
} from "@/shared/lib/format";
import { isMissedCall, MISSED_CALL_WHERE, parseMissedMode } from "@/shared/lib/calls";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { Prisma } from "@/generated/prisma/client";
import type { CallDirection } from "@/generated/prisma/client";
import { splitExtensions } from "@/shared/lib/counter/idRange";

// ── /api/calls ────────────────────────────────────────────────────────────────
//
// POST — machine endpoint. The epbx-bridge (Matrix SMDR) POSTs one call record
// here with `x-api-key`. We normalize the number, de-duplicate on the raw SMDR
// line (bridge retries / a second PC / buffered replays all resend the same
// line), stamp occurredAt from the record's own date+time, and store it.
//
// GET — staff list for the CRM Call Log page (/office/crm/call-log). Reverse-
// matches each call's number to a customer with one index-backed IN query.

// The bridge sends the parsed SMDR record (server.js parseOG / parseIC /
// parseInternal) plus `timestamp` and `raw`. All fields optional except callType;
// an UNKNOWN line carries only callType + raw.
const callPayloadSchema = z.object({
    callType: z.enum(["INCOMING", "OUTGOING", "INTERNAL", "UNKNOWN"]),
    serial: z.string().trim().optional(),
    fromExt: z.string().trim().optional(),
    toExt: z.string().trim().optional(),
    connectedExt: z.string().trim().optional(),
    trunk: z.string().trim().optional(),
    dialedNumber: z.string().trim().optional(),
    callerNumber: z.string().trim().optional(),
    date: z.string().trim().optional(),
    time: z.string().trim().optional(),
    duration: z.coerce.number().finite().nonnegative().optional(),
    speechDuration: z.coerce.number().finite().nonnegative().optional(),
    answerDuration: z.coerce.number().finite().nonnegative().optional(),
    holdDuration: z.coerce.number().finite().nonnegative().optional(),
    units: z.coerce.number().finite().nonnegative().optional(),
    amount: z.coerce.number().finite().optional(),
    status: z.string().trim().optional(),
    timestamp: z.string().trim().optional(),
    // Strip control characters before this ever reaches Postgres: a text column
    // rejects a literal NUL outright, which surfaced as HTTP 500 (and a retry
    // storm) when a port scanner sent a TLS handshake at the bridge. Genuine
    // SMDR is printable ASCII, so this is a no-op for real records. Applied
    // before the de-dupe uses `raw` as its key, so the key stays consistent.
    raw: z.string().optional().transform((v) => v?.replace(/[\u0000-\u001F\u007F]/g, "")),
    // Hostname of the counter PC whose bridge pushed this record. Optional — an
    // older bridge that predates the field simply sends nothing.
    sourceHost: z.string().trim().max(255).optional(),
});

type CallPayload = z.infer<typeof callPayloadSchema>;

/**
 * Parse the SMDR record's own date + time into an absolute instant (IST). Two
 * formats appear: `29-04-26` (OG/IC, 2-digit year) and `29-04-2026` (internal).
 * Returns null when unparseable so the caller can fall back to receive-time.
 */
function parseOccurredAt(date?: string, time?: string): Date | null {
    if (!date || !time) return null;
    const dm = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/.exec(date);
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    if (!dm || !tm) return null;
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    const year = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
    const hh = Number(tm[1]);
    const mm = Number(tm[2]);
    const ss = tm[3] ? Number(tm[3]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 59) return null;
    const p2 = (n: number) => String(n).padStart(2, "0");
    // Build an IST-offset ISO string; the Date is stored/served in UTC.
    const iso = `${year}-${p2(month)}-${p2(day)}T${p2(hh)}:${p2(mm)}:${p2(ss)}+05:30`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

function mapPayloadToCall(p: CallPayload, occurredAt: Date, receivedAt: Date): Prisma.CallCreateInput {
    const sent = p.callType === "OUTGOING" ? p.dialedNumber : p.callType === "INCOMING" ? p.callerNumber : undefined;
    // Normalise "no number" to NULL. The PBX sends the field as spaces (trimmed
    // to "") when CLI wasn't delivered or an outgoing call went unanswered, and
    // `?? null` would keep that empty string — leaving two different spellings
    // of "absent" in the column and breaking any `rawNumber: null` filter.
    const rawNumber = sent?.trim() || null;
    return {
        direction: p.callType as CallDirection,
        // An outgoing dial string carries stray keypresses at the END, where the
        // last-10 rule would slide off the number — clean it first so a callback
        // keys to the same customer as the incoming call it answers.
        phone: phoneMatchKey(p.callType === "OUTGOING" ? normalizeDialedNumber(rawNumber) : rawNumber),
        rawNumber,
        fromExt: p.fromExt ?? null,
        // Incoming: the extension that answered is `connectedExt`.
        toExt: p.callType === "INCOMING" ? (p.connectedExt ?? null) : (p.toExt ?? null),
        trunk: p.trunk ?? null,
        serial: p.serial ?? null,
        status: p.status ?? null,
        durationSec: Math.round(p.duration ?? 0),
        speechSec: Math.round(p.speechDuration ?? 0),
        answerSec: Math.round(p.answerDuration ?? 0),
        holdSec: Math.round(p.holdDuration ?? 0),
        amount: p.amount != null ? new Prisma.Decimal(p.amount) : null,
        units: p.units != null ? Math.round(p.units) : null,
        occurredAt,
        receivedAt,
        raw: p.raw ?? null,
        sourceHost: p.sourceHost ?? null,
        note: null,
    };
}

/**
 * A second PC pushed a call we already have. Record its hostname in the winner's
 * `alsoPushedBy` list so a bridge that runs but never wins the race is still
 * visible for troubleshooting. Best-effort and deliberately un-transactional:
 * this is read-only diagnostics, so a lost concurrent update costs nothing and
 * must never fail the caller's request.
 */
async function noteLosingPusher(
    existing: { id: number; sourceHost: string | null; alsoPushedBy: unknown },
    host: string | undefined,
): Promise<void> {
    const name = host?.trim();
    if (!name || name === existing.sourceHost) return;
    const current = Array.isArray(existing.alsoPushedBy)
        ? (existing.alsoPushedBy as unknown[]).filter((h): h is string => typeof h === "string")
        : [];
    if (current.includes(name)) return;
    await prisma.call
        .update({ where: { id: existing.id }, data: { alsoPushedBy: [...current, name] } })
        .catch(() => { /* diagnostics only — never break the push */ });
}

export async function POST(req: Request) {
    // Shared-secret gate (mirrors src/app/api/shop/delivery-updates). Accept when
    // the env is unset (dev), reject on mismatch.
    const expected = process.env.CALLS_API_KEY?.trim();
    if (expected) {
        const got = req.headers.get("x-api-key")?.trim();
        if (got !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data, error } = await validateRequest(req, callPayloadSchema);
    if (error) return error;

    // Every genuine SMDR record is stored, including ones the PBX sent with no
    // number — call-volume and per-extension workload stats are only correct if
    // nothing is silently dropped. Two cases legitimately arrive numberless and
    // must NOT be discarded:
    //   • INCOMING where the trunk didn't deliver CLI (~10% here).
    //   • OUTGOING unanswered — the Matrix only commits the dialled digits once
    //     the call is answered, so every unanswered outgoing call is numberless
    //     by design. Dropping them would erase the whole no-answer signal.
    // The Call Log hides numberless external calls behind a toggle instead, so
    // the list stays actionable without the data being lost. Scanner junk is
    // filtered upstream in epbx.js, so nothing bogus reaches here.

    try {
        const receivedAt = data.timestamp ? new Date(data.timestamp) : new Date();
        const safeReceivedAt = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;
        const occurredAt = parseOccurredAt(data.date, data.time) ?? safeReceivedAt;

        // Idempotency. The same call reaches us many ways — bridge retries, the
        // same installer on every PC pushing at once, buffered replays — all with
        // the identical `raw` SMDR line. Two guards: (1) a fast pre-check that
        // returns the existing row, and (2) the DB `@unique` on `raw` that makes
        // it race-proof when concurrent PCs slip past the pre-check. Skip only when
        // the (old) bridge sent no raw line.
        const rawLine = data.raw?.trim();
        if (rawLine) {
            // findFirst (not findUnique): works whether or not `raw` carries the DB
            // unique constraint yet. Race-proofing comes from the INSERT + P2002
            // catch below once the @unique is pushed.
            const existing = await prisma.call.findFirst({ where: { raw: rawLine }, select: { id: true, sourceHost: true, alsoPushedBy: true } });
            if (existing) {
                await noteLosingPusher(existing, data.sourceHost);
                return NextResponse.json({ success: true, id: existing.id, duplicate: true });
            }
        }

        const createData = mapPayloadToCall(data, occurredAt, safeReceivedAt);

        // Spam is a property of the NUMBER: inherit a prior spam flag so calls from
        // an already-flagged number arrive pre-flagged (kept, hidden from CRM).
        if (createData.phone) {
            const flagged = await prisma.call.findFirst({
                where: { phone: createData.phone, spam: true },
                select: { id: true },
            });
            if (flagged) createData.spam = true;
        }

        try {
            const created = await prisma.call.create({ data: createData, select: { id: true } });
            // This insert bypassed the browser entirely (the bridge posted straight
            // here), so it never rides `attachChangePublisher`'s axios interceptor —
            // publish it ourselves so the counter's call follow-up popup notices
            // instantly instead of waiting on its fallback poll. Fire-and-forget:
            // never hold the bridge's response up on the realtime round-trip.
            void publishChangeServer(["tickets"]);
            return NextResponse.json({ success: true, id: created.id }, { status: 201 });
        } catch (e) {
            // Lost the race: another PC inserted the same raw line between our
            // pre-check and this insert. The unique constraint caught it — treat
            // as a duplicate, not an error. Check `.code` directly (not just
            // instanceof — that can fail across a module boundary in dev; see
            // modules/customer/lib/contactWrite.ts).
            if ((e as { code?: string })?.code === "P2002") {
                const dup = rawLine
                    ? await prisma.call.findFirst({ where: { raw: rawLine }, select: { id: true, sourceHost: true, alsoPushedBy: true } })
                    : null;
                if (dup) await noteLosingPusher(dup, data.sourceHost);
                return NextResponse.json({ success: true, id: dup?.id ?? null, duplicate: true });
            }
            throw e;
        }
    } catch (e) {
        return handleApiError(e, "Failed to record call");
    }
}

const DIRECTIONS = ["INCOMING", "OUTGOING", "INTERNAL", "UNKNOWN"] as const;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const sp = new URL(req.url).searchParams;
        const { take, skip, page } = parsePagination(sp);

        const parsedDir = z.enum(DIRECTIONS).safeParse(sp.get("direction"));
        const spam = sp.get("spam"); // "1" only spam, "0"/absent excludes spam
        const missedMode = parseMissedMode(sp.get("missed")); // all | only | exclude
        const search = sp.get("search")?.trim() ?? "";
        // Which extension answered/dialled — the counter follow-up popup's own
        // lookup, matching either side (an outgoing callback dials FROM the
        // counter's extension; an incoming call is answered TO it). A counter may
        // sit at several extensions, so this accepts a comma-separated list.
        const exts = splitExtensions(sp.get("ext"));
        // Filter by normalized phone key (for showing an unknown caller's call log).
        const phoneKey = sp.get("phone")?.trim();
        // Never triaged: no note (not even a dismissal) and no linked ticket/deal.
        const unhandled = sp.get("unhandled") === "1";
        // Drop calls a number has already been answered about. See applyLoggedCutoff
        // below — the counter follow-up popup asks for this; the CRM Call Log does
        // not, because there nothing may ever be hidden from view.
        const sinceLastLogged = sp.get("sinceLastLogged") === "1";

        const and: Prisma.CallWhereInput[] = [];
        if (phoneKey) and.push({ phone: phoneKey });
        else if (exts.length) and.push({ OR: [{ toExt: { in: exts } }, { fromExt: { in: exts } }] });
        if (unhandled) and.push({ note: null, ticketId: null });
        if (parsedDir.success) {
            and.push({ direction: parsedDir.data });
        } else if (sp.get("direction") !== "all") {
            // Default view hides internal ext↔ext chatter.
            and.push({ direction: { not: "INTERNAL" } });
        }
        if (spam === "1") and.push({ spam: true });
        else and.push({ spam: false });

        // Numberless calls are stored (see POST) but hidden by default: you can't
        // call back or identify a caller with no number, so they'd only clutter
        // the working list. `noNumber=1` brings them back for volume and
        // no-answer analysis. Covers OUTGOING/INCOMING (blank CLI) and UNKNOWN
        // (unclassified lines — scanner junk, or a PBX record shape we don't
        // recognise yet) alike, since none of them carry a usable number.
        // INTERNAL is unaffected — ext↔ext calls never carry an outside number,
        // so folding it into this filter would wrongly hide the lot regardless
        // of the toggle.
        if (sp.get("noNumber") !== "1") {
            and.push({
                NOT: {
                    AND: [
                        { direction: { in: ["INCOMING", "OUTGOING", "UNKNOWN"] } },
                        // Both spellings of "absent": NULL, and the empty string
                        // older rows were written with before normalisation.
                        { OR: [{ rawNumber: null }, { rawNumber: "" }] },
                    ],
                },
            });
        }

        // Date range on the call's own occurredAt (IST wall-clock, as the PBX
        // recorded it). `from`/`to` are yyyy-mm-dd; `to` is inclusive of that
        // whole day, so a same-day from==to returns that day's calls.
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const from = sp.get("from")?.trim();
        const to = sp.get("to")?.trim();
        if (from && dayRe.test(from)) and.push({ occurredAt: { gte: new Date(`${from}T00:00:00+05:30`) } });
        if (to && dayRe.test(to)) and.push({ occurredAt: { lte: new Date(`${to}T23:59:59.999+05:30`) } });
        // Miscall tri-state: only → just miscalls; exclude → hide them; all → no-op.
        if (missedMode === "only") and.push(MISSED_CALL_WHERE);
        else if (missedMode === "exclude") and.push({ NOT: MISSED_CALL_WHERE });
        if (search) {
            // Search matches the number, the note, OR a customer name — for a name
            // hit we resolve those customers' phones to match-keys and pull their
            // calls (calls carry no name, so this is the only way name search works).
            const [persons, companies] = await Promise.all([
                prisma.person.findMany({
                    where: { name: { contains: search, mode: "insensitive" } },
                    select: { phones: { select: { phone: true } } },
                    take: 100,
                }),
                prisma.company.findMany({
                    where: { name: { contains: search, mode: "insensitive" } },
                    select: { phones: { select: { phone: true } } },
                    take: 100,
                }),
            ]);
            const nameKeys = new Set<string>();
            for (const c of [...persons, ...companies]) {
                for (const ph of c.phones) {
                    const k = phoneMatchKey(ph.phone);
                    if (k) nameKeys.add(k);
                }
            }
            const or: Prisma.CallWhereInput[] = [
                { rawNumber: { contains: search } },
                { phone: { contains: search } },
                { note: { contains: search, mode: "insensitive" } },
            ];
            if (nameKeys.size) or.push({ phone: { in: [...nameKeys] } });
            and.push({ OR: or });
        }

        const where: Prisma.CallWhereInput = and.length ? { AND: and } : {};

        const [total, calls] = await Promise.all([
            prisma.call.count({ where }),
            prisma.call.findMany({ where, orderBy: { occurredAt: "desc" }, take, skip }),
        ]);

        // Reverse-match: one index-backed IN query over every format variant of the
        // page's keys, then map rows → owners in app code.
        const keys = Array.from(new Set(calls.map((c) => c.phone).filter((p): p is string => !!p)));
        const ownerByKey = new Map<string, { kind: "person" | "company"; id: number; name: string }>();
        if (keys.length) {
            const variants = keys.flatMap(phoneKeyVariants);
            const phoneRows = await prisma.phone.findMany({
                where: { phone: { in: variants } },
                select: {
                    phone: true,
                    person: { select: { id: true, name: true } },
                    company: { select: { id: true, name: true } },
                },
            });
            for (const row of phoneRows) {
                const key = phoneMatchKey(row.phone);
                if (!key || ownerByKey.has(key)) continue;
                if (row.person) ownerByKey.set(key, { kind: "person", id: row.person.id, name: row.person.name });
                else if (row.company) ownerByKey.set(key, { kind: "company", id: row.company.id, name: row.company.name });
            }
        }

        /** The customer a call actually resolves to — null for a junk or absent key. */
        const ownerOf = (c: { phone: string | null }) => (c.phone ? (ownerByKey.get(c.phone) ?? null) : null);

        // ── Part-number near-match (Call Log display only) ───────────────────
        // The EPBX sends an incoming CLI digit by digit; answering early cuts it
        // short. We can still offer a lead: look for stored phones that START
        // with the digits that did arrive. Only when ONE customer matches, and
        // only from PARTIAL_CLI_MIN_DIGITS digits up — a shorter prefix matches
        // half the phone book. This NEVER touches `Call.phone`: it is a guess
        // for staff to confirm by ringing back, so the Call Log marks it as one
        // and the call popup does not show these calls at all.
        //
        // Judged on the SHAPE of what the PBX sent, never on whether `phone` is
        // null. Rows ingested before the shape rule existed still carry the junk
        // key the old last-10 slice produced (`91600204286` → `1600204286`), and
        // keying off `!c.phone` skipped every one of them — which is exactly the
        // history a counter is looking at. A junk key matches no customer, so
        // those rows are unmatched in fact whatever the column says.
        const partialPrefixes = Array.from(new Set(
            calls
                .filter((c) => c.direction === "INCOMING" && !ownerOf(c))
                .map((c) => partialCliPrefix(c.rawNumber))
                .filter((p): p is string => !!p),
        ));
        const guessByPrefix = new Map<string, { kind: "person" | "company"; id: number; name: string }>();
        if (partialPrefixes.length) {
            // `take` caps a runaway prefix; a prefix that wide is ambiguous and
            // would be dropped below anyway.
            const prefixRows = await prisma.phone.findMany({
                where: {
                    OR: partialPrefixes.flatMap((p) =>
                        phoneKeyVariants(p).map((v) => ({ phone: { startsWith: v } })),
                    ),
                },
                select: {
                    phone: true,
                    person: { select: { id: true, name: true } },
                    company: { select: { id: true, name: true } },
                },
                take: 200,
            });
            for (const prefix of partialPrefixes) {
                const owners = new Map<string, { kind: "person" | "company"; id: number; name: string }>();
                for (const row of prefixRows) {
                    const key = phoneMatchKey(row.phone);
                    if (!key?.startsWith(prefix)) continue;
                    const owner = row.person
                        ? { kind: "person" as const, id: row.person.id, name: row.person.name }
                        : row.company
                            ? { kind: "company" as const, id: row.company.id, name: row.company.name }
                            : null;
                    if (!owner) continue;
                    owners.set(`${owner.kind}:${owner.id}`, owner);
                    if (owners.size > 1) break; // ambiguous — no guess
                }
                if (owners.size === 1) guessByPrefix.set(prefix, [...owners.values()][0]);
            }
        }

        // ── The already-answered cutoff ──────────────────────────────────────
        // A caller who rang five times has ONE thing to say, not five, so the
        // counter should be reminded once and one note should cover the lot.
        // The dividing line is the number's most recent call that already
        // carries a note or a ticket: everything from BEFORE it was part of
        // whatever staff already answered, everything after it is genuinely new.
        //
        // We compare against the calls' own `occurredAt`, never against when the
        // note was typed. A note written late in the day about a morning call
        // must not swallow the calls that came in between.
        //
        // This is deliberately narrow: only a logged CALL moves the line. An open
        // help ticket does NOT silence a customer's future calls — they ring
        // again precisely because something is still not right.
        //
        // The rows themselves are untouched and still on the CRM Call Log; like
        // the popup's three-day window, this only decides who gets reminded.
        let cutoffByPhone = new Map<string, number>();
        if (sinceLastLogged && keys.length) {
            const logged = await prisma.call.groupBy({
                by: ["phone"],
                where: { phone: { in: keys }, OR: [{ note: { not: null } }, { ticketId: { not: null } }] },
                _max: { occurredAt: true },
            });
            cutoffByPhone = new Map(
                logged
                    .filter((g): g is typeof g & { phone: string } => !!g.phone && !!g._max.occurredAt)
                    .map((g) => [g.phone, g._max.occurredAt!.getTime()]),
            );
        }
        const answeredAlready = (phone: string | null, occurredAt: Date) => {
            if (!phone) return false;
            const cutoff = cutoffByPhone.get(phone);
            return cutoff !== undefined && occurredAt.getTime() <= cutoff;
        };

        const items = calls.filter((c) => !answeredAlready(c.phone, c.occurredAt)).map((c) => ({
            id: c.id,
            direction: c.direction,
            phone: c.phone,
            rawNumber: c.rawNumber,
            fromExt: c.fromExt,
            toExt: c.toExt,
            trunk: c.trunk,
            status: c.status,
            durationSec: c.durationSec,
            speechSec: c.speechSec,
            answerSec: c.answerSec,
            holdSec: c.holdSec,
            missed: isMissedCall(c.direction, c.speechSec, c.durationSec),
            note: c.note,
            spam: c.spam,
            sourceHost: c.sourceHost,
            alsoPushedBy: Array.isArray(c.alsoPushedBy)
                ? (c.alsoPushedBy as unknown[]).filter((h): h is string => typeof h === "string")
                : [],
            occurredAt: c.occurredAt.toISOString(),
            customer: ownerOf(c),
            // A CLI the handset cut off mid-arrival: real call, unusable number.
            partialNumber: readCallerNumber(
                c.direction === "OUTGOING" ? normalizeDialedNumber(c.rawNumber) : c.rawNumber,
            ).shape === "partial",
            // The one customer whose number starts with those digits, if exactly
            // one does. A lead for staff to verify — never a match.
            guessedCustomer: ownerOf(c) || c.direction !== "INCOMING"
                ? null
                : (guessByPrefix.get(partialCliPrefix(c.rawNumber) ?? "") ?? null),
        }));

        // `total` counted before the cutoff ran, so take the dropped rows off it —
        // otherwise the popup's "50+" badge would count calls it has decided are
        // already answered.
        const dropped = calls.length - items.length;
        return NextResponse.json({ items, pagination: { page, pageSize: take, total: Math.max(0, total - dropped) } });
    } catch (e) {
        return handleApiError(e, "Failed to list calls");
    }
}
