import type { Metadata } from "next";
import Image from "next/image";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { SHOP_APP_APK, SHOP_APP_START } from "@/shared/lib/device/shopApp";
import { SHOP_APP_RELEASE } from "@/shared/lib/constants/appVersions";
import InstallAppButton from "@/modules/mobile/components/InstallAppButton";

export const metadata: Metadata = { title: "Get the app" };

/**
 * The customer app's install page (SHOP_APP_INSTALL) — the link the WhatsApp bill
 * message carries. Open without sign-in (proxy.ts isPublicPath): the installed app
 * asks for the sign-in when it is first opened. The (external) layout already
 * links the shop manifest, so Chrome offers its own Install from here too.
 */
export default function ShopAppInstallPage() {
    return (
        <>
            {/* Catches Chrome's install offer before React runs — InstallAppButton
                reads it from window (same as the staff install page). */}
            <script
                dangerouslySetInnerHTML={{
                    __html: "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__installPrompt=e;window.dispatchEvent(new Event('install-offer'));});",
                }}
            />
            <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 bg-background p-6">
                <Image src="/shop-icon-192.png" alt="" width={96} height={96} className="rounded-2xl" priority />
                <div className="text-center">
                    <h1 className="text-2xl font-bold">{COMPANY_DETAILS.brandName}</h1>
                    <p className="text-sm text-muted-foreground">
                        Your bills and receipts as notifications, orders, repairs and shopping in one app.
                    </p>
                </div>
                <div className="w-full">
                    <InstallAppButton appName={COMPANY_DETAILS.brandName} home={SHOP_APP_START} apk={SHOP_APP_APK} release={SHOP_APP_RELEASE} apkOnly qrOnComputer />
                </div>
            </main>
        </>
    );
}
