import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { R2_MESSAGES_BUCKET } from "@/shared/lib/constants/whatsapp";
import { isR2Configured, presignR2 } from "@/shared/lib/storage/r2";
import { checkOutgoingMedia, outgoingMediaKey } from "@/modules/message/lib/customerMessages";

// POST /api/messages/upload-url — { phone, name, type, size } → { key, putUrl }.
// A 10-minute signed PUT into the private R2 bucket, so the browser uploads the
// file straight to storage (not through our server). The reply call then names
// `key`; sendReply only accepts keys under this chat's own prefix.

const schema = z.object({
    phone: z.string().trim().min(1),
    name: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(100),
    size: z.number().int().positive(),
});

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        if (!isR2Configured()) return NextResponse.json({ error: "File storage (R2) is not set up on this server." }, { status: 503 });
        const phone = phoneMatchKey(data.phone);
        if (!phone) return NextResponse.json({ error: "Not a valid number" }, { status: 400 });
        const bad = checkOutgoingMedia(data.type, data.size);
        if (bad) return NextResponse.json({ error: bad }, { status: 400 });

        const key = outgoingMediaKey(phone, data.name);
        const putUrl = presignR2({ bucket: R2_MESSAGES_BUCKET, key, method: "PUT", contentType: data.type, expiresSec: 600 });
        return NextResponse.json({ key, putUrl });
    } catch (e) {
        return handleApiError(e, "Could not prepare the upload");
    }
}
