"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ShoppingBag, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

/**
 * Right after a customer signs in, the login page appends `?welcome=1` to the
 * return page. This popup asks shop or portal, then strips the flag from the
 * address bar so a refresh does not ask again.
 */
export default function WelcomeChoiceModal() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const [open, setOpen] = useState(false);

    const flagged = searchParams.get("welcome") === "1";
    const user = session?.user as { kind?: string; name?: string } | undefined;
    const isCustomer = user?.kind === "customer";

    // Open once when the flag arrives (render-time adjust, not an effect).
    const [handled, setHandled] = useState(false);
    if (flagged && isCustomer && !handled) {
        setHandled(true);
        setOpen(true);
    }

    useEffect(() => {
        if (!flagged || !isCustomer) return;
        const rest = new URLSearchParams(searchParams.toString());
        rest.delete("welcome");
        const qs = rest.toString();
        window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    }, [flagged, isCustomer, pathname, searchParams]);

    const goShop = () => {
        setOpen(false);
        // Already on the shop (or a product page): just stay.
        if (pathname.startsWith("/portal")) router.push("/shop");
    };

    const goPortal = () => {
        setOpen(false);
        if (pathname !== "/portal") router.push("/portal");
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="text-center sm:text-center">
                    <DialogTitle className="text-xl">Welcome, {user?.name ?? "Customer"}.</DialogTitle>
                    <DialogDescription>Where would you like to go?</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Button size="lg" className="gap-1.5" onClick={goShop}>
                        <ShoppingBag className="size-4" />
                        Continue shopping
                    </Button>
                    <Button size="lg" variant="outline" className="gap-1.5" onClick={goPortal}>
                        <UserRound className="size-4" />
                        Go to my portal
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
