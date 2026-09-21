"use client";

// Access tab — the login side of a staff member, without leaving HR.
//
// Roles and their permissions are DEFINED in Administration. Nothing here
// creates or edits one: this tab only chooses which existing role the person
// holds, who they report to, and (when they are locked out) sets a new
// password. Every write goes through the same `PUT /api/users/[id]` the
// Admin → Users screen uses, so the two can never disagree about what a role
// change means.
//
// "Data scope" (Own/Team/Department/…) used to be editable here too. It's
// hidden for now — the `scope` column and session plumbing still exist, but
// no API route reads it to restrict what a user sees. Bring the field back
// once something actually enforces it.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/shared/components/Field";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { useApiResource } from "@/shared/hooks";
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
    const [password, setPassword] = useState("");

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
     * One write path. `PUT /api/users/[id]` wants the identity fields on every
     * call, so they ride along unchanged — this tab never edits a name or email.
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

    const resetPassword = async () => {
        if (password.length < 6) {
            toast.error("A password must be at least 6 characters");
            return;
        }
        await put({ password }, `New password set for ${user.name.split(" ")[0]}`);
        setPassword("");
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

                <Field label="Sign-in email" hint="Changed on their own profile page.">
                    {(id) => <Input id={id} value={user.email} readOnly className="h-9 text-sm" />}
                </Field>
            </fieldset>

            <div className="rounded-lg border border-border p-4">
                <p className="flex items-center gap-2 text-sm font-medium"><KeyRound size={14} /> Set a new password</p>
                <p className="mb-3 text-xs text-muted-foreground">
                    For someone locked out. They are signed out everywhere and must use the new password.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        aria-label="New password"
                        disabled={!canEdit || saving}
                        className="h-9 w-64 text-sm"
                    />
                    <Button type="button" size="sm" onClick={resetPassword} disabled={!canEdit || saving || password.length < 6}>
                        Set password
                    </Button>
                </div>
            </div>
        </div>
    );
}
