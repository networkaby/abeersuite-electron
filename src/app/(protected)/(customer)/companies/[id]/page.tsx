import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@/lib/format-date";
import { ArrowLeft, Building2, User, Smartphone, Eye } from "lucide-react";
import CompanyLinkPanel from "@/modules/customer/components/CompanyLinkPanel";

export default async function CompanyDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    const company = await prisma.company.findUnique({
        where: { id: Number(id) },
        include: {
            account: {
                select: { id: true },
                include: {
                    devices: {
                        include: {
                            tickets: {
                                orderBy: { createdAt: "desc" },
                                take: 5,
                                include: {
                                    ticketStatus: { select: { label: true, color: true } },
                                },
                            },
                        },
                    },
                },
            },
            customers: {
                where: { unlinkedAt: null },
                include: {
                    customer: { select: { id: true, name: true, phone: true } },
                },
            },
        },
    });

    if (!company || !company.isActive) notFound();

    return (
        <div>
            <div className="flex items-center gap-3 mb-6">
                <Link href="/companies" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex items-center gap-3">
                    <Building2 size={22} className="text-primary" />
                    <div>
                        <h1 className="text-2xl font-bold">{company.name}</h1>
                        <p className="text-muted-foreground text-sm">Company #{company.id}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Info */}
                <div className="border-2 border-border shadow bg-card p-5 space-y-3">
                    <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide">Company Info</h2>
                    <div className="space-y-2 text-sm">
                        {company.phone && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Phone</span>
                                <span className="font-medium">{company.phone}</span>
                            </div>
                        )}
                        {company.email && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Email</span>
                                <span className="font-medium">{company.email}</span>
                            </div>
                        )}
                        {company.address && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Address</span>
                                <span className="font-medium text-right max-w-[200px]">{company.address}</span>
                            </div>
                        )}
                        {company.companyReg && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Company Reg</span>
                                <span className="font-medium">{company.companyReg}</span>
                            </div>
                        )}
                        {company.taxId && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Tax / VAT</span>
                                <span className="font-medium">{company.taxId}</span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Created</span>
                            <span className="font-medium">{formatDate(company.createdAt.toISOString())}</span>
                        </div>
                        {company.account && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Account #</span>
                                <span className="font-medium text-muted-foreground">{company.account.id}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Linked Contacts */}
                <div className="border-2 border-border shadow bg-card p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide flex items-center gap-2">
                            <User size={14} /> Linked Contacts
                        </h2>
                    </div>
                    <CompanyLinkPanel companyId={company.id} initialLinks={company.customers.map(cc => ({
                        id: cc.id,
                        customer: { id: cc.customer.id, name: cc.customer.name, phone: cc.customer.phone },
                    }))} />
                </div>

                {/* Devices & Tickets */}
                <div className="border-2 border-border shadow bg-card p-5">
                    <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide flex items-center gap-2 mb-3">
                        <Smartphone size={14} /> Devices &amp; Tickets
                    </h2>
                    {(company.account?.devices ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No devices yet.</p>
                    ) : (
                        <div className="space-y-4">
                            {(company.account?.devices ?? []).map(d => (
                                <div key={d.id} className="border-2 border-border p-3">
                                    <p className="font-medium text-sm">{d.brand} {d.model}</p>
                                    <p className="text-xs text-muted-foreground">{d.type}</p>
                                    <div className="mt-2 space-y-1">
                                        {d.tickets.map(t => (
                                            <div key={t.id} className="flex items-center justify-between text-xs">
                                                <Link href={`/tickets/${t.id}`} className="text-primary hover:underline">
                                                    #{t.id}
                                                </Link>
                                                <span className={`px-2 py-0.5 font-medium ${t.ticketStatus.color}`}>
                                                    {t.ticketStatus.label}
                                                </span>
                                                <Link href={`/tickets/${t.id}`} className="text-muted-foreground hover:text-primary">
                                                    <Eye size={12} />
                                                </Link>
                                            </div>
                                        ))}
                                        {d.tickets.length === 0 && <p className="text-muted-foreground text-xs">No tickets</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
