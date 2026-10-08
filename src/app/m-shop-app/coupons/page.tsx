import { Percent } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";
import { getMockCoupons } from "@/shared/lib/portal/mockAdapters";

/** My Coupons — the same list as the portal's (still its sample data; see PROJECT_BRAIN). */
export default async function CustomerAppCouponsPage() {
    await requireAppCustomer(`${APP}/coupons`);
    const coupons = await getMockCoupons();
    return (
        <>
            <MobileHeader title="My coupons" back={`${APP}/account`} />
            <ul className="space-y-2 p-3">
                {coupons.map((c) => (
                    <li key={c.id} className="flex overflow-hidden rounded-2xl border bg-background">
                        <span className={`flex w-16 shrink-0 items-center justify-center ${c.state === "active" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                            <Percent className="size-6" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-1 border-l border-dashed p-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className="font-mono text-[15px] font-semibold">{c.code}</p>
                                <span className="text-[11px] capitalize text-muted-foreground">{c.state}</span>
                            </div>
                            <p className="text-sm">{c.title}</p>
                            <p className="text-xs text-muted-foreground">{c.description}</p>
                            <p className="text-[11px] text-muted-foreground">Valid till {c.expiresAt}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
}
