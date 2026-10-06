import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import {
    SHOP_APP_ANDROID_PACKAGE,
    SHOP_APP_ID,
    SHOP_APP_MANIFEST,
    SHOP_APP_START,
    SHOP_APP_THEME,
} from "@/shared/lib/device/shopApp";

// The CUSTOMER app's install manifest (shop + portal), linked from the
// (external) layout. Its own `id` and name keep it a separate app from the staff
// one (/m-staff-app/manifest.webmanifest). Scope is the whole site, so a tap on
// a bill notification (/portal/...) or a product link stays inside the app.
export function GET(req: Request) {
    const manifestUrl = new URL(SHOP_APP_MANIFEST, req.url).href;
    return Response.json(
        {
            id: SHOP_APP_ID,
            name: COMPANY_DETAILS.brandName,
            short_name: COMPANY_DETAILS.brandName,
            description: `${COMPANY_DETAILS.brandName} — shop, your bills, orders and repairs on the phone.`,
            start_url: SHOP_APP_START,
            scope: "/",
            display: "standalone",
            orientation: "portrait",
            background_color: SHOP_APP_THEME.light,
            theme_color: SHOP_APP_THEME.light,
            related_applications: [
                { platform: "webapp", url: manifestUrl },
                { platform: "play", id: SHOP_APP_ANDROID_PACKAGE },
            ],
            icons: [
                { src: "/shop-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
                { src: "/shop-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
                { src: "/shop-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            ],
        },
        { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } }
    );
}
