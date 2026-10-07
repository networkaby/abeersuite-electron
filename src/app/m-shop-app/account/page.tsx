import Link from "next/link";
import { ChevronRight, MessageCircle, Phone, UserRound } from "lucide-react";
import { auth } from "@/auth";
import AppTopBar from "@/modules/external/shopApp/AppTopBar";
import AppSignOutButton from "@/modules/external/shopApp/AppSignOutButton";
import { PORTAL_NAV_ITEMS } from "@/modules/external/portal/portalNav";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { LEGAL_LINKS } from "@/shared/lib/legal/legalContent";
import { SHOP_NATIVE_HOME } from "@/shared/lib/device/shopApp";

const ROW = "flex items-center gap-3 px-4 py-3.5 text-[15px] active:bg-muted";
const CARD = "overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/60";

/**
 * Account tab: every portal screen (the same list as the portal sidebar), help,
 * the policies and Sign out. Signed out, it offers the sign-in instead — OTP or
 * password; the sign-in page hides Google inside the app.
 */
export default async function CustomerAppAccountPage() {
    const session = await auth();
    const user = session?.user as { kind?: string; name?: string | null } | undefined;
    const signedIn = user?.kind === "customer";
    const { phone, whatsapp } = COMPANY_DETAILS.contact;

    return (
        <>
            <AppTopBar title="Account" />
            <main className="space-y-5 px-4 py-4">
                {signedIn ? (
                    <div className="flex items-center gap-3">
                        <span className="flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
                            <UserRound className="size-6" />
                        </span>
                        <div className="min-w-0">
                            <p className="truncate text-base font-semibold">{user.name ?? "Customer"}</p>
                            <Link href="/portal/profile" className="text-xs text-primary">View profile</Link>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
                        <p className="text-base font-semibold">Sign in to see your orders, bills and repairs</p>
                        <Link
                            href={`/login?callbackUrl=${encodeURIComponent(`${SHOP_NATIVE_HOME}/account`)}`}
                            className="flex h-12 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90"
                        >
                            Sign in
                        </Link>
                    </div>
                )}

                {signedIn && (
                    <ul className={CARD}>
                        {PORTAL_NAV_ITEMS.filter((i) => i.href !== "/portal").map(({ href, label, icon: Icon }) => (
                            <li key={href}>
                                <Link href={href} className={ROW}>
                                    <Icon className="size-5 text-primary" />
                                    <span className="flex-1">{label}</span>
                                    <ChevronRight className="size-4 text-muted-foreground" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}

                <ul className={CARD}>
                    <li>
                        <a href={`tel:${phone.replace(/\s/g, "")}`} className={ROW}>
                            <Phone className="size-5 text-primary" />
                            <span className="flex-1">Call the shop</span>
                            <span className="text-xs text-muted-foreground">{phone}</span>
                        </a>
                    </li>
                    <li>
                        <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} className={ROW}>
                            <MessageCircle className="size-5 text-emerald-600" />
                            <span className="flex-1">WhatsApp us</span>
                        </a>
                    </li>
                </ul>

                <ul className={CARD}>
                    {LEGAL_LINKS.map((l) => (
                        <li key={l.href}>
                            <Link href={l.href} className={`${ROW} text-sm`}>
                                <span className="flex-1">{l.label}</span>
                                <ChevronRight className="size-4 text-muted-foreground" />
                            </Link>
                        </li>
                    ))}
                </ul>

                {signedIn && <AppSignOutButton />}
            </main>
        </>
    );
}
