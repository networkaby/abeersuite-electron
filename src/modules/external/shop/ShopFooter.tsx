import Link from "next/link";
import { Package, Mail, MapPin } from "lucide-react";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";

export default function ShopFooter() {
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
                        <Package className="size-5 text-primary" />
                        {COMPANY_DETAILS.brandName}
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                        {COMPANY_DETAILS.description} Same session as your customer portal and service team.
                    </p>
                </div>
                <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wide">Shop</h4>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                        <li>
                            <Link href="/" className="hover:text-foreground">
                                Home
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
            <div className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
                © {new Date().getFullYear()} {COMPANY_DETAILS.brandName} · Prices in {COMPANY_DETAILS.currencySymbol} · Payments via Razorpay when configured
            </div>
        </footer>
    );
}
