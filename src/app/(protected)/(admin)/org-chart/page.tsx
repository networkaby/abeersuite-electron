"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { Users } from "lucide-react";
import type { OrgNode } from "@/app/api/org-chart/route";
import OrgTree from "@/modules/admin/components/OrgTree";

export default function OrgChartPage() {
    const { data: session } = useSession();
    const [roots, setRoots] = useState<OrgNode[]>([]);
    const [loading, setLoading] = useState(true);

    const currentUserId = session?.user
        ? Number((session.user as { id?: string }).id)
        : undefined;

    useEffect(() => {
        axios.get<OrgNode[]>("/api/org-chart")
            .then(r => setRoots(r.data))
            .catch(() => {/* toast handled by layout */})
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                Loading org chart…
            </div>
        );
    }

    if (roots.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <Users size={36} className="opacity-20" />
                <p className="text-sm">No users yet. Add staff from the Users page.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Org Chart</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Click any card to view the full profile. Use the toggle to collapse branches.
                </p>
            </div>

            <OrgTree roots={roots} highlightId={currentUserId} />
        </div>
    );
}
