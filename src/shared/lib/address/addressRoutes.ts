import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { addressSchema } from "./address";
import { deleteAddress, listAddresses, saveAddress } from "./personAddressServer";

/**
 * The address-book API body, shared by the office (/api/person/[id]/addresses)
 * and the portal (/api/portal/addresses). Each route only works out whose
 * book it is and checks access; everything after that is here.
 */

const patchSchema = addressSchema.extend({ makePrimary: z.boolean().optional() });

export async function listResponse(personId: number) {
    try {
        return NextResponse.json({ addresses: await listAddresses(personId) });
    } catch (e) {
        return handleApiError(e, "Failed to load addresses");
    }
}

export async function createResponse(req: Request, personId: number) {
    const { data, error } = await validateRequest(req, addressSchema);
    if (error) return error;
    try {
        return NextResponse.json(await saveAddress(personId, null, data));
    } catch (e) {
        return handleApiError(e, "Failed to save the address");
    }
}

export async function updateResponse(req: Request, personId: number, rawId: string) {
    const id = Number(rawId);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;
    const { makePrimary, ...fields } = data;
    try {
        const row = await saveAddress(personId, id, fields, { makePrimary });
        return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
    } catch (e) {
        return handleApiError(e, "Failed to save the address");
    }
}

export async function deleteResponse(personId: number, rawId: string) {
    const id = Number(rawId);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
        return (await deleteAddress(personId, id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
    } catch (e) {
        return handleApiError(e, "Failed to delete the address");
    }
}
