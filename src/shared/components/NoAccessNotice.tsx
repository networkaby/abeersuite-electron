"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { NO_ACCESS_PARAM } from "@/shared/lib/auth/pageAccess";

/**
 * Says why the screen changed when a page refused this person (the page lock in
 * pageAccess.ts, or a permission layout) and sent them to Work Flow instead — a
 * silent jump reads as a broken link. Drops the flag from the address afterwards,
 * so a reload does not say it again.
 */
export default function NoAccessNotice() {
    const params = useSearchParams();
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        if (!params.has(NO_ACCESS_PARAM)) return;
        toast.error("You do not have access to that page. Ask admin to tick it on your Role.");
        const rest = new URLSearchParams(params);
        rest.delete(NO_ACCESS_PARAM);
        router.replace(rest.size > 0 ? `${pathname}?${rest}` : pathname);
    }, [params, pathname, router]);

    return null;
}
