import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest } from "@/shared/lib/api";
import { saveShopCart } from "@/shared/lib/email/emailReminders";

const schema = z.object({
    lines: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(9999) })).max(200),
});

// PUT /api/portal/cart — the signed-in customer's cart, copied up from their
// device so an abandoned one can get its reminder email. Empty = deleted.
export async function PUT(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    await saveShopCart(customerId, data.lines);
    return NextResponse.json({ ok: true });
}
