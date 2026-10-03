"use client";

import Link from "next/link";
import MobileHeader from "@/modules/mobile/MobileHeader";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** A phone screen that failed: try again, or go Home — never out to an office page.
 *  Inside the /m layout, so the menu and tab bar stay usable. */
export default function MobileError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <>
            <MobileHeader title="Something went wrong" />
            <div className="flex flex-col items-center gap-3 p-8 text-center">
                <p className="text-sm text-muted-foreground">This screen could not load. Check the connection and try again.</p>
                <button type="button" onClick={reset} className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground">
                    Try again
                </button>
                <Link href={PHONE_APP_HOME} className="w-full rounded-lg border py-3 text-sm">Back to Home</Link>
            </div>
        </>
    );
}
