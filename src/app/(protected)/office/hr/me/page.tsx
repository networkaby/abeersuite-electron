import { auth } from "@/auth";
import MyHrPage from "@/modules/hr/components/MyHrPage";

// /office/hr/me — "My Info". The one HR page a person is given for themselves.
//
// Nothing here is granted beyond the sidebar tick the layout already demands —
// the page shows the signed-in person's own record and offers no action on
// anybody else. The userId goes down only for the payslip route, which checks
// self-or-HR on its own side. The leave-notice rule binds everybody here — HR's
// exemption is for filing on somebody else's behalf, which is done on the Leave
// board, not on one's own page.
export default async function Page() {
    const session = await auth();
    const userId = Number((session?.user as { id?: string } | undefined)?.id ?? 0);
    return <MyHrPage userId={userId} />;
}
