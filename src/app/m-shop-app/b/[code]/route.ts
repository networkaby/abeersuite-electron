import { NextResponse } from "next/server";
import { resolveCustomerLink } from "@/modules/external/portal/portalDocAccess";
import { APP } from "@/modules/external/shopApp/appPaths";

// The customer-message short link (/portal/b/<code>) opened inside the app:
// proxy.ts sends it here, and it lands on the app's own screen.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
    const link = await resolveCustomerLink((await params).code);
    const path =
        link.to === "repairs" ? `${APP}/repairs`
        : link.to === "due" ? `${APP}/bills?tab=outstanding`
        : link.to === "bill" ? `${APP}/bill/${link.detailId}`
        : link.to === "receipt" ? `${APP}/receipt/${link.uvId}`
        : `${APP}/orders`;
    return NextResponse.redirect(new URL(path, req.url));
}
