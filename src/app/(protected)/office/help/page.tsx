import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { hasModuleNavAccess, crudFlags } from "@/shared/lib/auth/permissionScope";
import { getHelpPipeline } from "@/modules/help/lib/helpPipeline";
import { HelpWorkspace } from "@/modules/help/components";

export default async function HelpDeskPage() {
    const session = await auth();
    const sessionUser = session?.user as { id?: string; permissions?: string[] } | undefined;
    const permissions = sessionUser?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "help")) {
        redirect("/office/work-flow-inbox");
    }
    // Nav access above decides "may you open the board"; these decide what you may
    // DO on it. (crudFlags already passes admin:bypass and the CRUD ladder.)
    const { canCreate, canEdit, canDelete } = crudFlags(permissions, "help");

    const pipeline = await getHelpPipeline(prisma);
    if (!pipeline) {
        return (
            <div className="px-6 py-5">
                <h1 className="text-xl font-semibold">Help Desk</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Help Desk pipeline missing — run <code className="text-foreground">pnpm seed:apply-help-pipeline</code>.
                </p>
            </div>
        );
    }

    // Seats and "which are mine" come from the browser's cached copy
    // (usePositionPicker) — this page reads only the pipeline it is named for.
    const stages = pipeline.statuses.map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        order: s.order,
        isTerminal: s.isTerminal,
    }));

    return (
        <div className="h-full px-6 py-5">
            <HelpWorkspace
                stages={stages}
                canCreate={canCreate}
                canEdit={canEdit}
                canDelete={canDelete}
            />
        </div>
    );
}
