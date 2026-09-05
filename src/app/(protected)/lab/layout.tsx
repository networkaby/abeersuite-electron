import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { redirectIfPcWithoutCounter } from "@/shared/lib/auth/permissions";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";
import LabTopBar from "@/modules/lab/components/LabTopBar";

/**
 * Lab layout — deliberately lighter than /office.
 * No Sidebar, no FinanceTopBar, no module dialogs. Clean canvas to
 * prototype the Front-Office / Back-Office split without touching /office.
 *
 * Auth guard is the same as /office (logged-in staff only). Permission
 * gates on the lab pages themselves are intentionally absent — see plan.
 */
export default async function LabLayout({
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
        name?: string | null;
        roleLabel?: string;
    };

    return (
        <SessionWrapper session={session}>
            <div className="flex h-screen flex-col overflow-hidden bg-background">
                <LabTopBar
                    userName={user.name ?? null}
                    roleLabel={user.roleLabel ?? null}
                />
                <main className="flex-1 overflow-y-auto">{children}</main>
                <Toaster richColors />
            </div>
        </SessionWrapper>
    );
}
