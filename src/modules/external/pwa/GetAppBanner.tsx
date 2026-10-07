"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download, X } from "lucide-react";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { SHOP_APP_APK, SHOP_APP_INSTALL } from "@/shared/lib/device/shopApp";
import { noSubscribe, readPlace, useApkAvailable } from "@/modules/mobile/components/installPlace";

/** ✕ hides the strip on this phone for this long. */
const HIDE_DAYS = 14;
const HIDE_KEY = "shop-app-banner-hidden-until";

function hiddenNow(): boolean {
    try {
        return Number(localStorage.getItem(HIDE_KEY) ?? 0) > Date.now();
    } catch {
        return false;
    }
}

/**
 * "Get our app" strip on the shop + portal, for a phone browser only — never
 * inside the installed app, never on a computer, never on /app itself.
 *   • Android: the APK, and Chrome's own PWA install popup is held back, so the
 *     customer sees ONE offer (what Amazon / Flipkart do). Until the APK is on
 *     the site, the strip points to /app, which offers Chrome's install instead.
 *   • iPhone: no Android app there — the strip points to /app's Add to Home Screen.
 */
export default function GetAppBanner() {
    const place = useSyncExternalStore(noSubscribe, readPlace, () => "server");
    const pathname = usePathname();
    // Saved ✕ (read once; "server" render counts as hidden) + ✕ tapped this visit.
    const hiddenSaved = useSyncExternalStore(noSubscribe, hiddenNow, () => true);
    const [closed, setClosed] = useState(false);
    const hidden = hiddenSaved || closed;
    const phone = place === "android" || place === "iphone";
    const apkOk = useApkAvailable(SHOP_APP_APK, place === "android" && !hidden);

    // Android with the APK on the site: Chrome's own install popup would be a
    // second, different app — hold it back. /app keeps it (its own script).
    useEffect(() => {
        if (!apkOk || pathname === SHOP_APP_INSTALL) return;
        const hold = (e: Event) => e.preventDefault();
        window.addEventListener("beforeinstallprompt", hold);
        return () => window.removeEventListener("beforeinstallprompt", hold);
    }, [apkOk, pathname]);

    if (!phone || hidden || pathname === SHOP_APP_INSTALL) return null;
    if (place === "android" && apkOk === null) return null;

    const close = () => {
        try {
            localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_DAYS * 86_400_000));
        } catch {}
        setClosed(true);
    };
    const button = "flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground active:opacity-90";

    return (
        <div className="flex items-center gap-3 border-b bg-muted/60 px-3 py-2">
            <button type="button" onClick={close} aria-label="Hide" className="shrink-0 p-1 text-muted-foreground">
                <X className="size-4" />
            </button>
            <Image src="/shop-icon-192.png" alt="" width={36} height={36} className="shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold">{COMPANY_DETAILS.brandName} app</p>
                <p className="truncate text-xs text-muted-foreground">Bills and repair updates as notifications</p>
            </div>
            {apkOk ? (
                <a href={SHOP_APP_APK} download className={button}>
                    <Download className="size-4" /> Get app
                </a>
            ) : (
                <Link href={SHOP_APP_INSTALL} className={button}>
                    {place === "iphone" ? "Add" : "Install"}
                </Link>
            )}
        </div>
    );
}
