import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Receipt } from "lucide-react";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { mobileUser } from "@/modules/mobile/mobileAccess";
import { quickEntryFor, screensFor } from "@/modules/mobile/mobileScreens";
import MobileHeader from "@/modules/mobile/MobileHeader";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** Home: every screen this person holds, as a tile. Sign out lives in the side menu. */
export default async function MobileHome() {
    const user = await mobileUser();
    const tiles = screensFor(user.permissions);
    const quick = quickEntryFor(user.permissions);

    return (
        <>
            <MobileHeader title={COMPANY_DETAILS.brandName} />
            <main className="flex flex-1 flex-col gap-4 p-4">
                <div>
                    <p className="text-xs text-muted-foreground">Signed in as</p>
                    <p className="text-lg font-semibold">{user.name}</p>
                </div>

                {(quick.receive || quick.pay) && (
                    <div className="grid grid-cols-3 gap-2">
                        {quick.receive && (
                            <Link href={`${PHONE_APP_HOME}/quick/receive`} className="flex flex-col items-center gap-1 rounded-xl bg-emerald-600 p-3 text-sm font-medium text-white active:opacity-90">
                                <ArrowDownLeft className="size-6" /> Receive
                            </Link>
                        )}
                        {quick.pay && (
                            <Link href={`${PHONE_APP_HOME}/quick/pay`} className="flex flex-col items-center gap-1 rounded-xl bg-primary p-3 text-sm font-medium text-primary-foreground active:opacity-90">
                                <ArrowUpRight className="size-6" /> Pay
                            </Link>
                        )}
                        {quick.pay && (
                            <Link href={`${PHONE_APP_HOME}/quick/expense`} className="flex flex-col items-center gap-1 rounded-xl bg-amber-600 p-3 text-sm font-medium text-white active:opacity-90">
                                <Receipt className="size-6" /> Expense
                            </Link>
                        )}
                    </div>
                )}

                {tiles.length === 0 ? (
                    <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                        No phone screens are ticked for your role yet. Ask admin to tick one
                        under Role → Global (the &ldquo;Mobile: …&rdquo; ticks).
                    </p>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {tiles.map(({ href, label, hint, icon: Icon }) => (
                            <Link key={href} href={href} className="flex flex-col gap-2 rounded-xl border bg-card p-4 active:bg-muted">
                                <Icon className="size-7 text-primary" />
                                <span className="font-medium">{label}</span>
                                <span className="text-xs text-muted-foreground">{hint}</span>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </>
    );
}
