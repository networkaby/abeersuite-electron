import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import {
    PORTAL_ACTIVE_ACCOUNT_COOKIE,
    resolvePortalAccountContext,
} from "@/lib/auth/portal-account-context";
import { requirePortalCustomer } from "@/lib/portal-auth-guard";

const switchSchema = z.object({
    accountId: z.coerce.number().int().positive(),
});

export async function GET() {
    const authResult = await requirePortalCustomer();
    if (authResult.response) return authResult.response;

    try {
        const cookieStore = await cookies();
        const rawAccountId = cookieStore.get(PORTAL_ACTIVE_ACCOUNT_COOKIE)?.value;
        const preferredAccountId = rawAccountId ? Number(rawAccountId) : null;
        const context = await resolvePortalAccountContext(
            authResult.customerId!,
            Number.isFinite(preferredAccountId) ? preferredAccountId : null
        );
        return NextResponse.json(context);
    } catch {
        return NextResponse.json({ error: "No account available for this user" }, { status: 400 });
    }
}

export async function PATCH(req: Request) {
    const authResult = await requirePortalCustomer();
    if (authResult.response) return authResult.response;

    const parsed = switchSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
            { status: 400 }
        );
    }

    try {
        const context = await resolvePortalAccountContext(authResult.customerId!, parsed.data.accountId);
        if (context.active.accountId !== parsed.data.accountId) {
            return NextResponse.json({ error: "Selected account is not linked to this profile" }, { status: 403 });
        }

        const response = NextResponse.json(context);
        response.cookies.set(PORTAL_ACTIVE_ACCOUNT_COOKIE, String(context.active.accountId), {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
        });
        return response;
    } catch {
        return NextResponse.json({ error: "Unable to switch account context" }, { status: 400 });
    }
}

