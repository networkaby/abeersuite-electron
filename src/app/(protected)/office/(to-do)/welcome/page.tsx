import Link from "next/link";
import { Building2, UserCircle2 } from "lucide-react";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
    const session = await auth();
    const user = session?.user as {
        id?: string | null;
        name?: string | null;
        branchIds?: string[];
    } | undefined;

    const name = user?.name ?? "there";
    const hasNoBranch = (user?.branchIds?.length ?? 0) === 0;

    return (
        <div className="mx-auto flex max-w-xl flex-col items-center gap-6 pt-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Building2 size={32} className="text-muted-foreground" />
            </div>

            <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-foreground">
                    Welcome, {name}
                </h1>
                <p className="text-sm text-muted-foreground">
                    {hasNoBranch
                        ? "Your account is active, but you haven't been assigned to a branch or position yet."
                        : "Your account is active. You can browse your profile and the social wall while an administrator finishes assigning you."}
                </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 text-left text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">What happens next?</p>
                <p>
                    An administrator needs to assign you to a position (e.g., Cashier,
                    Branch Manager, or a department role). Once that&apos;s done, the
                    operational menus will unlock and you can start working.
                </p>
            </div>

            <div className="flex gap-2">
                {user?.id && (
                    <Link
                        href={`/office/user/${user.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
                    >
                        <UserCircle2 size={14} />
                        View my profile
                    </Link>
                )}
            </div>
        </div>
    );
}
