import { auth } from "@/auth";
import { crudFlags } from "@/shared/lib/auth/permissionScope";
import { RecurringTaskList } from "@/modules/administration/components";

export default async function RecurringTasksPage() {
    const session = await auth();
    const sessionUser = session?.user as { permissions?: string[] } | undefined;
    // Recurring definitions share the tasks:* rungs — one recurring row is just a
    // task that keeps coming back, so it does not need its own permission family.
    const { canCreate, canEdit, canDelete } = crudFlags(sessionUser?.permissions ?? [], "tasks");

    // Assignable seats are no longer read here: the list pulls them from the
    // browser's cached copy (usePositionPicker), so opening this page costs no
    // position query at all.
    return (
        <div className="h-full px-6 py-5">
            <RecurringTaskList
                canCreate={canCreate}
                canEdit={canEdit}
                canDelete={canDelete}
            />
        </div>
    );
}
