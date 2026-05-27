import { auth } from "@/auth";
import { MastersNav } from "./_components/MastersNav";
import { MastersBreadcrumb } from "./_components/MastersBreadcrumb";

export default async function AccountancyMastersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    return (
        <div className="flex h-full flex-col">
            <MastersBreadcrumb />
            <div className="flex-none px-6">
                <MastersNav permissions={permissions} />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
