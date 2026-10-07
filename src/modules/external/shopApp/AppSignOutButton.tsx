"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { signOutTo } from "@/shared/lib/auth/signOutTo";
import { SHOP_NATIVE_HOME } from "@/shared/lib/device/shopApp";

/** Signs the customer out and lands back on the app's Home. */
export default function AppSignOutButton() {
    const [busy, setBusy] = useState(false);
    return (
        <button
            type="button"
            disabled={busy}
            onClick={() => {
                setBusy(true);
                void signOutTo(SHOP_NATIVE_HOME);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 py-3 text-sm font-medium text-destructive active:bg-destructive/10 disabled:opacity-60"
        >
            <LogOut className="size-4" />
            {busy ? "Signing out…" : "Sign out"}
        </button>
    );
}
