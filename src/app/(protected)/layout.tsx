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

    const kind = (session.user as { kind?: string }).kind;
    if (kind === "customer") {
        redirect("/portal");
    }

    const user = session.user as {
        id?: string | null;
        name?: string | null;
        role?: string;
        roles?: string[];
        permissions?: string[];
        roleLabel?: string;
        roleColor?: string;
        avatarUrl?: string;
    };

    const userId = user.id ? parseInt(user.id, 10) : undefined;

    return (
        <SessionWrapper>
            <div className="flex h-screen overflow-hidden bg-background">
                <Sidebar user={{
                    id:          user.id,
                    name:        user.name,
                    role:        user.role,
                    roles:       user.roles,
                    permissions: user.permissions,
                    roleLabel:   user.roleLabel,
                    roleColor:   user.roleColor,
                    avatarUrl:   user.avatarUrl,
                }} />
                <main className="flex-1 overflow-y-auto p-8">{children}</main>
                <ButtonBar user={{
                    name:        user.name,
                    role:        user.role,
                    roles:       user.roles,
                    permissions: user.permissions,
                }} />
                <Toaster richColors />
                <QuickTicketButton />
                <GlobalInboxListener currentUserId={userId} />
            </div>
        </SessionWrapper>
    );
}
