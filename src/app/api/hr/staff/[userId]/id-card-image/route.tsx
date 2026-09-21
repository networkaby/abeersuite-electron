import { ImageResponse } from "next/og";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { STAFF_USER_SELECT, shapeStaffUser } from "@/shared/lib/users/staffSelect";
import { STAFF_PROFILE_INCLUDE, toStaffProfileDto } from "@/modules/hr/lib/staffProfileServer";
import { toStaffIdCardData } from "@/modules/hr/lib/staffIdCard";
import type { StaffIdCardData } from "@/shared/components/print/StaffIdCard";

// GET /api/hr/staff/[userId]/id-card-image?side=front|back — the identity card
// as PRESS ARTWORK: a PNG at the real card size and a real print resolution,
// for handing to whoever prints the PVC cards.
//
// Rendered with Satori (next/og), the same way a gift card's shareable PNG is
// (`/api/gift-cards/[id]/image`). Satori draws its own layout — it cannot read
// the card component's CSS — which is the house rule anyway: print formats keep
// their own layout and share only the data (`toStaffIdCardData`). Everything
// below is written in millimetres through `mm()`, the same numbers as the
// screen card's stylesheet, so the two stay recognisably one design.
//
// Two things are deliberately NOT like the screen card, because a card press
// wants artwork, not a picture of a card:
//
//   * BLEED. The blue strip runs off the top and sides by `bleed` mm, so a
//     trim a hair off-centre still cuts through blue and never leaves a white
//     sliver at the edge.
//   * No border, no rounded corners. The blank card is already cut and rounded;
//     printing an outline on it would show as a line inside the real edge.
//
// Must be .tsx (JSX).

export const runtime = "nodejs";

type Side = "front" | "back";

const CARD_W_MM = 85.6;   // ID-1, the PAN / bank card size
const CARD_H_MM = 54;

const DEFAULT_DPI = 600;
const DEFAULT_BLEED_MM = 2;

const BLUE_DARK = "#1d4ed8";
const BLUE_MID = "#3b82f6";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";

function initials(name: string) {
    return name.trim().split(/\s+/).slice(0, 2).map((w) => (w[0] ?? "").toUpperCase()).join("");
}

// next/og ships ONE font face, Geist Regular, so every `fontWeight: 700` below
// would come out at normal weight and in a different typeface from the card on
// screen — the name on an ID card reading no heavier than the tagline. Arimo is
// fetched instead: it is metric-compatible with the Arial the screen card asks
// for, and it has a real bold, so the artwork and the card are one design.
//
// Fetched once per server process and kept. If it cannot be had — no network on
// a counter machine, Google unreachable — the card is still drawn, with the
// built-in face at one weight, rather than failing to print at all.
const FONT_FAMILY = "Arimo";
const FONT_WEIGHTS = [400, 700] as const;
// Asking as an old browser gets woff or ttf back instead of woff2, which Satori
// cannot read. Whichever of the two arrives is fine, so the url is taken as it
// comes rather than insisting on one format.
const OLD_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; rv:10.0) Gecko/20100101 Firefox/10.0";

type LoadedFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };
let fontsPromise: Promise<LoadedFont[]> | null = null;

async function oneFont(weight: 400 | 700): Promise<LoadedFont | null> {
    try {
        const cssRes = await fetch(
            `https://fonts.googleapis.com/css2?family=${FONT_FAMILY}:wght@${weight}`,
            { headers: { "User-Agent": OLD_BROWSER_UA } },
        );
        if (!cssRes.ok) return null;
        const url = (await cssRes.text()).match(/src:\s*url\((.+?)\)/)?.[1];
        if (!url) return null;
        const fontRes = await fetch(url);
        if (!fontRes.ok) return null;
        return { name: FONT_FAMILY, data: await fontRes.arrayBuffer(), weight, style: "normal" };
    } catch {
        return null;
    }
}

function loadFonts(): Promise<LoadedFont[]> {
    fontsPromise ??= Promise.all(FONT_WEIGHTS.map(oneFont))
        .then((all) => all.filter((f): f is LoadedFont => f !== null))
        // A half-loaded pair is worse than none: one weight for both would print
        // the bold lines at normal and look like a bug rather than a fallback.
        .then((all) => (all.length === FONT_WEIGHTS.length ? all : []))
        .catch(() => []);
    return fontsPromise;
}

/** The shop's wordmark as a data URL — Satori embeds SVG reliably this way. */
async function logoDataUrl(req: Request, url: string): Promise<string | null> {
    try {
        const res = await fetch(new URL(url, req.url));
        if (!res.ok) return null;
        const body = Buffer.from(await res.arrayBuffer());
        const type = res.headers.get("content-type") ?? "image/svg+xml";
        return `data:${type};base64,${body.toString("base64")}`;
    } catch {
        return null;
    }
}

export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await params).userId);
    if (!Number.isInteger(id) || id <= 0) return new Response("Invalid user id", { status: 400 });

    const q = new URL(req.url).searchParams;
    const side: Side = q.get("side") === "back" ? "back" : "front";
    // Clamped so a hand-typed query can never ask for a gigabyte of PNG.
    const dpi = Math.min(1200, Math.max(150, Number(q.get("dpi")) || DEFAULT_DPI));
    const bleed = Math.min(5, Math.max(0, Number(q.get("bleed") ?? DEFAULT_BLEED_MM)));

    const user = await prisma.user.findUnique({
        where: { id },
        select: { ...STAFF_USER_SELECT, staffProfile: { include: STAFF_PROFILE_INCLUDE } },
    });
    if (!user) return new Response("Not found", { status: 404 });

    const shaped = shapeStaffUser(user);
    const data = toStaffIdCardData({
        user: {
            id: shaped.id, name: shaped.name, email: shaped.email, title: shaped.title,
            role: shaped.role, avatarUrl: shaped.avatarUrl, phone: shaped.phone,
            positions: shaped.positions, scope: shaped.scope, managerId: shaped.managerId,
            manager: shaped.manager, userRole: shaped.userRole,
        },
        profile: user.staffProfile ? toStaffProfileDto(user.staffProfile) : null,
    });

    const org = getOrganisation();
    const logo = org.logoUrl ? await logoDataUrl(req, org.logoUrl) : null;

    // One millimetre, in pixels, at the resolution asked for. Every size below
    // goes through this, so the artwork is the same design at any dpi.
    const px = dpi / 25.4;
    const mm = (v: number) => Math.round(v * px);

    const width = mm(CARD_W_MM + bleed * 2);
    const height = mm(CARD_H_MM + bleed * 2);

    const node = side === "front"
        ? <Front data={data} org={org} logo={logo} mm={mm} bleed={bleed} />
        : <Back data={data} org={org} mm={mm} bleed={bleed} />;

    const fonts = await loadFonts();
    const png = new ImageResponse(node, { width, height, ...(fonts.length ? { fonts } : {}) });

    const name = shaped.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    const file = `staff-id-${id}-${name}-${side}-${CARD_W_MM}x${CARD_H_MM}mm-${dpi}dpi${bleed ? `-bleed${bleed}mm` : ""}.png`;

    const headers = new Headers(png.headers);
    headers.set("Content-Disposition", `attachment; filename="${file}"`);
    // Press artwork changes only when the person's details do, and it is slow to
    // draw, so let the browser keep it for a few minutes.
    headers.set("Cache-Control", "private, max-age=300");
    return new Response(png.body, { status: png.status, headers });
}

type Org = ReturnType<typeof getOrganisation>;
type Mm = (v: number) => number;

/** Front — wordmark strip, photo, name, the four facts. */
function Front({ data, org, logo, mm, bleed }: {
    data: StaffIdCardData; org: Org; logo: string | null; mm: Mm; bleed: number;
}) {
    const rows: [string, string][] = [
        ...(data.staffCode ? [["ID", data.staffCode] as [string, string]] : []),
        ...(data.joinedOn ? [["Joined", data.joinedOn] as [string, string]] : []),
        ...(data.phone ? [["Phone", data.phone] as [string, string]] : []),
        ...(data.bloodGroup ? [["Blood", data.bloodGroup] as [string, string]] : []),
    ];

    return (
        <div style={{
            display: "flex", flexDirection: "column", width: "100%", height: "100%",
            background: "#ffffff", color: INK, fontFamily: `${FONT_FAMILY}, Arial, sans-serif`,
        }}>
            {/* Strip — runs into the bleed at the top and both sides. */}
            <div style={{
                display: "flex", alignItems: "center", gap: mm(2.4),
                paddingTop: mm(bleed + 2), paddingBottom: mm(2),
                paddingLeft: mm(bleed + 3), paddingRight: mm(bleed + 3),
                backgroundImage: `linear-gradient(135deg, ${BLUE_DARK} 0%, ${BLUE_MID} 100%)`,
                color: "#ffffff",
            }}>
                {logo ? (
                    <div style={{
                        display: "flex", background: "#ffffff", borderRadius: mm(1.2),
                        paddingTop: mm(0.9), paddingBottom: mm(0.9),
                        paddingLeft: mm(1.4), paddingRight: mm(1.4),
                    }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders <img> only */}
                        <img src={logo} height={mm(3.6)} alt={org.brandName} />
                    </div>
                ) : (
                    <div style={{ fontSize: mm(3.1), fontWeight: 700 }}>{org.brandName}</div>
                )}
                {org.tagline && <div style={{ fontSize: mm(2.1), opacity: 0.9 }}>{org.tagline}</div>}
            </div>

            {/* Face */}
            <div style={{
                display: "flex", flexGrow: 1, gap: mm(3),
                paddingTop: mm(2.6), paddingBottom: mm(2.6),
                paddingLeft: mm(bleed + 3), paddingRight: mm(bleed + 3),
            }}>
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: mm(19), height: mm(24), flexShrink: 0,
                    border: `${mm(0.25)}px solid #cbd5e1`, borderRadius: mm(1.2),
                    background: "#f1f5f9", overflow: "hidden",
                }}>
                    {data.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- satori renders <img> only
                        <img src={data.photoUrl} width={mm(19)} height={mm(24)} alt="" style={{ objectFit: "cover" }} />
                    ) : (
                        <div style={{ fontSize: mm(7), fontWeight: 700, color: "#94a3b8" }}>{initials(data.name)}</div>
                    )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
                    <div style={{ fontSize: mm(4), fontWeight: 700 }}>{data.name}</div>
                    {data.designation && (
                        <div style={{ fontSize: mm(2.7), fontWeight: 600, color: BLUE_DARK, marginTop: mm(0.4) }}>
                            {data.designation}
                        </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", marginTop: mm(1.4), gap: mm(0.5) }}>
                        {rows.map(([k, v]) => (
                            <div key={k} style={{ display: "flex", alignItems: "baseline", gap: mm(2) }}>
                                <div style={{ fontSize: mm(2.2), color: MUTED, textTransform: "uppercase", width: mm(11) }}>{k}</div>
                                <div style={{ fontSize: mm(2.5), fontWeight: 600 }}>{v}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Foot */}
            <div style={{
                display: "flex", justifyContent: "space-between",
                borderTop: `${mm(0.25)}px solid ${LINE}`,
                paddingTop: mm(1.2), paddingBottom: mm(bleed + 1.2),
                paddingLeft: mm(bleed + 3), paddingRight: mm(bleed + 3),
                fontSize: mm(2.1), color: MUTED,
            }}>
                <div style={{ display: "flex" }}>{org.phone}</div>
                <div style={{ display: "flex" }}>{org.siteUrl}</div>
            </div>
        </div>
    );
}

/** Back — emergency contact, address, return-if-found, signature lines. */
function Back({ data, org, mm, bleed }: { data: StaffIdCardData; org: Org; mm: Mm; bleed: number }) {
    const orgAddress = [org.addressLine1, org.addressLine2, `${org.city} ${org.pinCode}`.trim(), org.state]
        .filter(Boolean).join(", ");
    const heading = (text: string) => (
        <div style={{ display: "flex", fontSize: mm(2.2), fontWeight: 700, color: BLUE_DARK, textTransform: "uppercase" }}>
            {text}
        </div>
    );

    return (
        <div style={{
            display: "flex", flexDirection: "column", width: "100%", height: "100%",
            background: "#ffffff", color: INK, fontFamily: `${FONT_FAMILY}, Arial, sans-serif`,
            paddingTop: mm(bleed + 2.8), paddingBottom: mm(bleed + 2.8),
            paddingLeft: mm(bleed + 3.4), paddingRight: mm(bleed + 3.4),
            fontSize: mm(2.4),
        }}>
            {(data.emergencyName || data.emergencyPhone) && (
                <div style={{ display: "flex", flexDirection: "column", marginBottom: mm(1.4) }}>
                    {heading("In an emergency, call")}
                    <div style={{ display: "flex" }}>
                        {[data.emergencyName, data.emergencyPhone].filter(Boolean).join(" — ")}
                    </div>
                </div>
            )}

            {data.address && (
                <div style={{ display: "flex", flexDirection: "column", marginBottom: mm(1.4) }}>
                    {heading("Address")}
                    <div style={{ display: "flex" }}>{data.address}</div>
                </div>
            )}

            <div style={{ display: "flex", fontSize: mm(2.1), color: "#475569" }}>
                {`This card is the property of ${org.legalName || org.brandName}. If found, please return it to ${orgAddress}${org.phone ? ` (${org.phone})` : ""}.`}
            </div>

            <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "flex-end",
                marginTop: "auto", gap: mm(3),
            }}>
                {["Holder's signature", "Authorised signatory"].map((t) => (
                    <div key={t} style={{
                        display: "flex", justifyContent: "center",
                        borderTop: `${mm(0.25)}px solid #94a3b8`, paddingTop: mm(0.6),
                        width: mm(26), fontSize: mm(2.1), color: MUTED,
                    }}>
                        {t}
                    </div>
                ))}
            </div>
        </div>
    );
}
