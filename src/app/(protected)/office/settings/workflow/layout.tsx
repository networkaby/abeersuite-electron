import { WorkflowTabsNav } from "@/modules/admin/components/WorkflowTabsNav";

// Viewing workflow masters (statuses, pipelines, workers, works) is a read —
// default-open for signed-in staff; the sidebar tick decides who sees the link.
// Write APIs keep their settings:manage gates.
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
