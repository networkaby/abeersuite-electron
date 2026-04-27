import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@/lib/format-date";
import { ArrowLeft, User, Building2, Smartphone, Eye } from "lucide-react";
import CustomerLinkPanel from "@/modules/customer/components/CustomerLinkPanel";

export default async function CustomerDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    const customer = await prisma.customer.findUnique({
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
            companies: {
                where: { unlinkedAt: null },
                include: {
                    company: { select: { id: true, name: true, phone: true } },
                },
            },
        },
    });

    if (!customer || !customer.isActive) notFound();

    return (
        <div>
            <div className="flex items-center gap-3 mb-6">
                <Link href="/customers" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex items-center gap-3">
                    <User size={22} className="text-primary" />
                    <div>
                        <h1 className="text-2xl font-bold">{customer.name}</h1>
                        <p className="text-muted-foreground text-sm">Customer #{customer.id}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Contact Info */}
                <div className="border-2 border-border shadow bg-card p-5 space-y-3">
                    <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide">Contact Info</h2>
                    <div className="space-y-2 text-sm">
                        {customer.phone && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Phone</span>
                                <span className="font-medium">{customer.phone}</span>
                            </div>
                        )}
                        {customer.email && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Email</span>
                                <span className="font-medium">{customer.email}</span>
                            </div>
                        )}
                        {customer.address && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Address</span>
                                <span className="font-medium text-right max-w-[200px]">{customer.address}</span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Customer since</span>
                            <span className="font-medium">{formatDate(customer.createdAt.toISOString())}</span>
                        </div>
                        {customer.account && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Account #</span>
                                <span className="font-medium text-muted-foreground">{customer.account.id}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Linked Companies */}
                <div className="border-2 border-border shadow bg-card p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide flex items-center gap-2">
                            <Building2 size={14} /> Linked Companies
                        </h2>
                    </div>
                    <CustomerLinkPanel customerId={customer.id} initialLinks={customer.companies.map(cc => ({
                        id: cc.id,
                        company: { id: cc.company.id, name: cc.company.name, phone: cc.company.phone },
                    }))} />
                </div>

                {/* Devices & Tickets */}
                <div className="border-2 border-border shadow bg-card p-5">
                    <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide flex items-center gap-2 mb-3">
                        <Smartphone size={14} /> Devices &amp; Tickets
                    </h2>
                    {(customer.account?.devices ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No devices yet.</p>
                    ) : (
                        <div className="space-y-4">
                            {(customer.account?.devices ?? []).map(d => (
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
