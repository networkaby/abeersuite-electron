// Server-only companion to accountAlias.ts — anything that needs Prisma lives
// here, so the pure helpers stay importable from client components.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { aliasKeyOf } from "@/modules/accountancy/lib/accountAlias";

/**
 * Turn an AccountAlias.aliasKey unique-constraint violation into a message that
 * names the offending alias and the ledger already holding it. Returns null when
 * the error is not an alias clash, so callers can fall through to their own
 * handling (a `code` clash, or handleApiError).
 */
export async function aliasConflictResponse(
    e: unknown,
    aliases: string[] | undefined,
): Promise<NextResponse | null> {
    if (!aliases?.length) return null;
    const message = e instanceof Error ? e.message : "";
    if (!message.includes("aliasKey")) return null;

    const clash = await prisma.accountAlias.findFirst({
        where: { aliasKey: { in: aliases.map(aliasKeyOf) } },
        select: { alias: true, account: { select: { name: true } } },
    });
    return NextResponse.json(
        {
            error: clash
                ? `Alias "${clash.alias}" is already used by ${clash.account.name}`
                : "That alias is already used by another ledger",
        },
        { status: 409 },
    );
}
