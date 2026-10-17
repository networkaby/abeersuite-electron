import { redirect } from "next/navigation";
import { auth } from "@/auth";
import SessionWrapper from "@/shared/components/SessionWrapper";
import GlobalInboxListener from "@/modules/message/components/GlobalInboxListener";
import CallFollowUpPopup from "@/modules/pos/components/CallFollowUpPopup";
import MessageAlertPopup from "@/modules/message/components/MessageAlertPopup";
import StaffPushRegister from "@/modules/mobile/components/StaffPushRegister";

// Shared auth wrapper for /vouchers/pos/* routes.
// The list page (/vouchers/pos) renders inside the normal office chrome via
// the parent layout. The register (/vouchers/pos/new) has its own nested
// layout that adds the fixed-inset-0 standalone shell.
//
// GlobalInboxListener is mounted here too (not just office/layout.tsx) so a
// counter operator gets sound/browser notification for incoming chat while on
// the bare-chrome POS register — same as everywhere else in the app.
//
// CallFollowUpPopup rides the same reasoning: the register is exactly where a
// counter takes calls, so it needs the call follow-up reminder mounted here
// too, not just in the office chrome. MessageAlertPopup (customer WhatsApp
// messages) likewise.

export default async function PosLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string; id?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos");

    const userId = user.id ? parseInt(user.id, 10) : undefined;

    return (
        <SessionWrapper session={session}>
            {children}
            <GlobalInboxListener currentUserId={userId} />
            <CallFollowUpPopup />
            <MessageAlertPopup />
            <StaffPushRegister />
        </SessionWrapper>
    );
}
