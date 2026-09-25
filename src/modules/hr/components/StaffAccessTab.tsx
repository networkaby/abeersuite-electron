"use client";

// Access tab — the login side of a staff member, without leaving HR.
//
// Roles and their permissions are DEFINED in Administration. Nothing here
// creates or edits one: this tab only chooses which existing role the person
// holds, who they report to, and edits or deletes their login. The login card
// opens the same `UserForm` and deletes through the same helper as Admin →
// Users, and every write goes through the same `/api/users/[id]` — so the two
// pages can never disagree, and a change on either shows on both (`settings`).
//
// "Data scope" (Own/Team/Department/…) used to be editable here too. It's
// hidden for now — the `scope` column and session plumbing still exist, but
// no API route reads it to restrict what a user sees. Bring the field back
// once something actually enforces it.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/shared/components/Field";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import UserForm from "@/shared/components/UserForm";
import { useApiResource } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAndDeleteUser } from "@/shared/lib/users/deleteUserLogin";
import type { StaffDetail, StaffRow } from "../lib/staffTypes";

interface RoleRow {
    id: string;
    label: string;
    department?: { id: string; name: string } | null;
}

export default function StaffAccessTab({ detail, canEdit, canDelete, onChanged, onDeleted }: {
    detail: StaffDetail;
    /** users:edit — without it the tab is read-only, never hidden. */
    canEdit: boolean;
    /** users:delete, and not the signed-in person's own login. */
    canDelete: boolean;
    onChanged: () => void;
    onDeleted: () => void;
}) {
    const { user } = detail;
    const { data: roles } = useApiResource<RoleRow[]>("/api/roles");
    const { data: staff } = useApiResource<StaffRow[]>("/api/hr/staff");

    const [saving, setSaving] = useState(false);
    // A copy taken when the dialog opens: the profile re-reads on every
    // `settings` announcement, and a fresh `user` object would reset the form
    // under whatever is being typed.
    const [editingLogin, setEditingLogin] = useState<{ id: number; name: string; email: string } | null>(null);

    const roleOptions = useMemo(
        () => (roles ?? []).map((r) => ({
            value: r.id,
            label: r.department?.name ? `${r.label} · ${r.department.name}` : r.label,
            leaf:  r.label,
        })),
        [roles],
    );

    // Anyone but themselves — a person cannot be their own manager.
    const managerOptions = useMemo(
        () => (staff ?? [])
            .filter((s) => s.id !== user.id)
            .map((s) => ({ value: s.id, label: s.name })),
        [staff, user.id],
    );

    /**
     * Role / manager writes. `PUT /api/users/[id]` wants the identity fields on
     * every call, so they ride along unchanged — the login card edits those.
     */
    const put = async (patch: Record<string, unknown>, done: string) => {
        setSaving(true);
        try {
            await axios.put(`/api/users/${user.id}`, {
                name:  user.name,
                email: user.email,
                title: user.title,
                phone: user.phone,
                ...patch,
            });
            toast.success(done);
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save"));
        } finally {
            setSaving(false);
        }
    };

    const deleteLogin = async () => {
        if (await confirmAndDeleteUser(user)) onDeleted();
    };

    return (
        <div className="max-w-2xl space-y-6">
            <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                <span>
                    Roles and what they may do are set up in <strong>Administration</strong>. Here you only choose
                    which existing role this person holds.
                </span>
            </p>

            <div className="rounded-lg border border-border p-4">
                <p className="flex items-center gap-2 text-sm font-medium"><KeyRound size={14} /> Login</p>
                <p className="mb-3 text-xs text-muted-foreground">
                    How they sign in. Setting a new password signs them out everywhere. The same login shows on
                    Admin → Users — a change on either page shows on both.
                </p>
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="font-medium">{user.name}</dd>
                    <dt className="text-muted-foreground">Sign-in email</dt>
                    <dd className="break-all">{user.email}</dd>
                </dl>
                {(canEdit || canDelete) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {canEdit && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingLogin({ id: user.id, name: user.name, email: user.email })}
                            >
                                <Pencil size={14} /> Edit login
                            </Button>
                        )}
                        {canDelete && (
                            <Button type="button" size="sm" variant="destructive" onClick={deleteLogin}>
                                <Trash2 size={14} /> Delete login
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {editingLogin && (
                <UserForm
                    user={editingLogin}
                    onClose={() => { setEditingLogin(null); onChanged(); }}
                />
            )}

            <fieldset disabled={!canEdit || saving} className="grid gap-4 border-0 p-0 sm:grid-cols-2">
                <Field label="Role" hint="Decides what they may do.">
                    {() => (
                        <SearchableSelect
                            value={user.userRole?.id ?? user.role ?? null}
                            options={roleOptions}
                            onChange={(v) => v && put({ role: v }, "Role changed")}
                            placeholder="Pick a role"
                            clearable={false}
                            ariaLabel="Role"
                            triggerClassName="h-9 text-sm"
                        />
                    )}
                </Field>

                <Field label="Reports to" hint="Their manager. Blank for nobody.">
                    {() => (
                        <SearchableSelect
                            value={user.managerId ?? null}
                            options={managerOptions}
                            onChange={(v) => put({ managerId: v ?? null }, "Manager changed")}
                            placeholder="— nobody —"
                            ariaLabel="Reports to"
                            triggerClassName="h-9 text-sm"
                        />
                    )}
                </Field>
            </fieldset>
        </div>
    );
}
