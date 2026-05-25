import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/shared/components/Sidebar";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";
import QuickTicketButton from "@/shared/components/QuickTicketButton";
import ButtonBar from "@/shared/components/ButtonBar";
import GlobalInboxListener from "@/modules/message/components/GlobalInboxListener";
import FinanceTopBar from "@/shared/components/FinanceTopBar";
import { JournalVoucherDialog } from "@/modules/accountancy/components/JournalVoucherDialog";
import {
    PaymentDialog,
    ReceiptDialog,
    CreditNoteDialog,
    DebitNoteDialog,
} from "@/modules/accountancy/components/GlVoucherDialog";
// Sale + Purchase moved to full-page routes (/sale, /purchase). Sale Return
// + Purchase Return are full-page at /sale-return + /purchase-return.
// Only Estimate keeps the dialog flow for now.
import { EstimateDialog } from "@/modules/accountancy/components/TradingVoucherForm";

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
            <div className="flex h-screen flex-col overflow-hidden bg-background">
                {/* Top bar spans full width — not affected by sidebar/buttonbar width */}
                <FinanceTopBar permissions={user.permissions ?? []} />
                <div className="flex flex-1 overflow-hidden">
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
                </div>{/* end flex row */}
                <Toaster richColors />
                <QuickTicketButton />
                <JournalVoucherDialog />
                <PaymentDialog />
                <ReceiptDialog />
                <CreditNoteDialog />
                <DebitNoteDialog />
                <EstimateDialog />
                <GlobalInboxListener currentUserId={userId} />
            </div>
        </SessionWrapper>
    );
}
