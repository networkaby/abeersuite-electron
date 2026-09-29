import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NO_ACCESS_HOME, NO_ACCESS_PARAM } from "@/shared/lib/auth/pageAccess";
import { filterMastersNav, MASTERS_NAV_LINKS } from "./_components/masters-nav";

// The Masters link opens the first tab this person may open — Account Groups for
// most, but not for someone ticked only for Ledgers, who would land on "no access".
export default async function AccountancyMastersPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    redirect(filterMastersNav(MASTERS_NAV_LINKS, permissions)[0]?.href ?? `${NO_ACCESS_HOME}?${NO_ACCESS_PARAM}=1`);
}
