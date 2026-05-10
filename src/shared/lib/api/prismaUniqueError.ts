import { NextResponse } from "next/server";

type PrismaErrorLike = { code?: string; meta?: { target?: string | string[] } };

function toFieldKeys(target: string | string[] | undefined): string[] {
    if (!target) return [];
    if (Array.isArray(target)) return target;
    // PG unique-constraint name like "Person_phone_key" → "phone"
    const m = target.match(/_([a-zA-Z0-9]+)_key$/);
    return m ? [m[1]] : [target];
}

/**
 * If `e` is a Prisma `P2002` (unique-constraint) error, returns a 409 NextResponse.
 * Otherwise returns `null` so the caller can fall through to its generic error path.
 *
 * - Pass a string for routes whose unique constraint is composite or single-purpose
 *   (any P2002 here means the same conflict).
 * - Pass a `Record<field, message>` to map specific column/index names to specific
 *   messages (typical for create-with-unique-fields routes).
 *
 * Usage:
 *   const conflict = prismaUniqueError(e, "Brand name already exists");
 *   if (conflict) return conflict;
 *   // or
 *   const conflict = prismaUniqueError(e, { phone: "Phone in use", email: "Email in use" });
 */
export function prismaUniqueError(
    e: unknown,
    message: string | Record<string, string>,
): NextResponse | null {
    const err = e as PrismaErrorLike;
    if (err?.code !== "P2002") return null;

    if (typeof message === "string") {
        return NextResponse.json({ error: message }, { status: 409 });
    }

    const fields = toFieldKeys(err.meta?.target);
    for (const f of fields) {
        if (message[f]) {
            return NextResponse.json({ error: message[f] }, { status: 409 });
        }
    }
    return NextResponse.json({ error: "Duplicate entry" }, { status: 409 });
}
