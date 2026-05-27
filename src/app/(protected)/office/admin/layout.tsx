import { auth } from "@/auth";
import { AdminNav } from "@/modules/admin/components/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    return (
        <div className="flex h-full flex-col">
            <div className="flex-none px-6 pt-6">
                <AdminNav permissions={permissions} />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
