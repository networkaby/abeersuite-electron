"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import { ExternalLink, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { extractApiError } from "@/shared/lib/api";
import { InvProductCombobox } from "@/modules/inventory/components/InvProductCombobox";
import type { VariantMember } from "@/modules/inventory/lib/variants";
import { attrAppliesToGroup, type AttrMasterApiRow } from "@/modules/inventory/lib/attributeMasters";
import { attrKeyLabel } from "@/modules/ecommerce/lib/shopQualification";

type Family = { members: VariantMember[] };
type GroupOpt = { id: number; parentId?: number | null };

/**
 * "Variants" on a saved product (owner, 2026-11-10): the products that are the
 * same item in another option (XYZ Black / XYZ Blue), each still its own
 * product. Shown as a table — one row per product, one column per attribute
 * the family uses — so staff fill a missing value right here instead of
 * opening each product. Every cell saves on its own when it loses focus; an
 * empty cell is red because that product waits as Pending until it is filled.
 * The shop button text is automatic (lib/shop/variants.ts). See lib/variants.ts.
 *
 * `selfReadOnly`: in the inventory dialog this product's own attributes are in
 * the form (Basics tab) and saved with it, so its row is not edited here.
 */
export default function ProductVariantsSection({
    productId,
    onMembersChange,
    selfReadOnly = false,
}: {
    productId: number;
    /** Told the family after every load / change. */
    onMembersChange?: (members: VariantMember[]) => void;
    selfReadOnly?: boolean;
}) {
    const [family, setFamily] = useState<Family | null>(null);
    const [busy, setBusy] = useState(false);
    const [pickNonce, setPickNonce] = useState(0);
    const [masters, setMasters] = useState<AttrMasterApiRow[]>([]);
    const [groups, setGroups] = useState<GroupOpt[]>([]);
    /** Columns added with "Add attribute" that no member has filled yet. */
    const [extraKeys, setExtraKeys] = useState<string[]>([]);
    const url = `/api/inventory/products/${productId}/variants`;

    useEffect(() => {
        let live = true;
        Promise.all([
            axios.get<Family>(url),
            axios.get<AttrMasterApiRow[]>("/api/inventory/attribute-masters").catch(() => ({ data: [] as AttrMasterApiRow[] })),
            axios.get<GroupOpt[]>("/api/inventory/product-groups").catch(() => ({ data: [] as GroupOpt[] })),
        ])
            .then(([f, m, g]) => {
                if (!live) return;
                setFamily(f.data);
                setMasters(m.data.filter((x) => x.isActive));
                setGroups(g.data);
            })
            .catch((e) => toast.error(extractApiError(e, "Could not load variants")));
        return () => {
            live = false;
        };
    }, [url]);

    // A ref, so a parent passing a fresh arrow each render does not re-run this.
    const membersCb = useRef(onMembersChange);
    useEffect(() => {
        membersCb.current = onMembersChange;
    });
    useEffect(() => {
        if (family) membersCb.current?.(family.members);
    }, [family]);

    const members = useMemo(() => family?.members ?? [], [family]);

    // Columns: every attribute any member has, in first-seen order, then the
    // ones just added here.
    const keys = useMemo(() => {
        const out: string[] = [];
        for (const m of members) for (const k of Object.keys(m.attrs)) if (!out.includes(k)) out.push(k);
        for (const k of extraKeys) if (!out.includes(k)) out.push(k);
        return out;
    }, [members, extraKeys]);

    const labelOf = (key: string) => masters.find((m) => m.key === key)?.name ?? attrKeyLabel(key);

    // "Add attribute": active masters that apply to at least one member's group.
    const addable = useMemo(() => {
        const parentOf = (id: number) => groups.find((g) => g.id === id)?.parentId;
        return masters.filter(
            (m) => !keys.includes(m.key) && members.some((p) => attrAppliesToGroup(m.groupIds, p.groupId, parentOf)),
        );
    }, [masters, groups, members, keys]);

    const run = async (call: () => Promise<{ data: Family }>, fail: string) => {
        setBusy(true);
        try {
            const { data } = await call();
            setFamily(data);
        } catch (e) {
            toast.error(extractApiError(e, fail));
        } finally {
            setBusy(false);
        }
    };

    const saveCell = (memberId: number, key: string, value: string) => {
        const before = members.find((m) => m.id === memberId)?.attrs[key] ?? "";
        if (before === value.trim()) return;
        void run(() => axios.patch<Family>(url, { memberId, attrs: { [key]: value } }), "Could not save");
    };

    // Optimistic: the row goes at once and comes back if the server says no.
    const remove = async (memberId: number) => {
        const before = family;
        if (!before) return;
        const left = before.members.filter((m) => m.id !== memberId);
        const self = memberId === productId;
        setFamily({ members: self || left.length <= 1 ? [] : left });
        try {
            const { data } = await axios.delete<Family>(url, { params: { memberId } });
            setFamily(data);
        } catch (e) {
            setFamily(before);
            toast.error(extractApiError(e, "Could not remove"));
        }
    };

    return (
        <section className="mt-4 space-y-3 rounded-lg border p-4">
            <div>
                <h3 className="text-sm font-semibold">Variants</h3>
                <p className="text-xs text-muted-foreground">
                    Same item in another option (colour, size, length). Each stays its own product; the shop shows them as
                    option buttons, named from what differs (attributes, brand, group). Fill every cell — an empty one keeps
                    that product Pending.
                </p>
            </div>

            {members.length > 0 ? (
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Product</th>
                                {keys.map((k) => (
                                    <th key={k} className="px-2 py-2 text-left font-medium">{labelOf(k)}</th>
                                ))}
                                <th className="px-2 py-2 text-left font-medium">Shop</th>
                                <th className="w-px" />
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {members.map((m) => {
                                const isSelf = m.id === productId;
                                const readOnly = isSelf && selfReadOnly;
                                return (
                                    <tr key={m.id} className={isSelf ? "bg-primary/5" : undefined}>
                                        <td className="px-3 py-2 align-middle">
                                            <div className="max-w-[260px] truncate" title={m.name}>{m.name}</div>
                                            <div className="text-[11px] text-muted-foreground">
                                                {m.sku}
                                                {isSelf ? " · this product" : ""}
                                                {!m.isActive ? " · inactive" : ""}
                                            </div>
                                        </td>
                                        {keys.map((k) => {
                                            const value = m.attrs[k] ?? "";
                                            return (
                                                <td key={k} className="px-2 py-1.5 align-middle">
                                                    {readOnly ? (
                                                        <span className={value ? "" : "text-xs text-destructive"} title="Edit in the Basics tab">
                                                            {value || "empty — fill in Basics"}
                                                        </span>
                                                    ) : (
                                                        <Input
                                                            // Remount on a new saved value so the box shows it.
                                                            key={`${m.id}:${k}:${value}`}
                                                            defaultValue={value}
                                                            placeholder="fill"
                                                            maxLength={120}
                                                            disabled={busy}
                                                            className={`h-8 min-w-[100px] text-sm ${value ? "" : "border-destructive"}`}
                                                            onBlur={(e) => saveCell(m.id, k, e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                                            }}
                                                        />
                                                    )}
                                                </td>
                                            );
                                        })}
                                        <td className="px-2 py-2 align-middle text-xs">
                                            <MemberStatus m={m} />
                                        </td>
                                        <td className="px-2 py-2 align-middle">
                                            <div className="flex items-center justify-end gap-1">
                                                {!isSelf ? (
                                                    <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                                                        <Link href={`/office/ecommerce/products/${m.id}`} title="Open this product">
                                                            <ExternalLink className="size-3.5" />
                                                            Open
                                                        </Link>
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-7"
                                                    disabled={busy}
                                                    onClick={() => void remove(m.id)}
                                                    aria-label={isSelf ? "Leave this family" : `Remove ${m.name}`}
                                                    title={isSelf ? "Leave this family" : "Remove from family"}
                                                >
                                                    <X className="size-4" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">No variants yet — add the first one below.</p>
            )}

            <div className="flex flex-wrap items-end gap-3">
                <div className="grid min-w-[280px] flex-1 gap-1.5">
                    <Label>Add variant</Label>
                    <InvProductCombobox
                        value={null}
                        allowCreate={false}
                        hideCost
                        clearNonce={pickNonce}
                        placeholder="Scan barcode or type name / SKU…"
                        excludeIds={[productId, ...members.map((m) => m.id)]}
                        onChange={(p) => {
                            if (!p) return;
                            setPickNonce((n) => n + 1);
                            void run(() => axios.post<Family>(url, { otherId: p.id }), "Could not add variant");
                        }}
                    />
                </div>
                {members.length > 0 && addable.length > 0 ? (
                    <div className="grid gap-1.5">
                        <Label>Add attribute</Label>
                        <Select
                            value=""
                            onValueChange={(key) => {
                                if (key) setExtraKeys((ks) => [...ks, key]);
                            }}
                        >
                            <SelectTrigger className="w-48">
                                <Plus className="size-4" />
                                <SelectValue placeholder="Column for all…" />
                            </SelectTrigger>
                            <SelectContent>
                                {addable.map((m) => (
                                    <SelectItem key={m.key} value={m.key}>{m.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
            </div>
        </section>
    );
}

/** Live / Pending (with what is missing) / the stage, per row. */
function MemberStatus({ m }: { m: VariantMember }) {
    if (m.shopStatus === "PUBLISHED" && m.isListedInShop) {
        return <span className="font-medium text-emerald-700">Live</span>;
    }
    if (m.shopStatus === "PUBLISHED") {
        return (
            <span className="text-amber-700" title="Published, but a publish rule is not met">
                Pending{m.gaps.length ? ` — needs ${m.gaps.join(", ")}` : ""}
            </span>
        );
    }
    const stage = m.shopStatus.charAt(0) + m.shopStatus.slice(1).toLowerCase();
    return (
        <span className="text-muted-foreground">
            {stage}
            {m.gaps.length ? <span className="text-destructive"> · needs {m.gaps.join(", ")}</span> : null}
        </span>
    );
}
