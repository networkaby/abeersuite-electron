import { auth } from "@/auth";
import { SettingsNav } from "@/modules/admin/components/SettingsNav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    return (
        <div className="container max-w-7xl py-0 space-y-0">
            <SettingsNav permissions={permissions} />
            {children}
        </div>
    );
}
