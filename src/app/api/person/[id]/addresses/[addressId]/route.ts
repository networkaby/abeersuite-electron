import { requireAuth } from "@/shared/lib/auth/permissions";
import { deleteResponse, updateResponse } from "@/shared/lib/address/addressRoutes";

/** PATCH / DELETE one address in a customer's book (office). `makePrimary` moves the main mark. */

type Ctx = { params: Promise<{ id: string; addressId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
    const { response } = await requireAuth();
    if (response) return response;
    const { id, addressId } = await params;
    return updateResponse(req, Number(id), addressId);
}

export async function DELETE(_: Request, { params }: Ctx) {
    const { response } = await requireAuth();
    if (response) return response;
    const { id, addressId } = await params;
    return deleteResponse(Number(id), addressId);
}
