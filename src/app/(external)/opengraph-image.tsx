import { ImageResponse } from "next/og";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * The share card for the public side of the app — store, shop, portal, legal.
 *
 * It lives in the (external) group on purpose: office routes are staff-only and
 * never shared, so they do not need one.
 *
 * Drawn in code rather than committed as a PNG, so the wording follows
 * COMPANY_DETAILS instead of drifting from it. Product pages override this with
 * their own photo — see ShopProductPage.tsx.
 */

export const alt = `${COMPANY_DETAILS.brandName} — ${COMPANY_DETAILS.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    height: "100%",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    background: "#0a0a0a",
                    color: "white",
                    padding: "72px 80px",
                    fontFamily: "sans-serif",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ width: 56, height: 6, background: "#f97316" }} />
                    <div
                        style={{
                            fontSize: 26,
                            letterSpacing: 4,
                            textTransform: "uppercase",
                            color: "#a1a1aa",
                        }}
                    >
                        Online store &amp; customer portal
                    </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    <div style={{ fontSize: 92, fontWeight: 700, lineHeight: 1.05 }}>
                        {COMPANY_DETAILS.brandName}
                    </div>
                    <div style={{ fontSize: 38, color: "#d4d4d8", lineHeight: 1.3 }}>
                        {COMPANY_DETAILS.description}
                    </div>
                </div>

                {/* Satori requires an explicit display on any element with more
                    than one child, so this line is built as a single string. */}
                <div style={{ display: "flex", fontSize: 28, color: "#a1a1aa" }}>
                    {`GST invoice · Secure checkout in ${COMPANY_DETAILS.currencySymbol} · ${COMPANY_DETAILS.contact.phone}`}
                </div>
            </div>
        ),
        size,
    );
}
