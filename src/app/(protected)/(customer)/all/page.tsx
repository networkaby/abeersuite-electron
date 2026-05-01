"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Building2, Search, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PersonRow = {
    id: number;
    name: string;
    phone: string | null;
};

type CompanyRow = {
    id: number;
    name: string;
    phone: string | null;
};

type CombinedListItem =
    | { kind: "person"; id: number; name: string; phone: string | null }
    | { kind: "company"; id: number; name: string; phone: string | null };

function initials(name: string) {
    return name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

export default function AllCustomersPage() {
    const [people, setPeople] = useState<PersonRow[]>([]);
    const [companies, setCompanies] = useState<CompanyRow[]>([]);
    const [search, setSearch] = useState("");

    useEffect(() => {
        axios.get<PersonRow[]>("/api/customers").then((res) => setPeople(res.data)).catch(() => setPeople([]));
        axios.get<CompanyRow[]>("/api/companies").then((res) => setCompanies(res.data)).catch(() => setCompanies([]));
    }, []);

    const merged = useMemo<CombinedListItem[]>(
        () => [
            ...people.map((person) => ({ kind: "person" as const, id: person.id, name: person.name, phone: person.phone })),
            ...companies.map((company) => ({ kind: "company" as const, id: company.id, name: company.name, phone: company.phone })),
        ],
        [people, companies]
    );

    const filtered = useMemo(
        () =>
            search.trim()
                ? merged.filter(
                    (item) =>
                        item.name.toLowerCase().includes(search.toLowerCase()) ||
                        (item.phone ?? "").includes(search)
                )
                : merged,
        [merged, search]
    );

    return (
        <div className="-m-8 flex h-screen">
            <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                        <User size={16} className="text-primary" />
                        <span className="text-sm font-semibold">All Customers</span>
                        <Badge variant="outline">{people.length} + {companies.length} = {people.length + companies.length}</Badge>
                    </div>
                </div>

                <div className="border-b p-3">
                    <div className="relative">
                        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search name or phone..."
                            className="pl-9"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <p className="py-8 text-center text-xs text-muted-foreground">
                            {search ? "No matches" : "No customers yet"}
                        </p>
                    ) : (
                        filtered.map((item) => {
                            const href = item.kind === "person" ? `/customers/${item.id}` : `/companies/${item.id}`;
                            const Icon = item.kind === "person" ? User : Building2;
                            return (
                                <Button
                                    key={`${item.kind}-${item.id}`}
                                    asChild
                                    type="button"
                                    variant="ghost"
                                    className="h-auto w-full justify-start rounded-none border-b px-4 py-3"
                                >
                                    <Link href={href}>
                                        <div className="flex w-full items-center gap-3 text-left">
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-muted text-xs font-bold">
                                                {initials(item.name)}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">{item.name}</p>
                                                <p className="truncate text-xs text-muted-foreground">{item.phone || "No phone"}</p>
                                            </div>
                                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                                <Icon size={10} className="mr-1" />
                                                {item.kind === "person" ? "Person" : "Company"}
                                            </Badge>
                                        </div>
                                    </Link>
                                </Button>
                            );
                        })
                    )}
                </div>
            </aside>

            <section className="flex flex-1 items-center justify-center bg-muted/30 p-6">
                <p className="text-sm text-muted-foreground">
                    Select a person or company from the list to open details.
                </p>
            </section>
        </div>
    );
}
