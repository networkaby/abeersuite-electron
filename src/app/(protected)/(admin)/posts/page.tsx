"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Image from "next/image";
import {
    Plus, Pencil, Trash2, X, Check, Briefcase,
    UserPlus, UserMinus, ChevronDown, ChevronRight, Building2, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Branch     { id: string; name: string; }
interface Department { id: string; name: string; branchId: string | null; }
interface UserStub   { id: number; name: string; avatarUrl: string | null; role: string; title: string | null; userRole: { label: string; color: string }; }

interface Post {
    id: string;
    title: string;
    branchId: string | null;
    departmentId: string | null;
    parentPostId: string | null;
    branch:     { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    parent:     { id: string; title: string } | null;
    holders:    { user: UserStub }[];
    _count:     { children: number };
}

type FormState = { id: string; title: string; branchId: string; departmentId: string; parentPostId: string };
const EMPTY: FormState = { id: "", title: "", branchId: "", departmentId: "", parentPostId: "" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLOR: Record<string, string> = {
    R1: "bg-purple-100 text-purple-700", R2: "bg-blue-100 text-blue-700",
    R3: "bg-green-100 text-green-700",   R4: "bg-orange-100 text-orange-700",
    R5: "bg-pink-100 text-pink-700",
};

function UserChip({ user, onRemove }: { user: UserStub; onRemove?: () => void }) {
    const [imgErr, setImgErr] = useState(false);
    return (
        <span className="flex items-center gap-1.5 border border-border bg-muted/50 px-2 py-1 text-xs">
            {user.avatarUrl && !imgErr ? (
                <Image src={user.avatarUrl} alt={user.name} width={16} height={16} className="rounded-full object-cover" onError={() => setImgErr(true)} />
            ) : (
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${AVATAR_COLOR[user.role] ?? "bg-gray-100 text-gray-600"}`}>
                    {initials(user.name)}
                </span>
            )}
            <span className="font-medium">{user.name}</span>
            <Badge className={`${user.userRole.color} text-[9px] px-1 py-0`}>{user.userRole.label}</Badge>
            {onRemove && (
                <button onClick={onRemove} className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors" title="Remove">
                    <X size={11} />
                </button>
            )}
        </span>
    );
}

// ── Form fields (extracted to avoid remount on parent re-render) ──────────────

function PostFormFields({
    addingNew, form, branches, departments, allPosts, onChange,
}: {
    addingNew: boolean;
    form: FormState;
    branches: Branch[];
    departments: Department[];
    allPosts: Post[];
    onChange: (f: FormState) => void;
}) {
    const filteredDepts = form.branchId
        ? departments.filter(d => !d.branchId || d.branchId === form.branchId)
        : departments;

    return (
        <div className="grid grid-cols-2 gap-3">
            {addingNew && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground">ID (e.g. POST-CEO) *</label>
                    <Input
                        value={form.id}
                        onChange={e => onChange({ ...form, id: e.target.value.toUpperCase() })}
                        placeholder="POST-BM-DEL"
                        className="mt-1 font-mono uppercase"
                    />
                </div>
            )}
            <div className={addingNew ? "" : "col-span-2"}>
                <label className="text-xs font-medium text-muted-foreground">Title *</label>
                <Input
                    value={form.title}
                    onChange={e => onChange({ ...form, title: e.target.value })}
                    placeholder="Branch Manager"
                    className="mt-1"
                />
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Branch scope <span className="font-normal">(blank = org-wide)</span></label>
                <select
                    value={form.branchId}
                    onChange={e => onChange({ ...form, branchId: e.target.value, departmentId: "" })}
                    className="mt-1 w-full border-2 border-border bg-background text-sm px-3 py-2 focus:outline-none focus:border-primary"
                >
                    <option value="">— Org-wide (Executive Council) —</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Department scope <span className="font-normal">(optional)</span></label>
                <select
                    value={form.departmentId}
                    onChange={e => onChange({ ...form, departmentId: e.target.value })}
                    className="mt-1 w-full border-2 border-border bg-background text-sm px-3 py-2 focus:outline-none focus:border-primary"
                >
                    <option value="">— None —</option>
                    {filteredDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
            </div>
            <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Reports to (parent post) <span className="font-normal">(optional)</span></label>
                <select
                    value={form.parentPostId}
                    onChange={e => onChange({ ...form, parentPostId: e.target.value })}
                    className="mt-1 w-full border-2 border-border bg-background text-sm px-3 py-2 focus:outline-none focus:border-primary"
                >
                    <option value="">— Top level —</option>
                    {allPosts.filter(p => p.id !== form.id).map(p => (
                        <option key={p.id} value={p.id}>
                            {p.title}{p.branch ? ` · ${p.branch.name}` : ""}{p.department ? ` / ${p.department.name}` : ""}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}

// ── Assign panel ──────────────────────────────────────────────────────────────

function AssignPanel({
    post, allUsers, onAssign, onUnassign,
}: {
    post: Post;
    allUsers: UserStub[];
    onAssign: (userId: number) => Promise<void>;
    onUnassign: (userId: number) => Promise<void>;
}) {
    const [search, setSearch] = useState("");
    const holderIds = new Set(post.holders.map(h => h.user.id));
    const candidates = allUsers.filter(
        u => !holderIds.has(u.id) && u.name.toLowerCase().includes(search.toLowerCase()),
    );

    return (
        <div className="border-t-2 border-border mt-3 pt-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Holders</p>
            {post.holders.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Vacant — no one appointed</p>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {post.holders.map(h => (
                        <UserChip key={h.user.id} user={h.user} onRemove={() => onUnassign(h.user.id)} />
                    ))}
                </div>
            )}
            <div>
                <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search users to appoint…"
                    className="text-xs h-8"
                />
                {search && (
                    <div className="border-2 border-border border-t-0 max-h-40 overflow-y-auto">
                        {candidates.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching users</p>
                        ) : (
                            candidates.map(u => (
                                <button
                                    key={u.id}
                                    onClick={() => { onAssign(u.id); setSearch(""); }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors text-left"
                                >
                                    <span className="font-medium">{u.name}</span>
                                    <Badge className={`${u.userRole.color} text-[9px] px-1 py-0`}>{u.userRole.label}</Badge>
                                    {u.title && <span className="text-muted-foreground">{u.title}</span>}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Post row ──────────────────────────────────────────────────────────────────

function PostRow({
    post, allPosts, allUsers, branches, departments,
    onSave, onDelete, onAssign, onUnassign,
}: {
    post: Post;
    allPosts: Post[];
    allUsers: UserStub[];
    branches: Branch[];
    departments: Department[];
    onSave: (id: string, data: Partial<FormState>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onAssign: (postId: string, userId: number) => Promise<void>;
    onUnassign: (postId: string, userId: number) => Promise<void>;
}) {
    const [editing, setEditing]   = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [form, setForm]         = useState<FormState>({
        id: post.id, title: post.title,
        branchId: post.branchId ?? "", departmentId: post.departmentId ?? "", parentPostId: post.parentPostId ?? "",
    });
    const [saving, setSaving] = useState(false);

    const scopeLabel = post.branch
        ? (post.department ? `${post.branch.name} / ${post.department.name}` : post.branch.name)
        : "Executive Council";

    const handleSave = async () => {
        setSaving(true);
        await onSave(post.id, { title: form.title, branchId: form.branchId || null, departmentId: form.departmentId || null, parentPostId: form.parentPostId || null } as Partial<FormState>);
        setSaving(false);
        setEditing(false);
    };

    return (
        <div className="border-2 border-border bg-card">
            {editing ? (
                <div className="p-4 space-y-3">
                    <PostFormFields
                        addingNew={false} form={form} branches={branches}
                        departments={departments} allPosts={allPosts} onChange={setForm}
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave} disabled={saving}><Check size={14} /> Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(false)}><X size={14} /> Cancel</Button>
                    </div>
                </div>
            ) : (
                <div className="px-4 py-3 space-y-2">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setExpanded(o => !o)}
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-sm">{post.title}</p>
                                <Badge className="font-mono text-[10px]">{post.id}</Badge>
                                {post.parent && (
                                    <span className="text-[11px] text-muted-foreground">↑ {post.parent.title}</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                {post.branchId ? (
                                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                        <Building2 size={10} /> {scopeLabel}
                                    </span>
                                ) : (
                                    <span className="text-[11px] text-orange-600 flex items-center gap-1 font-medium">
                                        <Briefcase size={10} /> Executive Council
                                    </span>
                                )}
                                {post._count.children > 0 && (
                                    <span className="text-[11px] text-muted-foreground">{post._count.children} sub-post{post._count.children !== 1 ? "s" : ""}</span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {post.holders.length === 0 ? (
                                <span className="text-[11px] text-muted-foreground italic">Vacant</span>
                            ) : (
                                <div className="flex flex-wrap gap-1">
                                    {post.holders.map(h => <UserChip key={h.user.id} user={h.user} />)}
                                </div>
                            )}
                            <div className="flex gap-1 ml-2">
                                <Button variant="outline" size="icon-sm" title="Appoint / remove holders" onClick={() => setExpanded(o => !o)}>
                                    <UserPlus size={13} />
                                </Button>
                                <Button variant="outline" size="icon-sm" onClick={() => setEditing(true)}><Pencil size={14} /></Button>
                                <Button variant="destructive" size="icon-sm" onClick={() => onDelete(post.id)}><Trash2 size={14} /></Button>
                            </div>
                        </div>
                    </div>
                    {expanded && (
                        <AssignPanel
                            post={post} allUsers={allUsers}
                            onAssign={uid => onAssign(post.id, uid)}
                            onUnassign={uid => onUnassign(post.id, uid)}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PostsPage() {
    const [posts, setPosts]           = useState<Post[]>([]);
    const [branches, setBranches]     = useState<Branch[]>([]);
    const [departments, setDepts]     = useState<Department[]>([]);
    const [allUsers, setAllUsers]     = useState<UserStub[]>([]);
    const [loading, setLoading]       = useState(true);
    const [addingNew, setAddingNew]   = useState(false);
    const [form, setForm]             = useState<FormState>(EMPTY);
    const [saving, setSaving]         = useState(false);
    const [filterBranch, setFilter]   = useState("");

    const loadAll = async () => {
        try {
            const [pRes, bRes, dRes, uRes] = await Promise.all([
                axios.get<Post[]>("/api/posts"),
                axios.get<Branch[]>("/api/branches"),
                axios.get<Department[]>("/api/departments"),
                axios.get<UserStub[]>("/api/users"),
            ]);
            setPosts(pRes.data);
            setBranches(bRes.data);
            setDepts(dRes.data);
            setAllUsers(uRes.data);
        } catch { toast.error("Failed to load data"); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadAll(); }, []);

    const handleCreate = async () => {
        if (!form.id.trim()) { toast.error("ID is required"); return; }
        if (!form.title.trim()) { toast.error("Title is required"); return; }
        setSaving(true);
        try {
            await axios.post("/api/posts", {
                id:           form.id.toUpperCase(),
                title:        form.title,
                branchId:     form.branchId || null,
                departmentId: form.departmentId || null,
                parentPostId: form.parentPostId || null,
            });
            toast.success("Post created");
            setForm(EMPTY); setAddingNew(false);
            loadAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to create post");
        } finally { setSaving(false); }
    };

    const handleSave = async (id: string, data: Partial<FormState>) => {
        try {
            await axios.patch(`/api/posts/${id}`, data);
            toast.success("Post updated");
            loadAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to update post");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this post? Holders will be unassigned.")) return;
        try {
            await axios.delete(`/api/posts/${id}`);
            toast.success("Post deleted");
            loadAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to delete post");
        }
    };

    const handleAssign = async (postId: string, userId: number) => {
        try {
            await axios.post(`/api/posts/${postId}/holders`, { userId });
            toast.success("User appointed");
            loadAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to appoint user");
        }
    };

    const handleUnassign = async (postId: string, userId: number) => {
        try {
            await axios.delete(`/api/posts/${postId}/holders/${userId}`);
            toast.success("User removed from post");
            loadAll();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to remove user");
        }
    };

    const filteredPosts = filterBranch
        ? posts.filter(p => p.branchId === filterBranch || (!p.branchId && filterBranch === "__org"))
        : posts;

    const orgPosts    = filteredPosts.filter(p => !p.branchId);
    const branchPosts = branches.map(b => ({
        branch: b,
        posts:  filteredPosts.filter(p => p.branchId === b.id),
    })).filter(g => g.posts.length > 0 || !filterBranch);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Briefcase size={28} /> Posts
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Define positions in your organisation. Appoint one or more people to each post.
                    </p>
                </div>
                <Button onClick={() => { setForm(EMPTY); setAddingNew(true); }} disabled={addingNew}>
                    <Plus size={16} /> New Post
                </Button>
            </div>

            {/* Filter */}
            <div className="flex gap-2 flex-wrap">
                <button
                    onClick={() => setFilter("")}
                    className={`px-3 py-1 text-xs border-2 transition-colors ${!filterBranch ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary"}`}
                >
                    All
                </button>
                <button
                    onClick={() => setFilter("__org")}
                    className={`px-3 py-1 text-xs border-2 transition-colors ${filterBranch === "__org" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary"}`}
                >
                    Executive Council
                </button>
                {branches.map(b => (
                    <button
                        key={b.id}
                        onClick={() => setFilter(b.id)}
                        className={`px-3 py-1 text-xs border-2 transition-colors ${filterBranch === b.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary"}`}
                    >
                        {b.name}
                    </button>
                ))}
            </div>

            {/* New post form */}
            {addingNew && (
                <div className="border-2 border-primary p-4 space-y-3 bg-muted/30">
                    <p className="text-sm font-semibold">New Post</p>
                    <PostFormFields
                        addingNew={true} form={form} branches={branches}
                        departments={departments} allPosts={posts} onChange={setForm}
                    />
                    <div className="flex gap-2 pt-1">
                        <Button onClick={handleCreate} disabled={saving} size="sm"><Check size={14} /> Create</Button>
                        <Button variant="outline" size="sm" onClick={() => setAddingNew(false)}><X size={14} /> Cancel</Button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : posts.length === 0 && !addingNew ? (
                <p className="text-sm text-muted-foreground py-12 text-center border-2 border-dashed border-border">
                    No posts yet. Create your first position above.
                </p>
            ) : (
                <div className="space-y-6">
                    {/* Executive Council (org-wide) */}
                    {orgPosts.length > 0 && (
                        <section>
                            <div className="flex items-center gap-2 mb-2">
                                <Briefcase size={14} className="text-orange-600" />
                                <h2 className="text-xs font-bold uppercase tracking-widest text-orange-600">Executive Council</h2>
                                <span className="text-[11px] text-muted-foreground">({orgPosts.length})</span>
                            </div>
                            <div className="space-y-1.5">
                                {orgPosts.map(p => (
                                    <PostRow key={p.id} post={p} allPosts={posts} allUsers={allUsers}
                                        branches={branches} departments={departments}
                                        onSave={handleSave} onDelete={handleDelete}
                                        onAssign={handleAssign} onUnassign={handleUnassign} />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Per-branch groups */}
                    {branchPosts.map(({ branch, posts: bPosts }) => {
                        const deptGroups = departments
                            .filter(d => d.branchId === branch.id)
                            .map(d => ({ dept: d, posts: bPosts.filter(p => p.departmentId === d.id) }))
                            .filter(g => g.posts.length > 0);
                        const noDeptPosts = bPosts.filter(p => !p.departmentId);

                        return (
                            <section key={branch.id}>
                                <div className="flex items-center gap-2 mb-2">
                                    <Building2 size={14} className="text-primary" />
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-primary">{branch.name}</h2>
                                    <span className="text-[11px] text-muted-foreground">({bPosts.length})</span>
                                </div>

                                {/* Branch-level posts (no dept) */}
                                {noDeptPosts.length > 0 && (
                                    <div className="space-y-1.5 mb-3">
                                        {noDeptPosts.map(p => (
                                            <PostRow key={p.id} post={p} allPosts={posts} allUsers={allUsers}
                                                branches={branches} departments={departments}
                                                onSave={handleSave} onDelete={handleDelete}
                                                onAssign={handleAssign} onUnassign={handleUnassign} />
                                        ))}
                                    </div>
                                )}

                                {/* Dept sub-groups */}
                                {deptGroups.map(({ dept, posts: dPosts }) => (
                                    <div key={dept.id} className="ml-4 border-l-2 border-border pl-4 mb-3">
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            <Layers size={12} className="text-muted-foreground" />
                                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{dept.name}</span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {dPosts.map(p => (
                                                <PostRow key={p.id} post={p} allPosts={posts} allUsers={allUsers}
                                                    branches={branches} departments={departments}
                                                    onSave={handleSave} onDelete={handleDelete}
                                                    onAssign={handleAssign} onUnassign={handleUnassign} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
