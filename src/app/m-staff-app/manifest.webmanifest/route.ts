import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { PHONE_APP_HOME, PHONE_APP_THEME } from "@/shared/lib/device/phone";

/** "Network Service" → "NS": the name under the home-screen icon. */
const initials = COMPANY_DETAILS.brandName.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("");

// The STAFF phone app's install manifest. Lives under /m and is linked only from
// the /m layout, so only the staff screens offer "Install app".
//
// Kept apart from the customer shop app that will come later (shop.networkservice.in,
// its own manifest): its own `id`, so Android treats the two as separate apps
// with their own icons and updates, and a "Staff" name, so a phone carrying both
// never shows two identical icons. Chrome installs a real app (full screen, no
// address bar) only with a 192px AND a 512px icon; the maskable one keeps the
// round logo inside Android's safe zone on any icon shape.
export function GET(req: Request) {
    // "Is this app installed here?" — Chrome answers `getInstalledRelatedApps()` for
    // the install page only when the manifest names itself as a related web app.
    const manifestUrl = new URL(`${PHONE_APP_HOME}/manifest.webmanifest`, req.url).href;
    return Response.json(
        {
            id: PHONE_APP_HOME,
            name: `${COMPANY_DETAILS.brandName} Staff`,
            short_name: `${initials} Staff`,
            description: `${COMPANY_DETAILS.brandName} staff app — stock, parties, receipts and payments on the phone.`,
            start_url: PHONE_APP_HOME,
            scope: PHONE_APP_HOME,
            display: "standalone",
            orientation: "portrait",
            background_color: PHONE_APP_THEME.light,
            theme_color: PHONE_APP_THEME.light,
            related_applications: [{ platform: "webapp", url: manifestUrl }],
            icons: [
                { src: "/m-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
                { src: "/m-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
                { src: "/m-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            ],
        },
        { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } },
    );
}
