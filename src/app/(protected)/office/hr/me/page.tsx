import { auth } from "@/auth";
import MyHrPage from "@/modules/hr/components/MyHrPage";

// /office/hr/me — "My Info". The one HR page a person is given for themselves.
//
// No capability flag to work out: the page shows the signed-in person's own
// record and offers no action on anybody else, so there is nothing here to
// grant beyond the sidebar tick the layout already demands. The userId goes
// down only for the payslip route, which checks self-or-HR on its own side.
export default async function Page() {
    const session = await auth();
    const userId = Number((session?.user as { id?: string } | undefined)?.id ?? 0);
    return <MyHrPage userId={userId} />;
}
