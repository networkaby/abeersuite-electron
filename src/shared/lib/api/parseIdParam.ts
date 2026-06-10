import { NextResponse } from "next/server";

/**
 * Parse a numeric route `[id]` param. Returns `{ id }` on success, or
 * `{ error }` (a 400 NextResponse) when the id isn't a finite number.
 *
 * Usage:
 *   const { id, error } = await parseIdParam(params);
 *   if (error) return error;
 */
export async function parseIdParam(
    params: Promise<{ id: string }>,
): Promise<{ id: number; error?: undefined } | { id?: undefined; error: NextResponse }> {
    const id = Number((await params).id);
    if (!Number.isFinite(id)) {
        return { error: NextResponse.json({ error: "Invalid id" }, { status: 400 }) };
    }
    return { id };
}
