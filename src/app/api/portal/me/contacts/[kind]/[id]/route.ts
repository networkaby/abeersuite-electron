import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requirePortalAccountContext } from "@/shared/lib/auth/portalAuthGuard";
import { normalizePortalEmail, normalizePortalPhone } from "@/shared/lib/auth/portalIdentifier";
import {
    ContactUnverifiedError,
    deleteEmail,
    deletePhone,
    setPrimaryEmail,
    setPrimaryPhone,
} from "@/modules/customer/lib/contactWrite";
import { loadPortalProfile, unbindLoginChannel } from "@/shared/lib/portal/portalProfile";

/**
 * PATCH  /api/portal/me/contacts/[phone|email]/[id] — { isPrimary: true }
 * DELETE /api/portal/me/contacts/[phone|email]/[id]
 *
 * Both act only on a row that belongs to the signed-in customer. Guard rails:
 * an unverified contact cannot become primary (contactWrite enforces it), the
 * contact the password login is bound to cannot be removed, and the last
 * verified contact stays — otherwise nothing could ever sign them in again.
 */

const kindSchema = z.enum(["phone", "email"]);
const patchSchema = z.object({ isPrimary: z.literal(true) });

async function ownRow(kind: "phone" | "email", id: number, customerId: number) {
    return kind === "phone"
        ? prisma.phone.findFirst({ where: { id, personId: customerId }, select: { id: true, phone: true, verifiedAt: true } })
        : prisma.email.findFirst({ where: { id, personId: customerId }, select: { id: true, email: true, verifiedAt: true } });
}

async function parseParams(params: Promise<{ kind: string; id: string }>) {
    const raw = await params;
    const kind = kindSchema.safeParse(raw.kind);
    const id = Number(raw.id);
    if (!kind.success || !Number.isFinite(id)) return null;
    return { kind: kind.data, id };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;
    const customerId = context!.customerId;

    const p = await parseParams(params);
    if (!p) return NextResponse.json({ error: "Invalid contact" }, { status: 400 });

    const { error } = await validateRequest(req, patchSchema);
    if (error) return error;

    try {
        const row = await ownRow(p.kind, p.id, customerId);
        if (!row) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

        if (p.kind === "phone") await setPrimaryPhone(p.id);
        else await setPrimaryEmail(p.id);

        return NextResponse.json(await loadPortalProfile(customerId, context!.active.accountId));
    } catch (e) {
        if (e instanceof ContactUnverifiedError) {
            return NextResponse.json({ error: e.message }, { status: 409 });
        }
        return handleApiError(e, "Failed to update the contact");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;
    const customerId = context!.customerId;

    const p = await parseParams(params);
    if (!p) return NextResponse.json({ error: "Invalid contact" }, { status: 400 });

    try {
        const row = await ownRow(p.kind, p.id, customerId);
        if (!row) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

        const identity =
            "phone" in row
                ? { phoneNormalized: normalizePortalPhone(row.phone) }
                : { emailNormalized: normalizePortalEmail(row.email) };

        const cred = await prisma.personPortalCredential.findUnique({
            where: { personId: customerId },
            select: { phoneNormalized: true, emailNormalized: true },
        });
        const isLogin =
            ("phoneNormalized" in identity && !!identity.phoneNormalized && cred?.phoneNormalized === identity.phoneNormalized) ||
            ("emailNormalized" in identity && !!identity.emailNormalized && cred?.emailNormalized === identity.emailNormalized);
        if (isLogin) {
            return NextResponse.json(
                { error: "This is the contact your password login uses. Verify another mobile or email first, then remove this one." },
                { status: 409 },
            );
        }

        if (row.verifiedAt) {
            const [phones, emails] = await Promise.all([
                prisma.phone.count({ where: { personId: customerId, verifiedAt: { not: null } } }),
                prisma.email.count({ where: { personId: customerId, verifiedAt: { not: null } } }),
            ]);
            if (phones + emails <= 1) {
                return NextResponse.json(
                    { error: "Keep at least one verified mobile or email — it is how you sign in." },
                    { status: 409 },
                );
            }
        }

        if (p.kind === "phone") await deletePhone(p.id);
        else await deleteEmail(p.id);
        await unbindLoginChannel(customerId, identity);

        return NextResponse.json(await loadPortalProfile(customerId, context!.active.accountId));
    } catch (e) {
        return handleApiError(e, "Failed to remove the contact");
    }
}
