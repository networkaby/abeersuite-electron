import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Receipt, Send } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { whatsappWaiting } from "@/modules/campaigns/lib/postServer";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { BUSINESS_TIME_ZONE } from "@/shared/lib/constants/business";
import { loginGreeting } from "@/shared/lib/constants/loginShowcase";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import { quickEntryFor, screensFor } from "@/modules/mobile/lib/mobileScreens";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import { PHONE_APP_APK, PHONE_APP_HOME, PHONE_APP_UA } from "@/shared/lib/device/phone";
import { AppVersionLine } from "@/shared/components/AppUpdateBar";
import { STAFF_APP_RELEASE } from "@/shared/lib/constants/appVersions";

/** The shop's hour, not the server's — the server runs in UTC. */
function shopHour(): number {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: BUSINESS_TIME_ZONE }).format(new Date()));
}

const quickButton = "flex h-24 flex-col items-center justify-center gap-2 rounded-2xl text-sm font-semibold shadow-sm active:scale-[.97] transition-transform";
const quickIcon = "flex size-10 items-center justify-center rounded-full bg-white/20";

/** Home: every screen this person holds, as a tile. Sign out lives in the side menu. */
export default async function MobileHome() {
    const user = await mobileUser();
    const tiles = screensFor(user.permissions);
    const quick = quickEntryFor(user.permissions);
    // What is waiting for WhatsApp shows the moment the app opens (no timer — owner, 2026-10-23).
    const sharesPosts = tiles.some((t) => t.permission === PERMISSIONS.MOBILE_POSTS_SHARE);
    const { posts: waiting, due } = sharesPosts ? await whatsappWaiting() : { posts: [], due: 0 };

    return (
        <>
            <MobileHeader title={COMPANY_DETAILS.brandName} />
            <main className="flex flex-1 flex-col gap-5 p-4">
                <section className="rounded-2xl bg-primary px-5 py-4 text-primary-foreground shadow-sm">
                    <p className="text-sm opacity-80">{loginGreeting(shopHour())}</p>
                    <p className="truncate text-xl font-semibold">{user.name}</p>
                </section>

                {waiting.length > 0 && (
                    <Link
                        href={`${PHONE_APP_HOME}/posts`}
                        className={`flex items-center gap-4 rounded-2xl border px-4 py-3.5 shadow-sm active:bg-muted ${due > 0 ? "border-amber-400 bg-amber-50" : "bg-card"}`}
                    >
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                            <Send className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block font-medium">
                                {waiting.length} {waiting.length === 1 ? "post" : "posts"} to share on WhatsApp
                            </span>
                            <span className="block text-sm text-muted-foreground">{due > 0 ? `${due} due now` : "Channel / Status"}</span>
                        </span>
                        <ChevronRight className="size-5 text-muted-foreground" />
                    </Link>
                )}

                {(quick.receive || quick.pay) && (
                    <div className="grid grid-cols-3 gap-3">
                        {quick.receive && (
                            <Link href={`${PHONE_APP_HOME}/quick/receive`} className={`${quickButton} bg-emerald-600 text-white`}>
                                <span className={quickIcon}><ArrowDownLeft className="size-5" /></span> Receive
                            </Link>
                        )}
                        {quick.pay && (
                            <Link href={`${PHONE_APP_HOME}/quick/pay`} className={`${quickButton} bg-sky-600 text-white`}>
                                <span className={quickIcon}><ArrowUpRight className="size-5" /></span> Pay
                            </Link>
                        )}
                        {quick.pay && (
                            <Link href={`${PHONE_APP_HOME}/quick/expense`} className={`${quickButton} bg-amber-600 text-white`}>
                                <span className={quickIcon}><Receipt className="size-5" /></span> Expense
                            </Link>
                        )}
                    </div>
                )}

                {tiles.length === 0 ? (
                    <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
                        No phone screens are ticked for your role yet. Ask admin to tick one
                        under Role → Global (the &ldquo;Mobile: …&rdquo; ticks).
                    </p>
                ) : (
                    <section>
                        <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Open</h2>
                        <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
                            {tiles.map(({ href, label, hint, icon: Icon }) => (
                                <li key={href}>
                                    <Link href={href} className="flex items-center gap-4 px-4 py-3.5 active:bg-muted">
                                        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                            <Icon className="size-5" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-medium">{label}</span>
                                            <span className="block truncate text-sm text-muted-foreground">{hint}</span>
                                        </span>
                                        <ChevronRight className="size-5 text-muted-foreground" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
                <AppVersionLine uaTag={PHONE_APP_UA} release={STAFF_APP_RELEASE} apkUrl={`${COMPANY_DETAILS.sites.office}.${PHONE_APP_APK}`} />
            </main>
        </>
    );
}
