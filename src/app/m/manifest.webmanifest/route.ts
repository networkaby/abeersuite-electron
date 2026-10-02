import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

// The phone app's install manifest. Lives under /m so only the phone screens
// offer "Install app" — the office site and the shop stay plain websites.
export function GET() {
    return Response.json(
        {
            name: `${COMPANY_DETAILS.brandName} Mobile`,
            short_name: COMPANY_DETAILS.brandName,
            start_url: "/m",
            scope: "/m",
            display: "standalone",
            orientation: "portrait",
            background_color: COMPANY_DETAILS.themeColor.light,
            theme_color: COMPANY_DETAILS.themeColor.light,
            icons: [{ src: "/m-icon.png", sizes: "256x256", type: "image/png", purpose: "any" }],
        },
        { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=86400" } },
    );
}
