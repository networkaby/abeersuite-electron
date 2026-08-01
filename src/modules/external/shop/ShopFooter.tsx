"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail, MapPin, ShieldCheck } from "lucide-react";
import { LEGAL_LINKS } from "@/shared/lib/legal/legalContent";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import AboutBusinessNote from "@/modules/external/shop/AboutBusinessNote";
import ShopBrandMark from "@/modules/external/shop/ShopBrandMark";
import PaymentMethodLogos from "@/modules/external/shop/PaymentMethodLogos";

export default function ShopFooter() {
    const pathname = usePathname();

    // Distraction-free checkout: no link farm — but the policies must stay
    // reachable from the payment step (Razorpay's activation check looks here).
    if (pathname === "/shop/checkout") {
        return (
            <footer className="mt-auto border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-emerald-600" />
                    Secure checkout · Prices in {COMPANY_DETAILS.currencySymbol} · © {new Date().getFullYear()} {COMPANY_DETAILS.brandName}
                </span>
                <span className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
                    {LEGAL_LINKS.map((link) => (
                        <Link key={link.href} href={link.href} className="hover:text-foreground hover:underline">
                            {link.label}
                        </Link>
                    ))}
                </span>
            </footer>
        );
    }

    const addressLine = [
        COMPANY_DETAILS.address.line1,
        COMPANY_DETAILS.address.line2,
        `${COMPANY_DETAILS.address.city}, ${COMPANY_DETAILS.address.state} ${COMPANY_DETAILS.address.pin}`,
        COMPANY_DETAILS.address.country,
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <footer className="mt-auto border-t border-border/80 bg-muted/30">
            <div className="mx-auto max-w-6xl px-4 py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                    <div className="flex items-center gap-2 font-semibold text-lg">
                        <ShopBrandMark className="h-10 w-36" />
                        <span className="sr-only">{COMPANY_DETAILS.brandName}</span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                        {COMPANY_DETAILS.description} Same session as your customer portal and service team.
                    </p>
                </div>
                <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wide">Shop</h4>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                        <li>
                            {/* Same business, different hostname — a plain anchor, not
                                next/link, because it leaves this deployment. */}
                            <a href={COMPANY_DETAILS.sites.company} className="hover:text-foreground">
                                Company home
                            </a>
                        </li>
                        <li>
                            <Link href="/" className="hover:text-foreground">
                                Store home
                            </Link>
                        </li>
                        <li>
                            <Link href="/shop" className="hover:text-foreground">
                                All products
                            </Link>
                        </li>
                        <li>
                            <Link href="/shop/cart" className="hover:text-foreground">
                                Cart
                            </Link>
                        </li>
                        <li>
                            <Link href="/shop/wishlist" className="hover:text-foreground">
                                Wishlist
                            </Link>
                        </li>
                        <li>
                            <Link href="/shop/compare" className="hover:text-foreground">
                                Compare
                            </Link>
                        </li>
                    </ul>
                </div>
                <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wide">Account</h4>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                        <li>
                            <Link href="/login" className="hover:text-foreground">
                                Customer sign in
                            </Link>
                        </li>
                        <li>
                            <Link href="/portal" className="hover:text-foreground">
                                Service portal
                            </Link>
                        </li>
                        <li>
                            <Link href="/staff/login" className="hover:text-foreground">
                                Staff sign in
                            </Link>
                        </li>
                    </ul>
                </div>
                <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wide">Contact</h4>
                    <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
                        <li className="flex gap-2">
                            <MapPin className="size-4 shrink-0 mt-0.5" />
                            <span>{addressLine}</span>
                        </li>
                        <li className="flex gap-2">
                            <Mail className="size-4 shrink-0 mt-0.5" />
                            <span>{COMPANY_DETAILS.contact.supportEmail}</span>
                        </li>
                    </ul>
                </div>
            </div>
            <AboutBusinessNote />

            <div className="border-t border-border/60 px-4 py-6 text-xs text-muted-foreground">
                <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
                    <p className="text-center sm:text-left">
                        © {new Date().getFullYear()} {COMPANY_DETAILS.brandName} · Prices in {COMPANY_DETAILS.currencySymbol}
                    </p>
                    <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                        {LEGAL_LINKS.map((link) => (
                            <Link key={link.href} href={link.href} className="hover:text-foreground hover:underline">
                                {link.label}
                            </Link>
                        ))}
                    </nav>
                </div>
                <div className="mx-auto mt-4 flex max-w-6xl justify-center sm:justify-end">
                    <PaymentMethodLogos />
                </div>
            </div>
        </footer>
    );
}
