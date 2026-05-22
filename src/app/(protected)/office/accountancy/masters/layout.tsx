import { auth } from "@/auth";
import { MastersNav } from "@/modules/accountancy/components/MastersNav";
import { MastersBreadcrumb } from "@/modules/accountancy/components/MastersBreadcrumb";

export default async function AccountancyMastersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    return (
        <div className="container max-w-7xl">
            <MastersBreadcrumb />
            <MastersNav permissions={permissions} />
            {children}
        </div>
    );
}
