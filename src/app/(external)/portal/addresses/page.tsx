import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PortalAddressesView from "@/modules/external/portal/PortalAddressesView";

export default async function PortalAddressesPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/addresses");
    }
    return <PortalAddressesView />;
}
