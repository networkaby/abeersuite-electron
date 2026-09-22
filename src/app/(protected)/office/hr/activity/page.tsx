import { Suspense } from "react";
import AttendanceExplorer from "@/modules/hr/components/AttendanceExplorer";

// /office/hr/activity — Employee Activity, list-and-detail like the Staff
// Directory: the staff on the left, and on the right the chosen person's month —
// the day-by-day breakup and the log of every stretch they were active.
//
// The Attendance register next door stays what it always was: the month for
// everybody, and the place a day is marked by hand.
//
// Nothing is written here, so there is no edit grant to read — the sidebar tick
// in the layout is the whole gate.
//
// The Suspense boundary is not decoration: the explorer reads the pick out of
// `?user=` with `useSearchParams`, and without a boundary around it the whole
// route bails out of server rendering with a recoverable error on every load.
export default function EmployeeActivityPage() {
    return (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Reading the staff…</div>}>
            <AttendanceExplorer />
        </Suspense>
    );
}
