import Link from "next/link";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** A phone screen that does not exist (an old link, a removed party): stays inside
 *  the phone app — the site-wide 404 would offer the office home. */
export default function MobileNotFound() {
    return (
        <>
            <MobileHeader title="Not found" />
            <div className="flex flex-col items-center gap-4 p-8 text-center">
                <p className="text-sm text-muted-foreground">This page is not in the app any more.</p>
                <Link href={PHONE_APP_HOME} className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground">
                    Back to Home
                </Link>
            </div>
        </>
    );
}
