import Link from "next/link";
import { Boxes, Users } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { holds, mobileUser } from "@/modules/mobile/mobileAccess";
import MobileSignOut from "@/modules/mobile/MobileSignOut";

/** Each tile is one phone screen and the tick that opens it. A new screen (a rider's
 *  deliveries, a salesman's orders) is one more row here plus its `mobile:*` tick. */
const TILES = [
    { href: "/m/stock", label: "Stock & price", hint: "Available qty, sale price", icon: Boxes, permission: PERMISSIONS.MOBILE_STOCK_VIEW },
    { href: "/m/parties", label: "Party balance", hint: "Balance, unpaid bills", icon: Users, permission: PERMISSIONS.MOBILE_PARTIES_VIEW },
];

export default async function MobileHome() {
    const user = await mobileUser();
    const tiles = TILES.filter((t) => holds(user, t.permission));

    return (
        <main className="flex flex-1 flex-col gap-4 p-4">
            <header className="flex items-center justify-between">
                <div>
                    <p className="text-xs text-muted-foreground">Signed in as</p>
                    <h1 className="text-lg font-semibold">{user.name}</h1>
                </div>
                <MobileSignOut />
            </header>

            {tiles.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                    No phone screens are ticked for your role yet. Ask admin to tick
                    &ldquo;Mobile: stock &amp; price&rdquo; or &ldquo;Mobile: party balance&rdquo;.
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
    );
}
