import crypto from "crypto";
import { NextResponse } from "next/server";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";

/**
 * POST /api/counter/config — a till's database settings, from this server's own env.
 *
 * The installer no longer carries `DATABASE_URL` (scripts/counterEnv.ts). A till shows
 *   Authorization: Install <COUNTER_INSTALL_SECRET>
 * at every start and gets the value Vercel holds, so changing the database password on
 * Vercel reaches every till at its next start, without a rebuild. The till keeps a copy
 * locked to that PC for offline starts (electron/remoteConfig.ts).
 *
 * Only the keys below ever leave — never `DIRECT_URL` or any other secret in this env.
 * No session: a till asks before anyone can sign in, and it cannot sign in without the
 * answer. Answered on the office only; a till never hands its settings to another.
 */

const SHARED_KEYS = ["DATABASE_URL"] as const;
const SCHEME = "Install ";
/** Shorter than this and the secret is guessable, so the route stays shut. */
const MIN_SECRET_LENGTH = 32;

const digest = (value: string) => crypto.createHash("sha256").update(value).digest();

export async function POST(req: Request) {
    const expected = process.env.COUNTER_INSTALL_SECRET?.trim() ?? "";
    if (IS_COUNTER_PC || expected.length < MIN_SECRET_LENGTH) {
        return NextResponse.json({ error: "Not available here." }, { status: 404 });
    }

    const header = req.headers.get("authorization") ?? "";
    const given = header.startsWith(SCHEME) ? header.slice(SCHEME.length).trim() : "";
    if (!given || !crypto.timingSafeEqual(digest(given), digest(expected))) {
        return NextResponse.json({ error: "This installer's key was refused." }, { status: 401 });
    }

    const body: Record<string, string> = {};
    for (const key of SHARED_KEYS) {
        const value = process.env[key]?.trim();
        if (value) body[key] = value;
    }
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
