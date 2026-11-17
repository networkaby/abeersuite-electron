import crypto from "crypto";
import { NextResponse } from "next/server";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { primaryAndStaging } from "@/shared/lib/db/dbPrimary";
import {
    AI_ENV_NAME,
    COUNTER_CONFIG_NEVER,
    COUNTER_CONFIG_OPTIONAL,
    COUNTER_CONFIG_REQUIRED,
} from "@/shared/lib/counter/officeConfigKeys";

/**
 * POST /api/counter/config — a counter's settings and secrets, from this server's own env.
 *
 * The installer carries no secrets (scripts/counterEnv.ts). A counter shows
 *   Authorization: Install <COUNTER_INSTALL_SECRET>
 * at every start and gets what Vercel holds, so a password or key changed on Vercel
 * reaches every counter at its next start, without a rebuild. The counter keeps a copy
 * locked to that PC for offline starts (electron/remoteConfig.ts).
 *
 * Only the keys in officeConfigKeys.ts leave, plus the `.env` names AI Setup rows point
 * at (AI-key shaped only) — never `DIRECT_URL` or anything else in this env.
 * No session: a counter asks before anyone can sign in, and it cannot sign in without the
 * answer. Answered on the office only; a counter never hands its settings to another.
 */

const SCHEME = "Install ";
/** Shorter than this and the secret is guessable, so the route stays shut. */
const MIN_SECRET_LENGTH = 32;

const digest = (value: string) => crypto.createHash("sha256").update(value).digest();

/** The `.env` names AI Setup rows use. A failed read only drops AI keys, never the answer. */
async function aiEnvNames(): Promise<string[]> {
    try {
        const rows = await prisma.aiKey.findMany({
            where: { source: "env", envName: { not: null } },
            select: { envName: true },
        });
        return rows.map((r) => r.envName!).filter((name) => AI_ENV_NAME.test(name));
    } catch (err) {
        console.warn("[counter/config] Could not read AI Setup env names:", err);
        return [];
    }
}

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

    const keys = new Set([...COUNTER_CONFIG_REQUIRED, ...COUNTER_CONFIG_OPTIONAL, ...(await aiEnvNames())]);
    const body: Record<string, string> = {};
    for (const key of keys) {
        if (COUNTER_CONFIG_NEVER.has(key)) continue;
        const value = process.env[key]?.trim();
        if (value) body[key] = value;
    }
    // DB1 / DB2: a counter gets the PRIMARY's pooled URL as its one DATABASE_URL, read
    // fresh at every start. Staging never reaches a counter. Same as before without DB2.
    body.DATABASE_URL = (await primaryAndStaging()).primary.pooled;
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
