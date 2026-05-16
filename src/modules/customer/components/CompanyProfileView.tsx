import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, User, Smartphone, Eye } from "lucide-react";
import { formatDate } from "@/shared/lib/format/formatDate";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import CompanyLinkPanel from "@/modules/customer/components/CompanyLinkPanel";
import { getCompanyContacts } from "@/modules/customer/lib/companyContacts";

type Props = {
    companyId: number;
    backHref?: string;
};

export default async function CompanyProfileView({ companyId, backHref = "/office/customers/companies" }: Props) {
    const company = await prisma.company.findUnique({
        where: { id: companyId },
        include: {
            account: {
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
            persons: {
                where: { unlinkedAt: null },
                include: {
                    person: {
                        select: {
                            id: true,
                            name: true,
                            phones: selectPrimaryPhone,
                            account: { select: { id: true } },
                        },
                    },
                },
            },
        },
    });

    if (!company || !company.isActive) notFound();

    const contacts = await getCompanyContacts(companyId);

    return (
        <div>
            <div className="flex items-center gap-3 mb-6">
                <Link href={backHref} className="text-muted-foreground hover:text-foreground">
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
                <div className="space-y-3 rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide">Company Info</h2>
                    <div className="space-y-2 text-sm">
                        {contacts.phones.length > 0 && (
                            <div>
                                <span className="text-muted-foreground block mb-1">Phones</span>
                                <ul className="space-y-1">
                                    {contacts.phones.map(p => (
                                        <li key={p.id} className="flex items-center justify-between">
                                            <span className="font-medium">{p.value}</span>
                                            {p.isPrimary && <span className="text-[10px] uppercase text-muted-foreground">primary</span>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {contacts.emails.length > 0 && (
                            <div>
                                <span className="text-muted-foreground block mb-1">Emails</span>
                                <ul className="space-y-1">
                                    {contacts.emails.map(e => (
                                        <li key={e.id} className="flex items-center justify-between">
                                            <span className="font-medium">{e.value}</span>
                                            {e.isPrimary && <span className="text-[10px] uppercase text-muted-foreground">primary</span>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {(contacts.derivedPhones.length > 0 || contacts.derivedEmails.length > 0) && (
                            <div className="pt-2 border-t border-border">
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">From linked people</span>
                                <ul className="space-y-1 text-xs">
                                    {contacts.derivedPhones.map(p => (
                                        <li key={`p${p.id}`} className="flex items-center justify-between">
                                            <span>{p.value}</span>
                                            <span className="text-muted-foreground">{p.fromPersonName}</span>
                                        </li>
                                    ))}
                                    {contacts.derivedEmails.map(e => (
                                        <li key={`e${e.id}`} className="flex items-center justify-between">
                                            <span>{e.value}</span>
                                            <span className="text-muted-foreground">{e.fromPersonName}</span>
                                        </li>
                                    ))}
                                </ul>
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

                <div className="rounded-lg border border-border bg-card p-5 shadow">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide flex items-center gap-2">
                            <User size={14} /> Linked Contacts
                        </h2>
                    </div>
                    <CompanyLinkPanel companyId={company.id} initialLinks={company.persons.map(cc => ({
                        id: cc.id,
                        customer: {
                            id: cc.person.id,
                            accountId: cc.person.account!.id,
                            name: cc.person.name,
                            phone: cc.person.phones[0]?.phone ?? null,
                        },
                    }))} />
                </div>

                <div className="rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide flex items-center gap-2 mb-3">
                        <Smartphone size={14} /> Devices &amp; Tickets
                    </h2>
                    {(company.account?.devices ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No devices yet.</p>
                    ) : (
                        <div className="space-y-4">
                            {(company.account?.devices ?? []).map(d => (
                                <div key={d.id} className="rounded-md border border-border p-3">
                                    <p className="font-medium text-sm">{d.brand} {d.model}</p>
                                    <p className="text-xs text-muted-foreground">{d.type}</p>
                                    <div className="mt-2 space-y-1">
                                        {d.tickets.map(t => (
                                            <div key={t.id} className="flex items-center justify-between text-xs">
                                                <Link href={`/office/repairing/tickets/${t.id}`} className="text-primary hover:underline">
                                                    #{t.id}
                                                </Link>
                                                <span className={`px-2 py-0.5 font-medium ${t.ticketStatus.color}`}>
                                                    {t.ticketStatus.label}
                                                </span>
                                                <Link href={`/office/repairing/tickets/${t.id}`} className="text-muted-foreground hover:text-primary">
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
