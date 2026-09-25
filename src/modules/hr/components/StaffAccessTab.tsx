"use client";

// Access tab — the login side of a staff member, without leaving HR.
//
// Roles and their permissions are DEFINED in Administration. Nothing here
// creates or edits one: this tab only chooses which existing role the person
// holds, who they report to, and edits their login. The login card opens the
// same `UserForm` as Admin → Users, and every write goes through the same `/api/users/[id]` — so the two
// pages can never disagree, and a change on either shows on both (`settings`).
//
// "Data scope" (Own/Team/Department/…) used to be editable here too. It's
// hidden for now — the `scope` column and session plumbing still exist, but
// no API route reads it to restrict what a user sees. Bring the field back
// once something actually enforces it.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Mail, Pencil, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/shared/components/Field";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import UserForm from "@/shared/components/UserForm";
import { Input } from "@/components/ui/input";
import { useApiResource, useForwardEmail } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import type { StaffDetail, StaffRow } from "../lib/staffTypes";

interface RoleRow {
    id: string;
    label: string;
    department?: { id: string; name: string } | null;
}

export default function StaffAccessTab({ detail, canEdit, onChanged }: {
    detail: StaffDetail;
    /** users:edit — without it the tab is read-only, never hidden. */
    canEdit: boolean;
    onChanged: () => void;
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
                <ForwardRow userId={user.id} email={user.email} canEdit={canEdit} />
                {canEdit && (
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

/** Where their company mail goes (Gmail etc.) — needed for Forgot password. Same
 *  read/save as the profile's Forward Email card. Hidden when the route refuses,
 *  e.g. the sign-in email is not a company address. */
function ForwardRow({ userId, email, canEdit }: { userId: number; email: string; canEdit: boolean }) {
    const { state, unavailable, forwardTo, setForwardTo, busy, load, save, status } = useForwardEmail(userId, email);
    if (unavailable) return null;
    return (
        <form
            onSubmit={e => { e.preventDefault(); void save(); }}
            className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]"
        >
            <label htmlFor={`fwd-${userId}`} className="flex items-center gap-1 text-muted-foreground"><Mail size={13} /> Forward to</label>
            <div className="space-y-1">
                <div className="flex gap-2">
                    <Input
                        id={`fwd-${userId}`}
                        type="email"
                        autoComplete="off"
                        value={forwardTo}
                        onChange={e => setForwardTo(e.target.value)}
                        placeholder="someone@gmail.com"
                        disabled={!canEdit}
                        className="h-8"
                    />
                    {canEdit && (
                        <Button type="submit" size="sm" disabled={busy || !state || !forwardTo.trim()}>
                            {busy ? "Saving…" : "Save"}
                        </Button>
                    )}
                </div>
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => void load()}>
                    {state ? `${status}${state.forwardTo ? ` · now ${state.forwardTo}` : ""}` : "Loading…"}
                </button>
            </div>
        </form>
    );
}
