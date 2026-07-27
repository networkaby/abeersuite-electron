import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parsePagination } from "@/shared/lib/api";
import { phoneMatchKey, phoneKeyVariants } from "@/shared/lib/format";
import { isMissedCall, MISSED_CALL_WHERE, parseMissedMode } from "@/shared/lib/calls";
import { Prisma } from "@/generated/prisma/client";
import type { CallDirection } from "@/generated/prisma/client";

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
    raw: z.string().optional(),
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
    const rawNumber = p.callType === "OUTGOING" ? p.dialedNumber : p.callType === "INCOMING" ? p.callerNumber : undefined;
    return {
        direction: p.callType as CallDirection,
        phone: phoneMatchKey(rawNumber ?? null),
        rawNumber: rawNumber ?? null,
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

    // An external call with no caller number at all (CLI not delivered by the
    // telecom trunk — confirmed from raw SMDR, not something we failed to parse)
    // carries no identifying value. Skip storing it rather than accumulate rows
    // that can never match a customer. INTERNAL/UNKNOWN calls are untouched —
    // they never carry a customer number in the first place, so blank there is
    // normal, not this case.
    if (data.callType === "INCOMING" && !data.callerNumber?.trim()) {
        return NextResponse.json({ success: true, skipped: true, reason: "no caller number" });
    }
    if (data.callType === "OUTGOING" && !data.dialedNumber?.trim()) {
        return NextResponse.json({ success: true, skipped: true, reason: "no dialed number" });
    }

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

        const and: Prisma.CallWhereInput[] = [];
        if (parsedDir.success) {
            and.push({ direction: parsedDir.data });
        } else if (sp.get("direction") !== "all") {
            // Default view hides internal ext↔ext chatter.
            and.push({ direction: { not: "INTERNAL" } });
        }
        if (spam === "1") and.push({ spam: true });
        else and.push({ spam: false });

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

        const items = calls.map((c) => ({
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
            customer: c.phone ? (ownerByKey.get(c.phone) ?? null) : null,
        }));

        return NextResponse.json({ items, pagination: { page, pageSize: take, total } });
    } catch (e) {
        return handleApiError(e, "Failed to list calls");
    }
}
