import Link from "next/link";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { mobileUser } from "@/modules/mobile/mobileAccess";
import { screensFor } from "@/modules/mobile/mobileScreens";
import MobileHeader from "@/modules/mobile/MobileHeader";

/** Home: every screen this person holds, as a tile. Sign out lives in the side menu. */
export default async function MobileHome() {
    const user = await mobileUser();
    const tiles = screensFor(user.permissions);

    return (
        <>
            <MobileHeader title={COMPANY_DETAILS.brandName} />
            <main className="flex flex-1 flex-col gap-4 p-4">
                <div>
                    <p className="text-xs text-muted-foreground">Signed in as</p>
                    <p className="text-lg font-semibold">{user.name}</p>
                </div>

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
