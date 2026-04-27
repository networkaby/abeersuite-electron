import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/modules/shared/components/Sidebar";
import { Toaster } from "sonner";
import SessionWrapper from "@/modules/shared/components/SessionWrapper";
import QuickTicketButton from "@/modules/shared/components/QuickTicketButton";
import ButtonBar from "@/modules/shared/components/ButtonBar";
import GlobalInboxListener from "@/modules/message/components/GlobalInboxListener";

export default async function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    if (!session) redirect("/login");

    const user = session.user as {
        id?: string | null;
        name?: string | null;
        role?: string;
        roles?: string[];
        permissions?: string[];
    };

    const userId = user.id ? parseInt(user.id, 10) : undefined;

    return (
        <SessionWrapper>
            <div className="flex min-h-screen bg-background">
                <Sidebar user={{
                    name: user.name,
                    role: user.role,
                    roles: user.roles,
                    permissions: user.permissions,
                }} />
                <main className="flex-1 p-8 overflow-auto">{children}</main>
                <ButtonBar user={{
                    name: user.name,
                    role: user.role,
                    roles: user.roles,
                    permissions: user.permissions,
                }} />
                <Toaster richColors />
                <QuickTicketButton />
                {/* Always-on inbox listener — fires notifications on any page */}
                <GlobalInboxListener currentUserId={userId} />
            </div>
        </SessionWrapper>
    );
}
