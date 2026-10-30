import { requireAuth } from "@/shared/lib/auth/permissions";
import { createResponse, listResponse } from "@/shared/lib/address/addressRoutes";

/**
 * GET  /api/person/[id]/addresses — the customer's address book (office).
 * POST /api/person/[id]/addresses — add one. Open to any signed-in user, like
 *      PUT /api/person/[id]: whoever can bill a customer can fix their address.
 */

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    return listResponse(Number((await params).id));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    return createResponse(req, Number((await params).id));
}
