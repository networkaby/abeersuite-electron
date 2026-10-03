import type { Metadata, Viewport } from "next";
import Image from "next/image";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import InstallAppButton from "@/modules/mobile/InstallAppButton";

const initials = COMPANY_DETAILS.brandName.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("");
const APP_NAME = `${initials} Staff`;

export const metadata: Metadata = {
    title: "Install",
    // Same manifest as the app, so Chrome offers to install it from right here.
    manifest: `${PHONE_APP_HOME}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: `${COMPANY_DETAILS.brandName} Staff` },
    icons: { apple: "/m-icon-192.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * Where the Downloads QR lands (PHONE_APP_INSTALL). Open WITHOUT sign-in (proxy.ts
 * isPublicPath, and outside the signed-in `(app)` layout): installing needs none —
 * the installed app asks for the sign-in when first opened. Shows nothing but the
 * app and its install step.
 */
export default function InstallPage() {
    return (
        <>
        {/* Catches Chrome's install offer the moment it fires — it can come before the
            page's React code is running, and a listener added later never sees it.
            InstallAppButton reads it from here. */}
        <script
            dangerouslySetInnerHTML={{
                __html: "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__installPrompt=e;window.dispatchEvent(new Event('install-offer'));});",
            }}
        />
        <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 bg-background p-6">
            <Image src="/m-icon-192.png" alt="" width={96} height={96} className="rounded-2xl" priority />
            <div className="text-center">
                <h1 className="text-2xl font-bold">{APP_NAME}</h1>
                <p className="text-sm text-muted-foreground">{COMPANY_DETAILS.brandName} staff app</p>
            </div>
            <div className="w-full">
                <InstallAppButton appName={APP_NAME} />
            </div>
        </main>
        </>
    );
}
