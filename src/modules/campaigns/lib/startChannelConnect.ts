"use client";

import { toast } from "sonner";
import { isElectronEnvironment } from "@/shared/lib/bridge";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * Connect button on a Channels card: a full page visit to the API route that
 * redirects to Google's / Facebook's sign-in.
 *
 * Not inside the counter app. Its window hands every foreign site to the real
 * browser (electron/main.ts keepNavigationHome), so the sign-in would finish in
 * Chrome while the state cookie stayed in the counter app — the callback then
 * fails ("Forbidden" / "sign-in expired"). There, open the office website's
 * Channels page in the real browser instead, so the whole round trip runs in one place.
 */
export function startChannelConnect(connectPath: string, label: string): void {
    if (isElectronEnvironment()) {
        window.open(`${COMPANY_DETAILS.sites.office}/office/campaigns/channels`, "_blank");
        toast.info(`${label} opens in your browser — press Connect there on the office website.`);
        return;
    }
    window.location.href = connectPath;
}
