import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * Parse a JSON request body with a Zod schema. On failure, returns a 400 NextResponse
 * carrying the first issue's message.
 *
 * Usage:
 *   const { data, error } = await validateRequest(req, mySchema);
 *   if (error) return error;
 *   // data is fully typed
 */
export async function validateRequest<T>(
    req: NextRequest | Request,
    schema: z.ZodType<T>,
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return {
            data: null,
            error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
        };
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "Invalid payload";
        return {
            data: null,
            error: NextResponse.json({ error: message }, { status: 400 }),
        };
    }
    return { data: parsed.data, error: null };
}
