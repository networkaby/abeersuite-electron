"use client";

// Inline create-dialog for the Org Chart → Regions (Beta) tab.
// Hosted by OrgRegions.tsx — opens with a pre-filled scope (branch / dept)
// and POSTs to existing endpoints:
//   /api/branches | /api/departments | /api/positions
// Advanced fields (parentPositionId, roleTemplateId) stay on /office/admin/positions.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Building2, Layers, Briefcase } from "lucide-react";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type Intent =
    | { mode: "branch" }
    | { mode: "department"; branchId?: string | null }
    | { mode: "position"; branchId?: string | null; departmentId?: string | null };

interface Branch     { id: string; name: string; }
interface Department { id: string; name: string; branchId: string | null; }

interface Props {
    intent: Intent | null;
    branches: Branch[];
    departments: Department[];
    onClose: () => void;
    onCreated: () => void;
}

// ── Branch form ───────────────────────────────────────────────────────────────

function BranchForm({ onDone }: { onDone: () => void }) {
    const [id, setId]       = useState("");
    const [name, setName]   = useState("");
    const [addr, setAddr]   = useState("");
    const [phone, setPhone] = useState("");
    const [busy, setBusy]   = useState(false);

    async function submit() {
        if (!id.trim() || !name.trim()) {
            toast.error("ID and Name are required");
            return;
        }
        setBusy(true);
        try {
            await axios.post("/api/branches", {
                id: id.trim().toUpperCase(),
                name: name.trim(),
                address: addr.trim() || null,
                phone: phone.trim() || null,
            });
            toast.success(`Branch ${name} created`);
            onDone();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : "Failed to create branch";
            toast.error(msg);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3">
            <div>
                <label className="text-xs font-medium text-muted-foreground">Branch ID *</label>
                <Input
                    value={id}
                    onChange={e => setId(e.target.value.toUpperCase())}
                    placeholder="BR-DEL"
                    className="mt-1 font-mono uppercase"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Delhi Branch"
                    className="mt-1"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Address</label>
                <Input
                    value={addr}
                    onChange={e => setAddr(e.target.value)}
                    placeholder="Street, city"
                    className="mt-1"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <Input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+91…"
                    inputMode="tel"
                    className="mt-1"
                />
            </div>
            <DialogFooter showCloseButton>
                <Button onClick={submit} disabled={busy}>
                    {busy ? "Creating…" : "Create branch"}
                </Button>
            </DialogFooter>
        </div>
    );
}

// ── Department form ───────────────────────────────────────────────────────────

function DepartmentForm({
    branches, initialBranchId, onDone,
}: {
    branches: Branch[];
    initialBranchId?: string | null;
    onDone: () => void;
}) {
    const [id, setId]             = useState("");
    const [name, setName]         = useState("");
    const [desc, setDesc]         = useState("");
    const [branchId, setBranchId] = useState(initialBranchId ?? "");
    const [busy, setBusy]         = useState(false);

    async function submit() {
        if (!id.trim() || !name.trim()) {
            toast.error("ID and Name are required");
            return;
        }
        setBusy(true);
        try {
            await axios.post("/api/departments", {
                id: id.trim().toUpperCase(),
                name: name.trim(),
                description: desc.trim() || null,
                branchId: branchId || null,
            });
            toast.success(`Department ${name} created`);
            onDone();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : "Failed to create department";
            toast.error(msg);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3">
            <div>
                <label className="text-xs font-medium text-muted-foreground">Department ID *</label>
                <Input
                    value={id}
                    onChange={e => setId(e.target.value.toUpperCase())}
                    placeholder="DEPT-SVC"
                    className="mt-1 font-mono uppercase"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Service"
                    className="mt-1"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Branch scope <span className="font-normal">(blank = org-wide)</span></label>
                <Select
                    value={branchId || "org-wide"}
                    onValueChange={v => setBranchId(v === "org-wide" ? "" : v)}
                >
                    <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Org-wide" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="org-wide">Org-wide</SelectItem>
                        {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Input
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                    placeholder="What the team does"
                    className="mt-1"
                />
            </div>
            <DialogFooter showCloseButton>
                <Button onClick={submit} disabled={busy}>
                    {busy ? "Creating…" : "Create department"}
                </Button>
            </DialogFooter>
        </div>
    );
}

// ── Position form ─────────────────────────────────────────────────────────────

function PositionForm({
    branches, departments, initialBranchId, initialDepartmentId, onDone,
}: {
    branches: Branch[];
    departments: Department[];
    initialBranchId?: string | null;
    initialDepartmentId?: string | null;
    onDone: () => void;
}) {
    const [id, setId]                 = useState("");
    const [title, setTitle]           = useState("");
    const [branchId, setBranchId]     = useState(initialBranchId ?? "");
    const [departmentId, setDeptId]   = useState(initialDepartmentId ?? "");
    const [busy, setBusy]             = useState(false);

    // Departments shown depend on the selected branch (or all if org-wide).
    const filteredDepts = branchId
        ? departments.filter(d => !d.branchId || d.branchId === branchId)
        : departments;

    async function submit() {
        if (!id.trim() || !title.trim()) {
            toast.error("ID and Title are required");
            return;
        }
        setBusy(true);
        try {
            await axios.post("/api/positions", {
                id: id.trim().toUpperCase(),
                title: title.trim(),
                branchId: branchId || null,
                departmentId: departmentId || null,
            });
            toast.success(`Position ${title} created`);
            onDone();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : "Failed to create position";
            toast.error(msg);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3">
            <div>
                <label className="text-xs font-medium text-muted-foreground">Position ID *</label>
                <Input
                    value={id}
                    onChange={e => setId(e.target.value.toUpperCase())}
                    placeholder="POS-BM-DEL"
                    className="mt-1 font-mono uppercase"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Title *</label>
                <Input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Branch Manager"
                    className="mt-1"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Branch scope <span className="font-normal">(blank = org-wide)</span></label>
                <Select
                    value={branchId || "org-wide"}
                    onValueChange={v => {
                        const next = v === "org-wide" ? "" : v;
                        setBranchId(next);
                        setDeptId("");
                    }}
                >
                    <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Org-wide (Executive Council)" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="org-wide">Org-wide (Executive Council)</SelectItem>
                        {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Department <span className="font-normal">(optional)</span></label>
                <Select
                    value={departmentId || "none"}
                    onValueChange={v => setDeptId(v === "none" ? "" : v)}
                >
                    <SelectTrigger className="mt-1">
                        <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {filteredDepts.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <p className="text-[10px] text-muted-foreground italic">
                Reporting line and role template can be set later from <span className="font-medium">Manage positions</span>.
            </p>
            <DialogFooter showCloseButton>
                <Button onClick={submit} disabled={busy}>
                    {busy ? "Creating…" : "Create position"}
                </Button>
            </DialogFooter>
        </div>
    );
}

// ── Dialog shell ──────────────────────────────────────────────────────────────

export default function OrgRegionsCreateDialog({
    intent, branches, departments, onClose, onCreated,
}: Props) {
    // Re-mount the form whenever intent changes so initial values stick.
    const [key, setKey] = useState(0);
    useEffect(() => { setKey(k => k + 1); }, [intent]);

    const open = intent !== null;

    function handleDone() {
        onCreated();
        onClose();
    }

    const header = (() => {
        if (intent?.mode === "branch") {
            return {
                icon: <Building2 size={16} className="text-emerald-600" />,
                title: "Add branch",
                desc: "Create a new regional branch. After saving you can immediately add a department or position inside it.",
            };
        }
        if (intent?.mode === "department") {
            return {
                icon: <Layers size={16} className="text-emerald-600" />,
                title: "Add department",
                desc: "Departments hold positions. Pre-filled with the branch you opened this from — change if needed.",
            };
        }
        return {
            icon: <Briefcase size={16} className="text-emerald-600" />,
            title: "Add position",
            desc: "Define a slot in the org. Assign holders later from Manage positions.",
        };
    })();

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {header.icon}
                        {header.title}
                    </DialogTitle>
                    <DialogDescription>{header.desc}</DialogDescription>
                </DialogHeader>
                {intent?.mode === "branch" && (
                    <BranchForm key={key} onDone={handleDone} />
                )}
                {intent?.mode === "department" && (
                    <DepartmentForm
                        key={key}
                        branches={branches}
                        initialBranchId={intent.branchId ?? null}
                        onDone={handleDone}
                    />
                )}
                {intent?.mode === "position" && (
                    <PositionForm
                        key={key}
                        branches={branches}
                        departments={departments}
                        initialBranchId={intent.branchId ?? null}
                        initialDepartmentId={intent.departmentId ?? null}
                        onDone={handleDone}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
