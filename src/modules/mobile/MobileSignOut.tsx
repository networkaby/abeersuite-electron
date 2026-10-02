"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { markDeliberateSignOut } from "@/shared/lib/auth/signOutTo";

export default function MobileSignOut() {
    return (
        <button
            type="button"
            className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm"
            onClick={() => {
                markDeliberateSignOut();
                void signOut({ callbackUrl: "/staff/login?callbackUrl=/m" });
            }}
        >
            <LogOut className="size-4" /> Sign out
        </button>
    );
}
