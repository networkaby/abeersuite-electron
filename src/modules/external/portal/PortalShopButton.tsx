import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Yellow "Visit our shop" button — portal top bar and My Bills share it. */
export default function PortalShopButton({
    className = "",
    variant,
    compact = false,
}: {
    className?: string;
    variant?: "outline";
    /** Phone width shows just "Shop" so the top bar stays on one line. */
    compact?: boolean;
}) {
    return (
        <Button
            asChild
            size="sm"
            variant={variant}
            className={`${variant ? "border-yellow-400 text-yellow-900 hover:bg-yellow-50 dark:text-yellow-200 dark:hover:bg-yellow-950" : "bg-yellow-400 font-semibold text-yellow-950 hover:bg-yellow-300"} ${className}`}
        >
            <Link href="/shop">
                <ShoppingBag className="size-4" />
                {compact ? (
                    <>
                        <span className="hidden sm:inline">Visit our shop</span>
                        <span className="sm:hidden">Shop</span>
                    </>
                ) : (
                    "Visit our shop"
                )}
            </Link>
        </Button>
    );
}
