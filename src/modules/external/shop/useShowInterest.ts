"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";

/**
 * "Show interest" on an out-of-stock product (owner, 2026-11-22) — one hook for the
 * website and the phone app. Signed in as a customer → POST /api/shop/interest (a
 * Deal for staff); otherwise off to sign-in, back to this page after.
 *
 * No SessionProvider above (a page outside the shop / office layouts) reads as
 * signed out rather than crashing the page — useSession() returns undefined there.
 */
const shopLogin = () =>
    `/login?callbackUrl=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/shop")}`;

export function useShowInterest(loginHref: () => string = shopLogin) {
    const router = useRouter();
    const session = useSession()?.data;
    const isCustomer = (session?.user as { kind?: string } | undefined)?.kind === "customer";
    const [busy, setBusy] = useState(false);
    const send = async (productId: number) => {
        if (!isCustomer) {
            toast.info("Sign in and we will tell you when it is back");
            router.push(loginHref());
            return;
        }
        setBusy(true);
        try {
            const { data } = await axios.post<{ again: boolean }>("/api/shop/interest", { productId });
            toast.success(data.again ? "We already have your interest — we will tell you when it is back" : "Thanks — we will tell you when it is back");
        } catch (e) {
            toast.error(extractApiError(e, "Could not save your interest"));
        } finally {
            setBusy(false);
        }
    };
    return { send, busy };
}
