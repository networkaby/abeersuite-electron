import { ImageResponse } from "next/og";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import QRCode from "qrcode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";

// GET /api/gift-cards/[id]/image — a shareable PNG of the gift-card design (used
// by the "Share with image" Web Share action + downloads). Rendered with Satori
// (next/og); a QR of the code is embedded as a data URL. Must be .tsx (JSX).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await params).id);
    const card = await prisma.giftCard.findUnique({ where: { id }, include: { ownerAccount: { select: { name: true } } } });
    if (!card) return new Response("Not found", { status: 404 });

    const org = await getOrganisation();
    const balance = Number(card.balance).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const initial = Number(card.initialValue).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const qr = await QRCode.toDataURL(card.code, { width: 240, margin: 1, errorCorrectionLevel: "M" });
    const meta = `${card.ownerAccount ? card.ownerAccount.name : "Bearer card"}${card.expiresAt ? ` · valid until ${card.expiresAt.toISOString().slice(0, 10)}` : ""}`;

    return new ImageResponse(
        (
            <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", fontFamily: "sans-serif", background: "#ffffff" }}>
                {/* Hero */}
                <div style={{ display: "flex", flexDirection: "column", padding: "40px 44px", color: "#ffffff", height: "260px", backgroundImage: "linear-gradient(135deg, #0d9488 0%, #0f766e 55%, #115e59 100%)" }}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 28, fontWeight: 700 }}>{org.brandName}</div>
                        <div style={{ fontSize: 16, letterSpacing: 4, opacity: 0.85, marginTop: 2 }}>GIFT CARD</div>
                    </div>
                    <div style={{ fontSize: 15, opacity: 0.85, marginTop: 40 }}>BALANCE</div>
                    <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1 }}>{`₹${balance}`}</div>
                    <div style={{ fontSize: 15, opacity: 0.7, marginTop: 6 }}>{`of ₹${initial}`}</div>
                </div>
                {/* Body */}
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "28px 44px", flexGrow: 1 }}>
                    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
                        <div style={{ fontSize: 14, letterSpacing: 2, color: "#64748b" }}>REDEEM CODE</div>
                        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, color: "#0f172a", marginTop: 4 }}>{card.code}</div>
                        <div style={{ fontSize: 16, color: "#64748b", marginTop: 14 }}>{meta}</div>
                    </div>
                    <img src={qr} width={150} height={150} alt="QR" />
                </div>
            </div>
        ),
        { width: 720, height: 460 },
    );
}
