"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format";
import { useNow } from "@/shared/hooks";
import type { DealDto } from "../lib/types";

export default function DealTable({
    deals,
    onOpen,
}: {
    deals: DealDto[];
    onOpen: (dealId: number) => void;
}) {
    const [q, setQ] = useState("");
    // "now" read in an effect (useNow) — calling Date.now() during render trips react-hooks/purity.
    const now = useNow();
    const needle = q.trim().toLowerCase();
    const filtered = needle
        ? deals.filter((l) =>
              [l.title, l.contactName, l.companyName, l.email, l.phone, l.person?.name, l.company?.name]
                  .filter(Boolean)
                  .some((v) => v!.toLowerCase().includes(needle)),
          )
        : deals;

    return (
        <div className="space-y-3">
            <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search title, contact, company, email, phone…"
                className="max-w-sm"
            />
            {filtered.length === 0 ? (
                <p className="border border-dashed p-8 text-center text-sm text-muted-foreground">No deals.</p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>Stage</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead className="text-right">Value</TableHead>
                            <TableHead>Follow-up</TableHead>
                            <TableHead className="text-right">Updated</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((deal) => {
                            const holder = deal.assignedPosition?.holders[0]?.user;
                            const overdue =
                                deal.nextFollowUpAt && !deal.closedAt && new Date(deal.nextFollowUpAt).getTime() < now;
                            return (
                                <TableRow key={deal.id} className="cursor-pointer" onClick={() => onOpen(deal.id)}>
                                    <TableCell>
                                        <span className="font-medium">{deal.title}</span>
                                        {(deal.contactName || deal.companyName) && (
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {[deal.contactName, deal.companyName].filter(Boolean).join(" · ")}
                                            </p>
                                        )}
                                    </TableCell>
                                    <TableCell><Badge className={deal.ticketStatus.color}>{deal.ticketStatus.label}</Badge></TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {deal.assignedPosition ? (
                                            <>
                                                {deal.assignedPosition.title}
                                                {holder ? <span className="block text-xs">{holder.name}</span> : null}
                                            </>
                                        ) : "—"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {deal.valuePaise != null ? formatRupeesFromPaise(deal.valuePaise) : "—"}
                                    </TableCell>
                                    <TableCell className={overdue ? "text-red-600" : "text-muted-foreground"}>
                                        {deal.nextFollowUpAt ? formatDate(deal.nextFollowUpAt) : "—"}
                                    </TableCell>
                                    <TableCell className="text-right text-xs text-muted-foreground">
                                        {formatDate(deal.updatedAt)}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
