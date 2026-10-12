import { Suspense } from "react";
import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import AttendanceExplorer from "@/modules/hr/components/AttendanceExplorer";

// /office/hr/activity — Employee Activity, list-and-detail like the Staff
// Directory: the staff on the left, and on the right the chosen person's month —
// the day-by-day breakup and the log of every stretch they were active — or,
// with nobody chosen, the day review: one day for the whole staff, where the
// till's figures are accepted or rejected before they may touch any pay.
//
// The Attendance register next door stays what it always was: the month for
// everybody, and the place a day is marked by hand.
//
// The sidebar tick in the layout opens the page; deciding a day is a write, so
// it needs the same grant as marking one on the register.
//
// The Suspense boundary is not decoration: the explorer reads the pick out of
// `?user=` with `useSearchParams`, and without a boundary around it the whole
// route bails out of server rendering with a recoverable error on every load.
export default async function EmployeeActivityPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_ATTENDANCE_EDIT);
    return (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Reading the staff…</div>}>
            <AttendanceExplorer canEdit={canEdit} />
        </Suspense>
    );
}
