import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { redirectIfPcWithoutCounter } from "@/shared/lib/auth/permissions";
import Sidebar from "@/shared/components/Sidebar";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";
import QuickTicketButton from "@/shared/components/QuickTicketButton";
import SlSearchDialog from "@/shared/components/SlSearchDialog";
import ButtonBar from "@/shared/components/ButtonBar";
import ModuleSurface from "@/shared/components/ModuleSurface";
import GlobalInboxListener from "@/modules/message/components/GlobalInboxListener";
import CallFollowUpPopup from "@/modules/pos/components/CallFollowUpPopup";
import MessageAlertPopup from "@/modules/message/components/MessageAlertPopup";
import StaffPushRegister from "@/modules/mobile/components/StaffPushRegister";
import FinanceTopBar from "@/shared/components/FinanceTopBar";
import NoAccessNotice from "@/shared/components/NoAccessNotice";
import { Suspense } from "react";

export default async function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    if (!session) redirect("/staff/login");

    const kind = (session.user as { kind?: string }).kind;
    if (kind === "customer") {
        redirect("/portal");
    }
    redirectIfPcWithoutCounter();

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
        <SessionWrapper session={session}>
            <div className="flex h-screen flex-col overflow-hidden bg-background">
                {/* Top bar spans full width — not affected by sidebar/buttonbar width */}
                <FinanceTopBar permissions={user.permissions ?? []} />
                <div className="flex flex-1 overflow-hidden">
                    <Sidebar user={{
                        id: user.id,
                        name: user.name,
                        role: user.role,
                        roles: user.roles,
                        permissions: user.permissions,
                        roleLabel: user.roleLabel,
                        roleColor: user.roleColor,
                        avatarUrl: user.avatarUrl,
                    }} />
                    <main className="flex-1 overflow-hidden">
                        <ModuleSurface>{children}</ModuleSurface>
                    </main>
                    <ButtonBar user={{
                        name: user.name,
                        role: user.role,
                        roles: user.roles,
                        permissions: user.permissions,
                    }} />
                </div>{/* end flex row */}
                <Toaster richColors />
                <Suspense fallback={null}><NoAccessNotice /></Suspense>
                <QuickTicketButton />
                <SlSearchDialog />
                <GlobalInboxListener currentUserId={userId} />
                <CallFollowUpPopup />
                <MessageAlertPopup />
                <StaffPushRegister />
            </div>
        </SessionWrapper>
    );
}
