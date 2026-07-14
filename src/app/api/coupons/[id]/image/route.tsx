import { ImageResponse } from "next/og";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import QRCode from "qrcode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { couponHeadline } from "@/modules/coupons/lib/couponShare";

// GET /api/coupons/[id]/image — a shareable PNG of the coupon (Web Share /
// WhatsApp / download). Rendered with Satori (next/og); QR of the code embedded.
// Must be .tsx (JSX). Only coupons WITH a code are shareable.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await params).id);
    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return new Response("Not found", { status: 404 });
    if (!coupon.code) return new Response("AUTO coupons have no shareable code", { status: 422 });

    const org = await getOrganisation();
    const headline = couponHeadline(coupon);
    const qr = await QRCode.toDataURL(coupon.code, { width: 240, margin: 1, errorCorrectionLevel: "M" });
    const minBill = coupon.minBillValue != null && Number(coupon.minBillValue) > 0
        ? `Min bill ₹${Number(coupon.minBillValue).toLocaleString("en-IN")}` : "";
    const validUntil = coupon.endsAt ? `Valid until ${coupon.endsAt.toISOString().slice(0, 10)}` : "";
    const terms = [minBill, validUntil].filter(Boolean).join("  ·  ");

    return new ImageResponse(
        (
            <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", fontFamily: "sans-serif", background: "#ffffff" }}>
                {/* Hero */}
                <div style={{ display: "flex", flexDirection: "column", padding: "38px 44px", color: "#ffffff", height: "270px", backgroundImage: "linear-gradient(135deg, #e11d48 0%, #be123c 55%, #9f1239 100%)" }}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 26, fontWeight: 700 }}>{org.brandName}</div>
                        <div style={{ fontSize: 16, letterSpacing: 4, opacity: 0.85, marginTop: 2 }}>COUPON</div>
                    </div>
                    <div style={{ display: "flex", fontSize: 64, fontWeight: 800, lineHeight: 1.05, marginTop: 28 }}>{headline}</div>
                    <div style={{ fontSize: 22, opacity: 0.92, marginTop: 10 }}>{coupon.name}</div>
                </div>
                {/* Body */}
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "26px 44px", flexGrow: 1 }}>
                    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
                        <div style={{ fontSize: 14, letterSpacing: 2, color: "#64748b" }}>CODE</div>
                        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, color: "#0f172a", marginTop: 4 }}>{coupon.code}</div>
                        <div style={{ fontSize: 15, color: "#64748b", marginTop: 14 }}>{terms || "Use this code at checkout"}</div>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element -- satori ImageResponse only supports <img>, not next/image */}
                    <img src={qr} width={150} height={150} alt="QR" />
                </div>
            </div>
        ),
        { width: 720, height: 470 },
    );
}
