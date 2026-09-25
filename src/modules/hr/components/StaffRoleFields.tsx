"use client";

// Role and Reports to — on the Job tab. Roles and their permissions are DEFINED
// in Administration; this only picks which existing role the person holds and
// who they report to, through the same `PUT /api/users/[id]` as Admin → Users.
//
// "Data scope" (Own/Team/Department/…) used to be editable here too. It's
// hidden for now — the `scope` column and session plumbing still exist, but
// no API route reads it to restrict what a user sees. Bring the field back
// once something actually enforces it.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
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

export default function StaffRoleFields({ detail, canEdit, onChanged }: {
    detail: StaffDetail;
    /** users:edit — without it the boxes are read-only, never hidden. */
    canEdit: boolean;
    onChanged: () => void;
}) {
    const { user } = detail;
    const { data: roles } = useApiResource<RoleRow[]>("/api/roles");
    const { data: staff } = useApiResource<StaffRow[]>("/api/hr/staff");
    const [saving, setSaving] = useState(false);

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

    /** `PUT /api/users/[id]` wants the identity fields on every call, so they ride along unchanged. */
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
        <fieldset disabled={!canEdit || saving} className="grid max-w-3xl gap-4 border-0 p-0 sm:grid-cols-2">
            <Field label="Role" hint="Decides what they may do. Roles are set up in Administration.">
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
    );
}
