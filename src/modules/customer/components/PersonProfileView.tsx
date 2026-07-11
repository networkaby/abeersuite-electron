import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, User, Building2, Smartphone, Eye, ArrowRight } from "lucide-react";
import { formatDate } from "@/shared/lib/format/formatDate";
import { auth } from "@/auth";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import CustomerLinkPanel from "@/modules/customer/components/CustomerLinkPanel";
import CustomerEmergencyPasswordResetCard from "@/modules/customer/components/CustomerEmergencyPasswordResetCard";

type Props = {
    personId: number;
    backHref?: string;
};

export default async function PersonProfileView({ personId, backHref = "/office/customers" }: Props) {
    const session = await auth();
    const permissions = ((session?.user as { permissions?: string[] } | undefined)?.permissions ?? []);
    const canEmergencyReset = permissions.includes(PERMISSIONS.USERS_EDIT_ORG) || permissions.includes(PERMISSIONS.ADMIN_BYPASS);

    const person = await prisma.person.findUnique({
        where: { id: personId },
        include: {
            phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
            emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
            account: {
                include: {
                    devices: {
                        include: {
                            // A device's repair tickets hang off TicketRepair now.
                            repairs: {
                                include: {
                                    ticket: {
                                        include: { ticketStatus: { select: { label: true, color: true } } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            companies: {
                where: { unlinkedAt: null },
                include: {
                    company: {
                        select: {
                            id: true,
                            name: true,
                            phones: selectPrimaryPhone,
                            account: { select: { id: true } },
                        },
                    },
                },
            },
            convertedToCompany: { select: { id: true, name: true } },
        },
    });

    if (!person) notFound();
    // Tombstone — soft-deleted via the Person → Company converter.
    // Show the banner and stop; the live data lives on the new company row.
    if (!person.isActive && person.convertedToCompanyId != null && person.convertedToCompany) {
        return (
            <div>
                <div className="flex items-center gap-3 mb-6">
                    <Link href={backHref} className="text-muted-foreground hover:text-foreground">
                        <ArrowLeft size={20} />
                    </Link>
                    <div className="flex items-center gap-3">
                        <User size={22} className="text-muted-foreground" />
                        <div>
                            <h1 className="text-2xl font-bold text-muted-foreground line-through">{person.name}</h1>
                            <p className="text-muted-foreground text-sm">Customer #{person.id} (converted)</p>
                        </div>
                    </div>
                </div>
                <div className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    This person was converted to a company
                    {person.convertedAt ? ` on ${formatDate(person.convertedAt.toISOString())}` : ""}.
                    The live record is now{" "}
                    <Link
                        href={`/office/customers/companies/${person.convertedToCompany.id}`}
                        className="inline-flex items-center gap-1 font-medium underline"
                    >
                        Company #{person.convertedToCompany.id} — {person.convertedToCompany.name}
                        <ArrowRight size={14} />
                    </Link>
                    .
                </div>
            </div>
        );
    }
    if (!person.isActive) notFound();

    return (
        <div>
            <div className="flex items-center gap-3 mb-6">
                <Link href={backHref} className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex items-center gap-3">
                    <User size={22} className="text-primary" />
                    <div>
                        <h1 className="text-2xl font-bold">{person.name}</h1>
                        <p className="text-muted-foreground text-sm">Customer #{person.id}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-3 rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide">Contact Info</h2>
                    <div className="space-y-2 text-sm">
                        {person.phones.length > 0 && (
                            <div>
                                <span className="text-muted-foreground block mb-1">Phones</span>
                                <ul className="space-y-1">
                                    {person.phones.map(p => (
                                        <li key={p.id} className="flex items-center justify-between gap-2">
                                            <span className="font-medium">{p.phone}</span>
                                            {p.isPrimary && (
                                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">primary</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {person.emails.length > 0 && (
                            <div>
                                <span className="text-muted-foreground block mb-1">Emails</span>
                                <ul className="space-y-1">
                                    {person.emails.map(e => (
                                        <li key={e.id} className="flex items-center justify-between gap-2">
                                            <span className="font-medium">{e.email}</span>
                                            {e.isPrimary && (
                                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">primary</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {person.address && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Address</span>
                                <span className="font-medium text-right max-w-[200px]">{person.address}</span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Customer since</span>
                            <span className="font-medium">{formatDate(person.createdAt.toISOString())}</span>
                        </div>
                        {person.account && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Account #</span>
                                <span className="font-medium text-muted-foreground">{person.account.id}</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5 shadow">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide flex items-center gap-2">
                            <Building2 size={14} /> Linked Companies
                        </h2>
                    </div>
                    <CustomerLinkPanel customerId={person.id} initialLinks={person.companies.map(cc => ({
                        id: cc.id,
                        company: {
                            id: cc.company.id,
                            accountId: cc.company.account!.id,
                            name: cc.company.name,
                            phone: cc.company.phones[0]?.phone ?? null,
                        },
                    }))} />
                </div>

                <div className="rounded-lg border border-border bg-card p-5 shadow">
                    <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide flex items-center gap-2 mb-3">
                        <Smartphone size={14} /> Devices &amp; Tickets
                    </h2>
                    {(person.account?.devices ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No devices yet.</p>
                    ) : (
                        <div className="space-y-4">
                            {(person.account?.devices ?? []).map(d => (
                                <div key={d.id} className="rounded-md border border-border p-3">
                                    <p className="font-medium text-sm">{d.brand} {d.model}</p>
                                    <p className="text-xs text-muted-foreground">{d.type}</p>
                                    <div className="mt-2 space-y-1">
                                        {d.repairs.map(({ ticket: t }) => (
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
                                        {d.repairs.length === 0 && <p className="text-muted-foreground text-xs">No tickets</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {canEmergencyReset ? (
                <div className="mt-6">
                    <CustomerEmergencyPasswordResetCard customerId={person.id} />
                </div>
            ) : null}
        </div>
    );
}
