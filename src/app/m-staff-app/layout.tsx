import NativeAppReady from "@/modules/mobile/components/NativeAppReady";
import AppUpdateBar from "@/shared/components/AppUpdateBar";
import { STAFF_APP_RELEASE } from "@/shared/lib/constants/appVersions";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { PHONE_APP_INSTALL, PHONE_APP_UA } from "@/shared/lib/device/phone";

/** Every phone-app page — install, sign-in and the app itself — gets the Android
 *  app's ready signal, the persistent-storage request and the update bar. Its link
 *  is the install page on the dotted office address, so it leaves the app's WebView
 *  for Chrome. */
export default function PhoneAppLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <NativeAppReady />
            <AppUpdateBar uaTag={PHONE_APP_UA} release={STAFF_APP_RELEASE} installUrl={`${COMPANY_DETAILS.sites.office}.${PHONE_APP_INSTALL}`} />
            {children}
        </>
    );
}
