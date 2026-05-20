import { auth } from "@/auth";
import { AdminNav } from "@/modules/admin/components/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    return (
        <div className="container max-w-7xl py-0 space-y-0">
            <AdminNav permissions={permissions} />
            {children}
        </div>
    );
}
