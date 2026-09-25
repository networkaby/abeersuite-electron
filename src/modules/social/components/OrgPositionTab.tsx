"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import type { OrgStructure } from "@/shared/types/orgChart";
import StructureTree from "@/modules/admin/components/StructureTree";

export default function OrgPositionTab() {
    const [structure, setStructure] = useState<OrgStructure | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        axios.get<OrgStructure>("/api/positions/structure")
            .then(r => setStructure(r.data))
            .catch(() => toast.error("Failed to load org chart"))
            .finally(() => setLoading(false));
    }, []);
    if (loading) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading org chart…</div>;
    if (!structure || (structure.orgWidePositions.length === 0 && structure.branches.every(b => b.deptGroups.length === 0)))
        return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">No positions defined yet.</div>;
    return <StructureTree structure={structure} />;
}
