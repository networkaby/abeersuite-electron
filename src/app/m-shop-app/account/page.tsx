import Link from "next/link";
import { ChevronRight, MessageCircle, Phone, UserRound } from "lucide-react";
import { auth } from "@/auth";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import AppSignOutButton from "@/modules/external/shopApp/AppSignOutButton";
import PortalProfileSwitch from "@/modules/external/portal/PortalProfileSwitch";
import { PORTAL_NAV_ITEMS } from "@/modules/external/portal/portalNav";
import { APP, appLoginPath } from "@/modules/external/shopApp/appPaths";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { LEGAL_LINKS } from "@/shared/lib/legal/legalContent";
import { AppVersionLine } from "@/shared/components/AppUpdateBar";
import { SHOP_APP_RELEASE } from "@/shared/lib/constants/appVersions";
import { SHOP_APP_INSTALL, SHOP_NATIVE_UA } from "@/shared/lib/device/shopApp";

const ROW = "flex items-center gap-3 px-4 py-3.5 text-[15px] active:bg-muted";
const CARD = "overflow-hidden rounded-2xl border border-border/70 bg-background divide-y divide-border/60";

/** Every portal screen has an app screen of the same name: /portal/bills → /m-shop-app/bills. */
const appHref = (portalHref: string) => `${APP}${portalHref.slice("/portal".length)}`;
const SCREENS = PORTAL_NAV_ITEMS.filter((i) => i.href !== "/portal");
/** The four most used, as tiles on top (as in Flipkart); the rest as a list. */
const TILES = ["/portal/orders", "/portal/bills", "/portal/repairs", "/portal/wishlist"];

/**
 * Account tab: who is signed in and the profile in use, quick tiles, every
 * other portal screen (the same list as the portal sidebar), help, policies,
 * Sign out. Signed out, it offers the sign-in instead.
 */
export default async function CustomerAppAccountPage() {
    const session = await auth();
    const user = session?.user as { kind?: string; name?: string | null } | undefined;
    const signedIn = user?.kind === "customer";
    const { phone, whatsapp } = COMPANY_DETAILS.contact;

    return (
        <>
            <MobileHeader title="Account" menu={false} />
            <main className="space-y-4 px-4 py-4">
                {signedIn ? (
                    <>
                        <div className="flex items-center gap-3">
                            <span className="flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
                                <UserRound className="size-6" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-base font-semibold">{user.name ?? "Customer"}</p>
                                <Link href={`${APP}/profile`} className="text-xs text-primary">
                                    Edit profile
                                </Link>
                            </div>
                            <PortalProfileSwitch />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {SCREENS.filter((s) => TILES.includes(s.href)).map(({ href, label, icon: Icon }) => (
                                <Link key={href} href={appHref(href)} className="flex items-center gap-2.5 rounded-xl border bg-background px-3 py-3 text-sm font-medium active:bg-muted">
                                    <Icon className="size-5 text-primary" />
                                    {label.replace(/^My /, "")}
                                </Link>
                            ))}
                        </div>
                        <ul className={CARD}>
                            {SCREENS.filter((s) => !TILES.includes(s.href)).map(({ href, label, icon: Icon }) => (
                                <li key={href}>
                                    <Link href={appHref(href)} className={ROW}>
                                        <Icon className="size-5 text-primary" />
                                        <span className="flex-1">{label}</span>
                                        <ChevronRight className="size-4 text-muted-foreground" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </>
                ) : (
                    <div className="space-y-3 rounded-2xl border border-border/70 bg-background p-4">
                        <p className="text-base font-semibold">Sign in to see your orders, bills and repairs</p>
                        <Link
                            href={appLoginPath(`${APP}/account`)}
                            className="flex h-12 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90"
                        >
                            Sign in
                        </Link>
                    </div>
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
                            <Link href={`${APP}/policy${l.href}`} className={`${ROW} text-sm`}>
                                <span className="flex-1">{l.label}</span>
                                <ChevronRight className="size-4 text-muted-foreground" />
                            </Link>
                        </li>
                    ))}
                </ul>

                {signedIn && <AppSignOutButton />}
                <AppVersionLine uaTag={SHOP_NATIVE_UA} release={SHOP_APP_RELEASE} installUrl={`${COMPANY_DETAILS.sites.shop}.${SHOP_APP_INSTALL}`} />
            </main>
        </>
    );
}
