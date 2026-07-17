"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Users, Download, RefreshCw, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PaginationBar } from "@/shared/components/PaginationBar";
import UserAvatar from "@/shared/components/UserAvatar";
import { formatDate } from "@/shared/lib/format";
import { formatRupees } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api";
import {
    LIFECYCLE_META, LIFECYCLES,
    type ContactDto, type ContactPositionOption, type ContactsResponse,
} from "../lib/contactTypes";

const ALL = "__all__";

function toCsv(rows: ContactDto[]): string {
    const head = ["Name", "Phone", "Email", "Lifecycle", "Owner", "Tags", "Deals", "Created"];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = rows.map((c) =>
        [
            c.name,
            c.phones.find((p) => p.isPrimary)?.phone ?? c.phones[0]?.phone ?? "",
            c.emails.find((e) => e.isPrimary)?.email ?? c.emails[0]?.email ?? "",
            LIFECYCLE_META[c.lifecycleStage].label,
            c.owner?.title ?? "",
            c.tags.join("; "),
            String(c._count.deals),
            new Date(c.createdAt).toISOString().slice(0, 10),
        ].map(esc).join(","),
    );
    return "﻿" + [head.map(esc).join(","), ...lines].join("\r\n");
}

export default function ContactsWorkspace({
    positions,
    canEdit,
    autoCredit,
}: {
    positions: ContactPositionOption[];
    canEdit: boolean;
    /** Global auto credit-limit switch — drives the "Auto" badge for customers with no manual limit. */
    autoCredit: boolean;
}) {
    const [items, setItems] = useState<ContactDto[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [loading, setLoading] = useState(true);

    // Filters
    const [q, setQ] = useState("");
    const [debouncedQ, setDebouncedQ] = useState("");
    const [lifecycle, setLifecycle] = useState<string>(ALL);
    const [owner, setOwner] = useState<string>(ALL);
    const [hasDeal, setHasDeal] = useState<string>(ALL);
    const [credit, setCredit] = useState<string>(ALL);
    const [tag, setTag] = useState("");
    const [sort, setSort] = useState("recent");

    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [bulkTag, setBulkTag] = useState("");

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
        return () => clearTimeout(t);
    }, [q]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(pageSize), sort });
            if (debouncedQ) params.set("q", debouncedQ);
            if (lifecycle !== ALL) params.set("lifecycleStage", lifecycle);
            if (owner !== ALL) params.set("ownerPositionId", owner);
            if (hasDeal !== ALL) params.set("hasDeal", hasDeal);
            if (credit !== ALL) params.set("credit", credit);
            if (tag.trim()) params.set("tag", tag.trim());
            const res = await axios.get<ContactsResponse>(`/api/contacts?${params.toString()}`);
            setItems(res.data.items);
            setTotal(res.data.total);
        } catch {
            toast.error("Failed to load contacts");
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, sort, debouncedQ, lifecycle, owner, hasDeal, credit, tag]);

    useEffect(() => { load(); }, [load]);
    // Reset to page 1 when filters change.
    useEffect(() => { setPage(1); }, [debouncedQ, lifecycle, owner, hasDeal, credit, tag, pageSize, sort]);

    const pageIds = useMemo(() => items.map((c) => c.id), [items]);
    const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    const toggleAllOnPage = () => {
        setSelected((s) => {
            const next = new Set(s);
            if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
            else pageIds.forEach((id) => next.add(id));
            return next;
        });
    };
    const toggleOne = (id: number) =>
        setSelected((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });

    const runBulk = async (action: Record<string, unknown>) => {
        const ids = [...selected];
        if (ids.length === 0) return;
        try {
            const res = await axios.post("/api/contacts/bulk", { ids, action });
            toast.success(`Updated ${res.data.affected} contact${res.data.affected === 1 ? "" : "s"}`);
            setSelected(new Set());
            load();
        } catch (err) {
            toast.error(extractApiError(err, "Bulk action failed"));
        }
    };

    const exportCsv = () => {
        const rows = selected.size > 0 ? items.filter((c) => selected.has(c.id)) : items;
        const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex h-full flex-col gap-4">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Users className="size-5" />
                    </span>
                    <div>
                        <h1 className="text-xl font-semibold leading-none tracking-tight">Contacts</h1>
                        <p className="mt-1 text-sm text-muted-foreground">{total} {total === 1 ? "contact" : "contacts"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>
                    <Button variant="outline" size="icon" onClick={load} title="Refresh"><RefreshCw className="size-4" /></Button>
                </div>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email…" className="max-w-xs" />
                <Select value={lifecycle} onValueChange={setLifecycle}>
                    <SelectTrigger className="w-[150px]"><SelectValue placeholder="Lifecycle" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>All stages</SelectItem>
                        {LIFECYCLES.map((l) => <SelectItem key={l} value={l}>{LIFECYCLE_META[l].label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={owner} onValueChange={setOwner}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="Owner" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>Any owner</SelectItem>
                        <SelectItem value="none">Unowned</SelectItem>
                        {positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}{p.branchName ? ` · ${p.branchName}` : ""}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={hasDeal} onValueChange={setHasDeal}>
                    <SelectTrigger className="w-[140px]"><SelectValue placeholder="Deals" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>Any deals</SelectItem>
                        <SelectItem value="1">Has a deal</SelectItem>
                        <SelectItem value="0">No deal</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={credit} onValueChange={setCredit}>
                    <SelectTrigger className="w-[170px]"><SelectValue placeholder="Credit limit" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>Any credit</SelectItem>
                        <SelectItem value="manual">Manual limit set</SelectItem>
                        <SelectItem value="none">No manual limit</SelectItem>
                    </SelectContent>
                </Select>
                <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag…" className="w-[120px]" />
                <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="recent">Newest</SelectItem>
                        <SelectItem value="name">Name A–Z</SelectItem>
                        <SelectItem value="stage">Lifecycle</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Bulk bar */}
            {canEdit && selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium">{selected.size} selected</span>
                    <Select onValueChange={(v) => runBulk({ type: "lifecycle", value: v })}>
                        <SelectTrigger className="h-8 w-[150px]"><SelectValue placeholder="Set lifecycle" /></SelectTrigger>
                        <SelectContent>{LIFECYCLES.map((l) => <SelectItem key={l} value={l}>{LIFECYCLE_META[l].label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select onValueChange={(v) => runBulk({ type: "assignOwner", value: v === "none" ? null : v })}>
                        <SelectTrigger className="h-8 w-[170px]"><SelectValue placeholder="Assign owner" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Unassign</SelectItem>
                            {positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                        <Input value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="tag" className="h-8 w-[110px]" />
                        <Button size="sm" variant="outline" disabled={!bulkTag.trim()} onClick={() => { runBulk({ type: "addTag", value: bulkTag.trim() }); setBulkTag(""); }}>
                            <TagIcon className="size-3.5" /> Add
                        </Button>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => runBulk({ type: "deactivate" })}>Deactivate</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
            )}

            {/* Table */}
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <Table>
                    <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                            <TableHead className="w-8">
                                {canEdit && <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAllOnPage} aria-label="Select page" />}
                            </TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Lifecycle</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead>Tags</TableHead>
                            <TableHead className="text-right">Credit limit</TableHead>
                            <TableHead className="text-right">Deals</TableHead>
                            <TableHead className="text-right">Created</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                        ) : items.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No contacts match.</TableCell></TableRow>
                        ) : (
                            items.map((c) => {
                                const phone = c.phones.find((p) => p.isPrimary)?.phone ?? c.phones[0]?.phone;
                                const holder = c.owner?.holders[0]?.user;
                                return (
                                    <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                                        <TableCell>
                                            {canEdit && <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleOne(c.id)} aria-label={`Select ${c.name}`} />}
                                        </TableCell>
                                        <TableCell>
                                            <Link href={`/office/customers/all?personId=${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                                            {phone && <p className="text-xs text-muted-foreground">{phone}</p>}
                                        </TableCell>
                                        <TableCell><Badge className={LIFECYCLE_META[c.lifecycleStage].color}>{LIFECYCLE_META[c.lifecycleStage].label}</Badge></TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {c.owner ? (
                                                <span className="flex items-center gap-1.5">
                                                    {holder && <UserAvatar name={holder.name} avatarUrl={holder.avatarUrl} role={holder.role} sizePx={18} />}
                                                    <span className="text-sm">{c.owner.title}</span>
                                                </span>
                                            ) : "—"}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {c.tags.slice(0, 3).map((t) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t}</span>)}
                                                {c.tags.length > 3 && <span className="text-[11px] text-muted-foreground">+{c.tags.length - 3}</span>}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {(() => {
                                                const manual = c.account?.creditLimit != null ? Number(c.account.creditLimit) : 0;
                                                if (manual > 0) return <span className="tabular-nums">{formatRupees(manual)}</span>;
                                                if (autoCredit) return <Badge className="bg-blue-100 text-blue-700">Auto</Badge>;
                                                return <span className="text-muted-foreground">—</span>;
                                            })()}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{c._count.deals || "—"}</TableCell>
                                        <TableCell className="text-right text-xs text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <PaginationBar
                total={total}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                unitLabel="contacts"
            />
        </div>
    );
}
