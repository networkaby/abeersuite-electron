"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import {
    Wrench,
    User,
    Building2,
    Package,
    ArrowRight,
    Sparkles,
} from "lucide-react";
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { usePartySearch } from "@/shared/hooks/usePartySearch";

// ── Types ──────────────────────────────────────────────────────────────────

interface Product {
    id: number;
    sku: string | null;
    name: string;
    stock: number;
    pricePaise: number | null;
    mrpPaise: number | null;
    brand: { name: string } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TICKET_RE = /^(?:tkt[- ]?)?(\d{1,8})$/i;
const PHONE_RE = /^[6-9]\d{9}$/;

function detectTicketId(q: string): string | null {
    const trimmed = q.trim();
    const m = TICKET_RE.exec(trimmed);
    if (!m) return null;
    return `TKT-${m[1]}`;
}

function isPhone(q: string): boolean {
    const digits = q.trim().replace(/\D/g, "");
    return PHONE_RE.test(digits);
}

function formatPaise(paise: number | null): string {
    if (paise == null) return "—";
    return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Universal helper search — the hero of the Front Office.
 *
 * One input, three classes of result:
 *   - Direct ticket open  (detected by /^(?:tkt-?)?\d+$/i)
 *   - Customer matches    (debounced /api/people?lookup=)
 *   - Product matches     (in-memory filter on /api/inventory/products/lookup)
 *
 * Empty state shows three example queries so first-time users know what to try.
 */
export default function UniversalHelperSearch() {
    const router = useRouter();
    const [query, setQuery] = useState("");

    // Customers come from the canonical debounced hook.
    const { hits: peopleHits, loading: peopleLoading } = usePartySearch(query);

    // Products: load once, filter in memory (matches the InvProductCombobox pattern).
    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoaded, setProductsLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        axios
            .get<Product[]>("/api/inventory/products/lookup")
            .then((res) => {
                if (cancelled) return;
                setProducts(res.data);
                setProductsLoaded(true);
            })
            .catch(() => {
                if (cancelled) return;
                setProductsLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const productMatches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q.length < 2) return [];
        const matches = products.filter((p) => {
            const haystack = `${p.name} ${p.sku ?? ""} ${p.brand?.name ?? ""}`.toLowerCase();
            return haystack.includes(q);
        });
        return matches.slice(0, 8);
    }, [query, products]);

    const ticketId = detectTicketId(query);
    const phoneish = isPhone(query);
    const hasQuery = query.trim().length >= 2;

    return (
        <section className="rounded-xl border border-border bg-card p-1 shadow-sm">
            <Command
                shouldFilter={false}
                className="rounded-lg"
                /* cmdk filters by default; we already filter ourselves above. */
            >
                <CommandInput
                    placeholder="Help a customer — search products, tickets, customers, or type a phone number…"
                    value={query}
                    onValueChange={setQuery}
                    className="text-base"
                />
                <CommandList className="max-h-[420px]">
                    {!hasQuery && <EmptyHint />}

                    {hasQuery && (
                        <>
                            {ticketId && (
                                <CommandGroup heading="Open ticket">
                                    <CommandItem
                                        value={`ticket-${ticketId}`}
                                        onSelect={() =>
                                            router.push(
                                                `/office/repairing/tickets/${ticketId}`
                                            )
                                        }
                                        className="cursor-pointer"
                                    >
                                        <Wrench className="text-orange-600" />
                                        <span className="font-medium">{ticketId}</span>
                                        <span className="text-xs text-muted-foreground">
                                            Open ticket page
                                        </span>
                                        <ArrowRight className="ml-auto opacity-50" />
                                    </CommandItem>
                                </CommandGroup>
                            )}

                            {peopleHits.length > 0 && (
                                <CommandGroup
                                    heading={
                                        phoneish
                                            ? "Customers · phone match"
                                            : "Customers"
                                    }
                                >
                                    {peopleHits.slice(0, 6).map((p) => (
                                        <CommandItem
                                            key={`person-${p.type}-${p.id}`}
                                            value={`person-${p.type}-${p.id}`}
                                            onSelect={() =>
                                                router.push(
                                                    p.type === "company"
                                                        ? `/office/customers/companies`
                                                        : `/office/customers/people`
                                                )
                                            }
                                            className="cursor-pointer"
                                        >
                                            {p.type === "company" ? (
                                                <Building2 />
                                            ) : (
                                                <User />
                                            )}
                                            <span className="flex-1 truncate">
                                                {p.name}
                                            </span>
                                            <Badge
                                                variant="secondary"
                                                className="text-[10px]"
                                            >
                                                {p.type === "company"
                                                    ? "Company"
                                                    : "Person"}
                                            </Badge>
                                            <span className="w-32 truncate text-right text-xs text-muted-foreground">
                                                {p.phone ?? ""}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}

                            {productMatches.length > 0 && (
                                <CommandGroup heading="Products">
                                    {productMatches.map((prod) => {
                                        const lowStock = prod.stock <= 0;
                                        return (
                                            <CommandItem
                                                key={`product-${prod.id}`}
                                                value={`product-${prod.id}`}
                                                onSelect={() =>
                                                    router.push(
                                                        `/office/inventory/products`
                                                    )
                                                }
                                                className="cursor-pointer"
                                            >
                                                <Package className="text-emerald-600" />
                                                <div className="flex min-w-0 flex-1 flex-col">
                                                    <span className="truncate font-medium">
                                                        {prod.name}
                                                    </span>
                                                    <span className="truncate text-xs text-muted-foreground">
                                                        {prod.brand?.name
                                                            ? `${prod.brand.name} · `
                                                            : ""}
                                                        {prod.sku ?? "no SKU"}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col items-end gap-0.5">
                                                    <span className="font-medium">
                                                        {formatPaise(prod.pricePaise)}
                                                    </span>
                                                    <span
                                                        className={
                                                            lowStock
                                                                ? "text-[10px] text-destructive"
                                                                : "text-[10px] text-muted-foreground"
                                                        }
                                                    >
                                                        Stock: {prod.stock}
                                                    </span>
                                                </div>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            )}

                            {!ticketId &&
                                peopleHits.length === 0 &&
                                productMatches.length === 0 &&
                                !peopleLoading &&
                                productsLoaded && (
                                    <CommandEmpty>
                                        No matches for &ldquo;{query}&rdquo;.
                                    </CommandEmpty>
                                )}
                        </>
                    )}
                </CommandList>
            </Command>
            {!productsLoaded && (
                <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                    Loading product catalogue…
                </div>
            )}
        </section>
    );
}

// ── Empty hint ─────────────────────────────────────────────────────────────

function EmptyHint() {
    const examples = [
        { icon: Wrench, label: "TKT-1042", desc: "open a ticket by id" },
        { icon: User, label: "9876543210", desc: "find a customer by phone" },
        { icon: Package, label: "asus laptop", desc: "check price + stock" },
    ];
    return (
        <div className="px-4 py-6">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Sparkles size={12} />
                Try one of these
            </div>
            <ul className="space-y-2">
                {examples.map((ex) => {
                    const Icon = ex.icon;
                    return (
                        <li
                            key={ex.label}
                            className="flex items-center gap-3 text-sm"
                        >
                            <Icon
                                size={14}
                                className="shrink-0 text-muted-foreground"
                            />
                            <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                                {ex.label}
                            </code>
                            <span className="text-xs text-muted-foreground">
                                {ex.desc}
                            </span>
                        </li>
                    );
                })}
            </ul>
            <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
                Tip — keyboard <kbd className="rounded border border-border bg-muted px-1 font-mono">↑</kbd>{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono">↓</kbd>{" "}
                to navigate,{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono">↵</kbd>{" "}
                to open.
            </div>
        </div>
    );
}

