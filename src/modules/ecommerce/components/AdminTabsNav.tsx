"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
    { href: "/ecommerce", label: "Dashboard" },
    { href: "/ecommerce/orders", label: "Orders" },
    { href: "/ecommerce/products", label: "Products" },
    { href: "/ecommerce/categories", label: "Categories" },
    { href: "/ecommerce/coupons", label: "Coupons" },
] as const;

export default function AdminTabsNav() {
    const pathname = usePathname();

    return (
        <nav className="flex flex-wrap gap-1 border-b border-border pb-3" aria-label="E-commerce admin">
            {tabs.map((t) => {
                const active =
                    t.href === "/ecommerce"
                        ? pathname === "/ecommerce"
                        : pathname === t.href || pathname.startsWith(`${t.href}/`);
                return (
                    <Link
                        key={t.href}
                        href={t.href}
                        className={cn(
                            "rounded-md px-3 py-2 text-sm font-medium transition-colors touch-manipulation",
                            active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                    >
                        {t.label}
                    </Link>
                );
            })}
        </nav>
    );
}
