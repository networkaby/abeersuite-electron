import { Wrench } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import PortalProfileSwitch from "@/modules/external/portal/PortalProfileSwitch";
import { loadPortalRepairs } from "@/modules/external/portal/portalRepairs";
import { requireAppCustomerProfile } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/** My Repairs — the profile's service tickets with where each one is now (same list as the portal). */
export default async function CustomerAppRepairsPage() {
    const { active } = await requireAppCustomerProfile(`${APP}/repairs`);
    const repairs = await loadPortalRepairs(active.accountId);
    const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

    return (
        <>
            <MobileHeader title="My repairs" back={`${APP}/account`} actions={<PortalProfileSwitch className="mr-1" />} />
            {repairs.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-8 py-20 text-center">
                    <span className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Wrench className="size-9" />
                    </span>
                    <p className="text-lg font-semibold">No repairs for {active.label}</p>
                    <p className="text-sm text-muted-foreground">When you give us a device for service, you can follow it here.</p>
                    <a href={`tel:${COMPANY_DETAILS.contact.phone.replace(/\s/g, "")}`} className="mt-2 text-sm font-medium text-primary">
                        Call the shop
                    </a>
                </div>
            ) : (
                <ul className="space-y-2 py-2">
                    {repairs.map((r) => (
                        <li key={r.id} className="space-y-2 bg-background px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="truncate text-[15px] font-medium">{r.device || "Device"}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Ticket #{r.id} · given {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{r.status}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">Last update {when(r.updatedAt)}</p>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
