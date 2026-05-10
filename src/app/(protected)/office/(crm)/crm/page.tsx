import { prisma } from "@/shared/lib/prisma/prismaClient";
import { getCrmPipeline } from "@/shared/lib/format/crmPipeline";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

type Search = { q?: string; status?: string };

export default async function CrmLeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canManage =
        permissions.includes("admin:bypass") || permissions.includes("crm:manage");
    if (!permissions.includes("admin:bypass") && !permissions.includes("crm:view")) {
        redirect("/office/assignments");
    }

    const sp = await searchParams;
    const q = sp.q?.trim();
    const statusFilter = sp.status?.trim();

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline) {
        return (
            <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">CRM Leads</h1>
                <p className="text-muted-foreground text-sm">
                    CRM pipeline is missing. Run <code className="text-foreground">pnpm exec tsx src/new-seed.ts</code>{" "}
                    to create the <code className="text-foreground">crm-leads</code> pipeline.
                </p>
            </div>
        );
    }

    const where = {
        pipelineId: pipeline.id,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(q
            ? {
                  OR: [
                      { title: { contains: q, mode: "insensitive" as const } },
                      { contactName: { contains: q, mode: "insensitive" as const } },
                      { companyName: { contains: q, mode: "insensitive" as const } },
                      { email: { contains: q, mode: "insensitive" as const } },
                      { phone: { contains: q } },
                  ],
              }
            : {}),
    };

    const leads = await prisma.crmLead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
            ticketStatus: { select: { id: true, label: true, color: true } },
            owner: { select: { id: true, name: true } },
        },
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">CRM Leads</h1>
                    <p className="text-muted-foreground text-sm">
                        Track opportunities on the <span className="text-foreground">{pipeline.label}</span> pipeline.
                    </p>
                </div>
                {canManage && (
                    <Button asChild>
                        <Link href="/office/crm/leads/new">New lead</Link>
                    </Button>
                )}
            </div>

            <form className="flex flex-col gap-3 border-2 border-border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end" method="get">
                <div className="space-y-1 flex-1 min-w-[200px]">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="q">
                        Search
                    </label>
                    <Input id="q" name="q" placeholder="Title, contact, company…" defaultValue={q ?? ""} />
                </div>
                <div className="space-y-1 w-full sm:w-48">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="status">
                        Stage
                    </label>
                    <select
                        id="status"
                        name="status"
                        defaultValue={statusFilter ?? ""}
                        className="border-2 border-border bg-background h-10 w-full px-3 text-sm font-medium"
                    >
                        <option value="">All stages</option>
                        {pipeline.statuses.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex gap-2">
                    <Button type="submit">Apply</Button>
                    <Button type="button" variant="outline" asChild>
                        <Link href="/office/crm">Reset</Link>
                    </Button>
                </div>
            </form>

            {leads.length === 0 ? (
                <p className="text-muted-foreground text-sm border-2 border-border border-dashed p-8 text-center">
                    No leads yet.
                    {canManage && (
                        <>
                            {" "}
                            <Link href="/office/crm/leads/new" className="text-primary underline-offset-4 hover:underline">
                                Create the first lead
                            </Link>
                            .
                        </>
                    )}
                </p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>Stage</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead className="text-right">Value</TableHead>
                            <TableHead className="text-right">Updated</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {leads.map((lead) => (
                            <TableRow key={lead.id}>
                                <TableCell>
                                    <Link
                                        href={`/office/crm/leads/${lead.id}`}
                                        className="font-medium text-primary hover:underline"
                                    >
                                        {lead.title}
                                    </Link>
                                    {(lead.companyName || lead.contactName) && (
                                        <p className="text-muted-foreground text-xs mt-0.5">
                                            {[lead.contactName, lead.companyName].filter(Boolean).join(" · ")}
                                        </p>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <Badge className={lead.ticketStatus.color}>{lead.ticketStatus.label}</Badge>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                    {lead.owner?.name ?? "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {lead.valuePaise != null ? formatRupeesFromPaise(lead.valuePaise) : "—"}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground text-xs">
                                    {lead.updatedAt.toLocaleDateString("en-IN")}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
