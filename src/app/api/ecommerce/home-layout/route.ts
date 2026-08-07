import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { normalizeHomeLayout } from "@/shared/lib/shop/homeLayout";
import { loadHomeLayout } from "@/shared/lib/shop/loadHomeLayout";

// Owner-configurable storefront home page layout — a flexible list of
// section INSTANCES (see homeLayout.ts), each with its own type, Section No.,
// Priority, schedule, and content. Stored on OrgDefaults (singleton id=1).

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const layout = await loadHomeLayout();
        return NextResponse.json({ layout });
    } catch (e) {
        return handleApiError(e, "Failed to load home layout");
    }
}

// Loosely shaped on purpose — normalizeHomeLayout() is the real sanitizer
// (drops unknown types, malformed content, bad enum values). Zod here only
// guards the outer shape (an array of loose records) so a garbled body
// doesn't reach it at all.
const putSchema = z.array(z.record(z.string(), z.unknown()));

export async function PUT(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;
    try {
        // Normalize so the stored column always has every known section key
        // exactly once, in the given order, with only well-formed content.
        const layout = normalizeHomeLayout(data);
        await prisma.orgDefaults.update({
            where: { id: 1 },
            data: { storefrontHomeJson: layout },
        });
        return NextResponse.json({ layout });
    } catch (e) {
        return handleApiError(e, "Failed to save home layout");
    }
}
