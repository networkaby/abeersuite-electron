"use client";

// Group hierarchy view — InvProductGroup tree with own + resolved tax per node.
// Inline edit for own gstRate/HSN/taxability on each row, via the existing
// PATCH /api/inventory/product-groups/[id] endpoint.

import { useMemo, useState } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RateCell, HsnCell, TaxabilityCell, type GstRateOpt } from "./InlineTaxCells";
import type { GstClassificationPayload, GroupRow } from "./types";

interface Props {
    data: GstClassificationPayload;
    canEdit: boolean;
    onSaved: () => void;
}

type TreeNode = GroupRow & { children: TreeNode[] };

function buildTree(groups: GroupRow[]): TreeNode[] {
    const byId = new Map<number, TreeNode>();
    for (const g of groups) byId.set(g.id, { ...g, children: [] });
    const roots: TreeNode[] = [];
    for (const n of byId.values()) {
        if (n.parentId != null && byId.has(n.parentId)) {
            byId.get(n.parentId)!.children.push(n);
        } else {
            roots.push(n);
        }
    }
    const sortRec = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => a.name.localeCompare(b.name));
        for (const n of nodes) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
}

export function GroupHierarchyTab({ data, canEdit, onSaved }: Props) {
    const tree = useMemo(() => buildTree(data.groups), [data.groups]);
    const rates: GstRateOpt[] = data.rates.map((r) => ({
        id: r.id, rate: r.rate, label: r.label, isActive: r.isActive,
    }));

    const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
    const toggle = (id: number) => setCollapsed((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const expandAll = () => setCollapsed(new Set());
    const collapseAll = () => {
        const all = new Set<number>();
        for (const g of data.groups) if (g.parentId == null || data.groups.some((x) => x.parentId === g.id)) all.add(g.id);
        setCollapsed(all);
    };

    if (data.groups.length === 0) {
        return (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
                <Layers className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No product groups yet.</p>
                <GatedLink
                    href="/office/inventory/masters/product-groups"
                    className="mt-2 inline-block text-sm text-primary underline"
                >
                    Create product groups
                </GatedLink>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                    Each group can carry its own GST rate, HSN, and taxability — child groups and products inherit when their fields are empty.
                </p>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={expandAll}>Expand all</Button>
                    <Button type="button" variant="outline" size="sm" onClick={collapseAll}>Collapse all</Button>
                </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                    <thead className="border-b bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Group</th>
                            <th className="px-3 py-2 text-right font-medium">Direct products</th>
                            <th className="px-3 py-2 text-left font-medium">GST rate</th>
                            <th className="px-3 py-2 text-left font-medium">HSN / SAC</th>
                            <th className="px-3 py-2 text-left font-medium">Taxability</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tree.flatMap((root) => renderRows(root, 0, collapsed, toggle, rates, canEdit, onSaved))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function renderRows(
    node: TreeNode,
    depth: number,
    collapsed: Set<number>,
    toggle: (id: number) => void,
    rates: GstRateOpt[],
    canEdit: boolean,
    onSaved: () => void,
): React.ReactNode[] {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const patchUrl = `/api/inventory/product-groups/${node.id}`;
    const rows: React.ReactNode[] = [
        <tr key={node.id} className="group border-b last:border-0 hover:bg-muted/40">
            <td className="px-3 py-2" style={{ paddingLeft: `${12 + depth * 16}px` }}>
                <div className="flex items-center gap-1">
                    {hasChildren ? (
                        <button
                            type="button"
                            onClick={() => toggle(node.id)}
                            className="rounded p-0.5 hover:bg-muted"
                            aria-label={isCollapsed ? "Expand" : "Collapse"}
                        >
                            {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        </button>
                    ) : <span className="inline-block w-[18px]" />}
                    <span className={node.isActive ? "font-medium" : "italic text-muted-foreground"}>{node.name}</span>
                    {!node.isActive && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">inactive</span>}
                </div>
            </td>
            <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{node.directProductCount || ""}</td>
            <td className="px-3 py-2">
                <RateCell
                    ownRateId={node.own.gstRateId}
                    resolvedRate={node.resolved.gstRate}
                    resolvedSource={node.resolved.gstSource}
                    rates={rates}
                    patchUrl={patchUrl}
                    onSaved={onSaved}
                    canEdit={canEdit}
                />
            </td>
            <td className="px-3 py-2">
                <HsnCell
                    ownHsn={node.own.hsnCode}
                    resolvedHsn={node.resolved.hsnCode}
                    resolvedSource={node.resolved.hsnSource}
                    patchUrl={patchUrl}
                    onSaved={onSaved}
                    canEdit={canEdit}
                />
            </td>
            <td className="px-3 py-2">
                <TaxabilityCell
                    ownTaxability={node.own.taxability}
                    resolvedTaxability={node.resolved.taxability}
                    resolvedSource={node.resolved.taxabilitySource}
                    patchUrl={patchUrl}
                    onSaved={onSaved}
                    canEdit={canEdit}
                />
            </td>
        </tr>,
    ];
    if (!isCollapsed) {
        for (const child of node.children) {
            rows.push(...renderRows(child, depth + 1, collapsed, toggle, rates, canEdit, onSaved));
        }
    }
    return rows;
}
