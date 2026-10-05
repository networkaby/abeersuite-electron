import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { isMasterPhotoKind, isOwnPhotoUrl, type MasterPhotoKind } from "@/modules/mobile/lib/shopPhotos";
import type { MasterPhoto } from "@/modules/mobile/lib/types";

// PATCH /api/mobile/photos/master/[kind]/[id] — { imageUrl: url | null }
//
// Sets or clears the storefront image of one brand, group or category from the
// phone. Only the image: name, slug, hierarchy and GST stay with the office
// master pages (the office image editor is /office/ecommerce/masters).

const bodySchema = z.object({ imageUrl: z.string().url().nullable() }).strict();
const select = { id: true, name: true, imageUrl: true } as const;

function setImage(kind: MasterPhotoKind, id: number, imageUrl: string | null): Promise<MasterPhoto> {
    const args = { where: { id }, data: { imageUrl }, select };
    switch (kind) {
        case "brand": return prisma.invBrand.update(args);
        case "group": return prisma.invProductGroup.update(args);
        case "category": return prisma.invCategory.update(args);
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_PHOTOS_EDIT);
    if (response) return response;
    const { kind, id: rawId } = await params;
    if (!isMasterPhotoKind(kind)) return NextResponse.json({ error: "Unknown master" }, { status: 400 });
    const { id, error } = await parseIdParam(Promise.resolve({ id: rawId }));
    if (error) return error;
    const { data, error: bodyError } = await validateRequest(req, bodySchema);
    if (bodyError) return bodyError;
    if (data.imageUrl != null && !isOwnPhotoUrl(data.imageUrl)) {
        return NextResponse.json({ error: "Only photos uploaded from the app can be saved" }, { status: 400 });
    }

    try {
        return NextResponse.json(await setImage(kind, id, data.imageUrl));
    } catch (e) {
        if ((e as { code?: string })?.code === "P2025") {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return handleApiError(e, "Could not save the image");
    }
}
