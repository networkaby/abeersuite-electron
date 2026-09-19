"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { ColorPicker, randomColor } from "@/shared/components/ColorPicker";

interface Work { id: string; label: string; color: string; }
interface WorkGroup { id: string; name: string; label: string; color: string; order: number; permissionId: string | null; works: Work[]; }
type FormValues = { name: string; label: string; color: string; gated: boolean };
const BLANK: FormValues = { name: "", label: "", color: "bg-gray-100 text-gray-600", gated: false };

// Module-scope so it keeps a stable identity across the page's re-renders (a dialog
// defined inside the page component remounts on every keystroke → input loses focus).
function GroupDialog({ open, onOpenChange, form, setForm, id, onSave, saving }: {
    open: boolean; onOpenChange: (o: boolean) => void; form: FormValues; setForm: (f: FormValues) => void;
    id: string | null; onSave: (form: FormValues, id: string | null) => void; saving: boolean;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{id ? "Edit group" : "New work group"}</DialogTitle>
                    <DialogDescription>A category for works (e.g. Calling, Repairing). The Work Inbox organises by display name.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Group name</Label>
                        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Repair Calling" />
                        <p className="text-xs text-muted-foreground">Internal — tells this group apart from others here in Settings. Not shown to staff.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Display name</Label>
                        <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Calling" />
                        <p className="text-xs text-muted-foreground">Shown to staff in the Work Inbox. Groups with the same display name are shown as one to staff.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Color</Label>
                        <ColorPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={form.gated} onCheckedChange={(c) => setForm({ ...form, gated: c === true })} />
                        Gated <span className="text-xs text-muted-foreground">(only roles you grant the permission to can see this group&apos;s tickets in the Work Inbox)</span>
                    </label>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="button" onClick={() => onSave(form, id)} disabled={saving || !form.label.trim() || !form.name.trim()}>{saving ? "Saving…" : "Save"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function WorkGroupsPage() {
    const [groups, setGroups] = useState<WorkGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState<FormValues>({ ...BLANK });
    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<FormValues>({ ...BLANK });
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // No `setLoading(true)` here — the spinner is for the first load only.
    // Re-showing it after every save blanked the list (blink).
    const load = async () => {
        try { setGroups((await axios.get("/api/work-groups")).data); }
        catch { toast.error("Failed to load groups"); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    // Workflow config is shared — a status, work or worker changed on another
    // machine announces `tickets`. Row editors hold their own draft state.
    useRealtimeTopics(["tickets"], () => { load(); });

    const save = async (form: FormValues, id: string | null) => {
        setSaving(true);
        try {
            if (id) await axios.patch(`/api/work-groups/${id}`, form);
            else await axios.post("/api/work-groups", form);
            toast.success(id ? "Group updated" : "Group created");
            setShowCreate(false); setEditId(null); load();
        } catch (err) {
            toast.error((axios.isAxiosError(err) ? err.response?.data?.error : null) ?? "Failed to save group");
        } finally { setSaving(false); }
    };
    const remove = async (id: string) => {
        setDeletingId(id);
        try { await axios.delete(`/api/work-groups/${id}`); toast.success("Group deleted"); load(); }
        catch { toast.error("Failed to delete group"); }
        finally { setDeletingId(null); }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-4xl space-y-6 px-6 pt-3 pb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Work Groups</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Categories that bundle works (e.g. <span className="font-medium">Calling</span> holds several calling works). The Work Inbox filters by group.</p>
                    </div>
                    <Button type="button" onClick={() => { setCreateForm({ ...BLANK, color: randomColor() }); setShowCreate(true); }}><Plus size={16} /> Add Group</Button>
                </div>

                {loading ? <p className="text-sm text-muted-foreground">Loading…</p>
                    : groups.length === 0 ? <p className="text-sm text-muted-foreground">No groups yet. Add one, then assign works to it.</p>
                    : (
                        <div className="space-y-3">
                            {/* Groups with the same display name (label) are shown to staff as one — e.g. a
                                per-department "Calling" tag — so collapse them into one section here too,
                                keyed by label, with each underlying group listed by its own group name. */}
                            {Array.from(
                                groups.reduce((sections, g) => {
                                    (sections.get(g.label) ?? sections.set(g.label, []).get(g.label)!).push(g);
                                    return sections;
                                }, new Map<string, WorkGroup[]>()).entries(),
                            ).map(([label, rows]) => (
                                <Card key={label}>
                                    <CardHeader className="border-b py-3">
                                        <div className="flex items-center gap-3">
                                            <Badge {...badgeColor(rows[0].color)}>{label}</Badge>
                                            <CardTitle className="ml-auto text-sm font-normal text-muted-foreground">
                                                {rows.length > 1 ? `${rows.length} groups` : `${rows[0].works.length} work${rows[0].works.length !== 1 ? "s" : ""}`}
                                            </CardTitle>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-3 pt-3">
                                        {rows.map((g) => (
                                            <div key={g.id} className="space-y-2 rounded-md border p-3">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-medium">{g.name || g.label}</span>
                                                    {g.permissionId ? (
                                                        <Badge variant="outline" className="gap-1 text-amber-700">
                                                            <Lock size={11} /> Gated
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="text-muted-foreground">Ungated</Badge>
                                                    )}
                                                    <span className="ml-auto text-xs text-muted-foreground">{g.works.length} work{g.works.length !== 1 ? "s" : ""}</span>
                                                    <Button type="button" size="sm" variant="outline" onClick={() => { setEditId(g.id); setEditForm({ name: g.name, label: g.label, color: g.color, gated: !!g.permissionId }); }}><Pencil size={13} /> Edit</Button>
                                                    <Button type="button" size="icon-sm" variant="destructive" onClick={() => remove(g.id)} disabled={deletingId === g.id} title="Delete (works keep, ungrouped)"><Trash2 size={13} /></Button>
                                                </div>
                                                {g.works.length > 0 && <div className="flex flex-wrap gap-1.5">{g.works.map((w) => <Badge key={w.id} {...badgeColor(w.color)}>{w.label}</Badge>)}</div>}
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}

                <GroupDialog open={showCreate} onOpenChange={(o) => setShowCreate(o)} form={createForm} setForm={setCreateForm} id={null} onSave={save} saving={saving} />
                <GroupDialog open={!!editId} onOpenChange={(o) => { if (!o) setEditId(null); }} form={editForm} setForm={setEditForm} id={editId} onSave={save} saving={saving} />
            </div>
        </ScrollArea>
    );
}
