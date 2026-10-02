"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { markDeliberateSignOut } from "@/shared/lib/auth/signOutTo";

export default function MobileSignOut() {
    return (
        <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm active:bg-muted"
            onClick={() => {
                markDeliberateSignOut();
                void signOut({ callbackUrl: "/staff/login?callbackUrl=/m" });
            }}
        >
            <LogOut className="size-4" /> Sign out
        </button>
    );
}
