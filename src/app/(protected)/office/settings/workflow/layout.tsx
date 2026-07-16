import { WorkflowTabsNav } from "@/modules/admin/components/WorkflowTabsNav";

// Workflow masters (statuses, pipelines, workers, works) — view and edit are both
// open to signed-in staff; the Settings sidebar tick decides who sees the link.
export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <div className="flex-none px-6 pt-3">
                <WorkflowTabsNav />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
