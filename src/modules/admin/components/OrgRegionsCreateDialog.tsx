"use client";

// Inline create-dialog for the Org Chart → Regions (Beta) tab.
// Hosted by OrgRegions.tsx — opens with a pre-filled scope (branch / dept)
// and POSTs to existing endpoints:
//   /api/branches | /api/departments | /api/positions
//
// IDs are generated client-side from the name (slug → prefix). On 409 the
// client retries with `-2`, `-3`, … so duplicates auto-resolve. The user
// never sees an ID field. Special case: when intent.forceId is set (used for
// "Create HQ" which forces id = "BR-HQ"), that exact id is sent through.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Building2, Layers, Briefcase, Landmark } from "lucide-react";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type Intent =
    | { mode: "branch"; forceId?: string; isHq?: boolean }
    | { mode: "department"; branchId?: string | null }
    | { mode: "position"; branchId?: string | null; departmentId?: string | null };

interface Branch     { id: string; name: string; }
interface Department { id: string; name: string; branchId: string | null; }

interface Props {
    intent: Intent | null;
    branches: Branch[];
    departments: Department[];
    /** Existing position titles + dept names — used for type-ahead suggestions. */
    positionTitles?: string[];
    departmentNames?: string[];
    onClose: () => void;
    onCreated: () => void;
}

// ── ID generation ─────────────────────────────────────────────────────────────

function slugify(s: string): string {
    return s
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24) || "X";
}

/** Try `id` then `id-2`, `id-3`, … on 409 collisions. Posts via `post(idAttempt)` per attempt. */
async function postWithIdRetry<T>(
    baseId: string,
    post: (idAttempt: string) => Promise<T>,
): Promise<T> {
    let attempt = 1;
    // Hard cap so we never spin forever.
    while (attempt < 50) {
        const idAttempt = attempt === 1 ? baseId : `${baseId}-${attempt}`;
        try {
            return await post(idAttempt);
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 409) {
                attempt += 1;
                continue;
            }
            throw err;
        }
    }
    throw new Error("Could not find a unique ID after 50 attempts");
}

// ── Branch form ───────────────────────────────────────────────────────────────

function BranchForm({
    onDone, forceId, isHq,
}: { onDone: () => void; forceId?: string; isHq?: boolean }) {
    const [name, setName]   = useState(isHq ? "Head Office" : "");
    const [addr, setAddr]   = useState("");
    const [phone, setPhone] = useState("");
    const [busy, setBusy]   = useState(false);

    async function submit() {
        if (!name.trim()) {
            toast.error("Name is required");
            return;
        }
        setBusy(true);
        try {
            const payload = {
                name: name.trim(),
                address: addr.trim() || null,
                phone: phone.trim() || null,
            };
            if (forceId) {
                // No retry — HQ must be exactly the forced id.
                await axios.post("/api/branches", { id: forceId, ...payload });
            } else {
                const baseId = `BR-${slugify(name)}`;
                await postWithIdRetry(baseId, idAttempt =>
                    axios.post("/api/branches", { id: idAttempt, ...payload }),
                );
            }
            toast.success(`${isHq ? "HQ" : "Branch"} ${name} created`);
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
                <label className="text-xs font-medium text-muted-foreground">
                    {isHq ? "HQ name *" : "Name *"}
                </label>
                <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={isHq ? "Head Office" : "Delhi Branch"}
                    className="mt-1"
                    autoFocus
                />
                {isHq && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                        Internal ID will be <span className="font-mono">BR-HQ</span> (fixed). Rename freely.
                    </p>
                )}
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
                    {busy ? "Creating…" : isHq ? "Create HQ" : "Create branch"}
                </Button>
            </DialogFooter>
        </div>
    );
}

// ── Department form ───────────────────────────────────────────────────────────

function DepartmentForm({
    branches, initialBranchId, suggestions, onDone,
}: {
    branches: Branch[];
    initialBranchId?: string | null;
    suggestions: string[];
    onDone: () => void;
}) {
    const [name, setName]         = useState("");
    const [desc, setDesc]         = useState("");
    const [branchId, setBranchId] = useState(initialBranchId ?? "");
    const [busy, setBusy]         = useState(false);

    async function submit() {
        if (!name.trim()) {
            toast.error("Name is required");
            return;
        }
        setBusy(true);
        try {
            const baseId = `DEPT-${slugify(name)}`;
            await postWithIdRetry(baseId, idAttempt =>
                axios.post("/api/departments", {
                    id: idAttempt,
                    name: name.trim(),
                    description: desc.trim() || null,
                    branchId: branchId || null,
                }),
            );
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
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Service"
                    className="mt-1"
                    autoFocus
                    list="org-dept-name-suggestions"
                />
                <datalist id="org-dept-name-suggestions">
                    {suggestions.map(s => <option key={s} value={s} />)}
                </datalist>
                {suggestions.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1 italic">
                        Tip: start typing to pick an existing department name (e.g. Sales, Service) and avoid duplicates.
                    </p>
                )}
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
    branches, departments, initialBranchId, initialDepartmentId, suggestions, onDone,
}: {
    branches: Branch[];
    departments: Department[];
    initialBranchId?: string | null;
    initialDepartmentId?: string | null;
    suggestions: string[];
    onDone: () => void;
}) {
    const [title, setTitle]           = useState("");
    const [branchId, setBranchId]     = useState(initialBranchId ?? "");
    const [departmentId, setDeptId]   = useState(initialDepartmentId ?? "");
    const [busy, setBusy]             = useState(false);

    const filteredDepts = branchId
        ? departments.filter(d => !d.branchId || d.branchId === branchId)
        : departments;

    async function submit() {
        if (!title.trim()) {
            toast.error("Title is required");
            return;
        }
        setBusy(true);
        try {
            const baseId = `POS-${slugify(title)}`;
            await postWithIdRetry(baseId, idAttempt =>
                axios.post("/api/positions", {
                    id: idAttempt,
                    title: title.trim(),
                    branchId: branchId || null,
                    departmentId: departmentId || null,
                }),
            );
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
                <label className="text-xs font-medium text-muted-foreground">Title *</label>
                <Input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Branch Manager"
                    className="mt-1"
                    autoFocus
                    list="org-pos-title-suggestions"
                />
                <datalist id="org-pos-title-suggestions">
                    {suggestions.map(s => <option key={s} value={s} />)}
                </datalist>
                {suggestions.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1 italic">
                        Tip: start typing to pick an existing title (e.g. Branch Manager, Sales Executive) — same title in a different branch is fine.
                    </p>
                )}
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
    intent, branches, departments, positionTitles = [], departmentNames = [], onClose, onCreated,
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
            if (intent.isHq) {
                return {
                    icon: <Landmark size={16} className="text-amber-600" />,
                    title: "Create HQ",
                    desc: "Sets up the Headquarters branch. The internal id is BR-HQ — choose any display name you like.",
                };
            }
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
                    <BranchForm
                        key={key}
                        forceId={intent.forceId}
                        isHq={intent.isHq}
                        onDone={handleDone}
                    />
                )}
                {intent?.mode === "department" && (
                    <DepartmentForm
                        key={key}
                        branches={branches}
                        initialBranchId={intent.branchId ?? null}
                        suggestions={departmentNames}
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
                        suggestions={positionTitles}
                        onDone={handleDone}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
