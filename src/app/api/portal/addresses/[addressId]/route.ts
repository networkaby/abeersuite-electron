import { requirePortalAccountContext } from "@/shared/lib/auth/portalAuthGuard";
import { deleteResponse, updateResponse } from "@/shared/lib/address/addressRoutes";

/** PATCH / DELETE one of the signed-in customer's own addresses. */

type Ctx = { params: Promise<{ addressId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;
    return updateResponse(req, context!.customerId, (await params).addressId);
}

export async function DELETE(_: Request, { params }: Ctx) {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;
    return deleteResponse(context!.customerId, (await params).addressId);
}
