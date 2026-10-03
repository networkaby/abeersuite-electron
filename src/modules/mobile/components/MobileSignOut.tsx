"use client";

import { LogOut } from "lucide-react";
import { signOutTo } from "@/shared/lib/auth/signOutTo";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** Sign out and land on the staff sign-in, which brings the next person back to
 *  the phone app. Through `signOutTo`, which keeps the browser on the address it is
 *  on — NextAuth's own redirect would resolve against NEXTAUTH_URL and could throw
 *  a phone from office.* across to the shop's sign-in page, outside the app. */
export default function MobileSignOut() {
    return (
        <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm active:bg-muted"
            onClick={() => void signOutTo(`/staff/login?callbackUrl=${PHONE_APP_HOME}`)}
        >
            <LogOut className="size-4" /> Sign out
        </button>
    );
}
