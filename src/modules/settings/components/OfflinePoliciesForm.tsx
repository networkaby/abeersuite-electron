"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { useCounterMode } from "@/shared/hooks/useCounterMode";
import {
    DEFAULT_OFFLINE_POLICIES,
    type OfflinePolicies,
} from "@/shared/lib/accountancy/offlineVoucherSafety";
import {
    ShieldCheck,
    AlertTriangle,
    RefreshCw,
    ShoppingCart,
    Receipt,
    Wrench,
    Save,
    Search,
    TrendingUp,
    Warehouse,
    FileText,
    CheckCircle2,
    Database,
} from "lucide-react";

interface PolicyItemDef {
    key: keyof OfflinePolicies;
    label: string;
    description: string;
    safe: boolean;
    category: "pos" | "financial" | "trading" | "inventory" | "optional" | "workflow" | "masters";
}

const POLICY_ITEMS: PolicyItemDef[] = [
    // 1. POS Operations
    { key: "allowPosSale", label: "POS Retail Sales (Bills)", description: "Barcode scan, multi-tender collection (Cash/UPI), local inventory deduction, and thermal print.", safe: true, category: "pos" },
    { key: "allowPosEstimate", label: "POS Estimates & Quotations", description: "Counter price quotations with MRP/tag prices, zero GL or stock impact.", safe: true, category: "pos" },
    { key: "allowPosOrder", label: "POS Advance Bookings", description: "Counter booking orders for scheduled pickup or delivery.", safe: true, category: "pos" },
    { key: "allowPosReturn", label: "POS Sale Returns", description: "Counter merchandise returns with instant till refund or credit balance.", safe: true, category: "pos" },
    { key: "allowPosShift", label: "POS Till Shifts & Cash Counts", description: "Till opening float, midday cash drops, handovers, and drawer reconciliation.", safe: true, category: "pos" },

    // 2. Financial Vouchers (GL)
    { key: "allowReceipt", label: "Receipt Voucher (RECEIPT)", description: "Inward money collected from customers into counter cash or bank QR.", safe: true, category: "financial" },
    { key: "allowPayment", label: "Payment Voucher (PAYMENT)", description: "Vendor & expense cash payments. Caution: carries double-spending risk if multiple counters spend offline.", safe: false, category: "financial" },
    { key: "allowContra", label: "Contra Fund Transfers (CONTRA)", description: "Transfers between internal bank and cash accounts while offline.", safe: false, category: "financial" },
    { key: "allowJournal", label: "Journal Voucher (JOURNAL)", description: "General double-entry accounting adjustments between ledger accounts.", safe: false, category: "financial" },
    { key: "allowCreditNote", label: "Financial Credit Note", description: "Customer credit adjustments / discounts without inventory movement.", safe: false, category: "financial" },
    { key: "allowDebitNote", label: "Financial Debit Note", description: "Supplier debit claims and adjustments without inventory movement.", safe: false, category: "financial" },

    // 3. Trading Vouchers
    { key: "allowSale", label: "B2B Sales Invoice (SALE)", description: "Office sale invoice with stock deduction and customer receivable posting.", safe: true, category: "trading" },
    { key: "allowPurchase", label: "Purchase Bill (PURCHASE)", description: "Vendor invoice booking. Caution: offline entries cannot verify supplier GST credentials.", safe: false, category: "trading" },
    { key: "allowSaleReturn", label: "Sale Return (Credit Note + Stock IN)", description: "Customer returning merchandise back to stock with debt reversal.", safe: true, category: "trading" },
    { key: "allowPurchaseReturn", label: "Purchase Return (Debit Note + Stock OUT)", description: "Returning defective or excess stock back to vendor.", safe: false, category: "trading" },

    // 4. Inventory Operations
    { key: "allowChallan", label: "Delivery Challan (CHALLAN)", description: "Goods delivery slip for demonstration, job-work, or approval.", safe: true, category: "inventory" },
    { key: "allowRejectionIn", label: "Rejection In (Customer Return)", description: "Inward goods returned by customer prior to invoicing.", safe: true, category: "inventory" },
    { key: "allowGrn", label: "Goods Receipt Note (GRN)", description: "Inward shipment receipt from vendor before bill booking.", safe: false, category: "inventory" },
    { key: "allowPhysicalStock", label: "Physical Stock Audit Reconciliation", description: "Stock count adjustments. Caution: can cause inventory drift across branches.", safe: false, category: "inventory" },
    { key: "allowBranchTransfer", label: "Branch Transfer (Stock Movement)", description: "Moving stock from one branch/warehouse to another.", safe: false, category: "inventory" },
    { key: "allowManufacturingJournal", label: "Manufacturing Assembly Journal", description: "Consuming raw parts and producing assembled products.", safe: false, category: "inventory" },
    { key: "allowRejectionOut", label: "Rejection Out (Vendor Return)", description: "Rejecting and sending back defective vendor items.", safe: false, category: "inventory" },

    // 5. Optional Documents
    { key: "allowEstimate", label: "Quotations & Estimates (ESTIMATE)", description: "Customer price quotes with zero ledger and zero stock impact.", safe: true, category: "optional" },
    { key: "allowSalesOrder", label: "Sales Order (SALES_ORDER)", description: "Confirmed customer purchase orders prior to dispatch.", safe: true, category: "optional" },
    { key: "allowPurchaseOrder", label: "Purchase Order (PURCHASE_ORDER)", description: "Procurement purchase order issued to suppliers.", safe: false, category: "optional" },

    // 6. Workflow, Tickets & CRM
    { key: "allowRepairTicket", label: "Service & Repair Ticket Intake", description: "Device intake, diagnostics, technician assignment, and repair status.", safe: true, category: "workflow" },
    { key: "allowHelpTicket", label: "Help Desk Front-Desk Enquiries", description: "Walk-in customer queries, support requests, and enquiry tickets.", safe: true, category: "workflow" },
    { key: "allowCrmDeal", label: "CRM Deals & Sales Leads", description: "Capturing sales pipeline opportunities, deal values, and stages.", safe: true, category: "workflow" },
    { key: "allowTask", label: "Internal Staff Tasks", description: "Staff task assignments, todo checklists, and deadlines.", safe: true, category: "workflow" },
    { key: "allowTimelineLog", label: "CRM Timeline Notes & Call Logs", description: "Technician work notes, customer visit logs, and call records.", safe: true, category: "workflow" },

    // 7. Master Data — Products, Accounts, Taxonomy & Customers (Create vs Edit Toggles)
    { key: "allowProductCreate", label: "Products — Create New Items & Barcodes", description: "Allow adding new inventory products, barcodes, and SKUs while offline.", safe: true, category: "masters" },
    { key: "allowProductEdit", label: "Products — Edit Existing Details & Prices", description: "Allow updating selling prices, product names, and tax rates while offline.", safe: true, category: "masters" },
    { key: "allowAccountCreate", label: "Ledgers — Create New Accounts", description: "Allow adding new customer or expense ledger accounts while offline.", safe: true, category: "masters" },
    { key: "allowAccountEdit", label: "Ledgers — Edit Account Details & Groups", description: "Allow modifying ledger account names, contact links, and groups offline.", safe: true, category: "masters" },
    { key: "allowMasterTaxonomyCreate", label: "Taxonomy — Create Brands, Categories & Units", description: "Allow adding new brands, product categories, measurement units, and racks offline.", safe: true, category: "masters" },
    { key: "allowMasterTaxonomyEdit", label: "Taxonomy — Edit Brands, Categories & Units", description: "Allow editing existing brand names, categories, and unit definitions offline.", safe: true, category: "masters" },
    { key: "allowCustomerCreate", label: "Contacts — Create New Walk-in Customers", description: "Allow registering new customer persons and companies during walk-ins.", safe: true, category: "masters" },
    { key: "allowCustomerEdit", label: "Contacts — Edit Existing Customer Profiles", description: "Allow editing customer addresses, GSTIN numbers, and phone numbers offline.", safe: true, category: "masters" },
];

type PolicyResponse = { policies: OfflinePolicies };

export function OfflinePoliciesForm() {
    // `saved` is what the server holds; `policies` is the draft on screen. Keeping
    // both is what makes "Save Changes" meaningful — the toggles used to write
    // straight to localStorage, where nothing on the server ever read them.
    const [saved, setSaved] = useState<OfflinePolicies>(DEFAULT_OFFLINE_POLICIES);
    const [policies, setPolicies] = useState<OfflinePolicies>(DEFAULT_OFFLINE_POLICIES);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState("");
    const counter = useCounterMode();

    const load = useCallback((silent = false) => {
        axios.get<PolicyResponse>("/api/settings/offline-policies")
            .then((res) => { setSaved(res.data.policies); setPolicies(res.data.policies); })
            .catch((err) => { if (!silent) toast.error(extractApiError(err, "Failed to load offline policies")); })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const updateField = (field: keyof OfflinePolicies, value: boolean) => {
        setPolicies((prev) => ({ ...prev, [field]: value }));
    };

    // Every path that changes policy goes through here, so there is exactly one place
    // that talks to the server and exactly one place that can fail.
    const persist = async (next: OfflinePolicies, message: string) => {
        setSaving(true);
        try {
            const { data } = await axios.patch<PolicyResponse>("/api/settings/offline-policies", next);
            setSaved(data.policies);
            setPolicies(data.policies);
            toast.success(message);
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save offline policies"));
        } finally {
            setSaving(false);
        }
    };

    const handleSave = () => persist(policies, "Offline policies saved — every counter picks them up within a minute.");

    // Pattern C — both of these buttons used to write to the server the instant
    // they were pressed. They are not local edits waiting for Save: they PATCH the
    // shop-wide offline policy that every counter picks up within the minute, so
    // one stray click changed what every till is allowed to do while offline, with
    // no confirmation and no undo.
    const handleReset = async () => {
        const ok = await confirmAction({
            title: "Reset offline policies to the recommended defaults?",
            body: "This replaces the current policy for every counter in the shop, not just this PC, and takes effect within a minute. The settings you have now cannot be brought back automatically.",
            confirmLabel: "Reset to defaults",
        });
        if (!ok) return;
        setPolicies(DEFAULT_OFFLINE_POLICIES);
        void persist(DEFAULT_OFFLINE_POLICIES, "Reset to recommended default policies");
    };

    const handleEnableAllSafe = async () => {
        const next = { ...policies };
        let turnedOn = 0;
        for (const item of POLICY_ITEMS) {
            if (item.safe && !next[item.key]) turnedOn += 1;
            if (item.safe) next[item.key] = true;
        }
        const ok = await confirmAction({
            title: turnedOn === 1 ? "Enable 1 more offline operation?" : `Enable ${turnedOn} more offline operations?`,
            body: "This applies to every counter in the shop and takes effect within a minute.",
            confirmLabel: "Enable them",
            destructive: false,
        });
        if (!ok) return;
        setPolicies(next);
        void persist(next, "All safe offline operations enabled");
    };

    const dirty = JSON.stringify(policies) !== JSON.stringify(saved);

    // What a till may do while offline is decided centrally; a counter left on
    // this screen should show the policy that is actually in force. Held back
    // while unsaved toggles are pending.
    useRealtimeTopics(["settings"], () => { load(true); }, !dirty && !saving);

    const filteredItems = useMemo(() => {
        if (!search.trim()) return POLICY_ITEMS;
        const q = search.toLowerCase();
        return POLICY_ITEMS.filter(
            (it) => it.label.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)
        );
    }, [search]);

    const posItems = filteredItems.filter((i) => i.category === "pos");
    const financialItems = filteredItems.filter((i) => i.category === "financial");
    const tradingItems = filteredItems.filter((i) => i.category === "trading");
    const inventoryItems = filteredItems.filter((i) => i.category === "inventory");
    const optionalItems = filteredItems.filter((i) => i.category === "optional");
    const workflowItems = filteredItems.filter((i) => i.category === "workflow");
    const masterItems = filteredItems.filter((i) => i.category === "masters");

    const renderItemRow = (item: PolicyItemDef) => (
        <div key={item.key} className={`flex items-center justify-between p-3 rounded-lg border ${item.safe ? "bg-muted/20" : "bg-amber-500/5 border-amber-500/30"}`}>
            <div className="space-y-0.5 pr-4">
                <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">{item.label}</Label>
                    {item.safe ? (
                        <Badge variant="secondary" className="text-[11px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Safe (Inward/Local)
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="text-[11px] border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10">
                            <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                            Double-Spend / Desync Risk
                        </Badge>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
            <Switch
                checked={policies[item.key]}
                disabled={loading || saving}
                onCheckedChange={(v) => updateField(item.key, v)}
            />
        </div>
    );

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Top Toolbar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="relative w-full sm:w-80">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search vouchers, products, accounts..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-9"
                    />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <Button variant="outline" size="sm" onClick={handleEnableAllSafe} disabled={loading || saving}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                        Enable All Safe
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleReset} disabled={loading || saving}>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        Defaults
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={loading || saving || !dirty} className="bg-primary text-primary-foreground">
                        <Save className="w-3.5 h-3.5 mr-1.5" />
                        {saving ? "Saving…" : dirty ? "Save Changes" : "Saved"}
                    </Button>
                </div>
            </div>

            {/* Status Summary Banner */}
            <div className="flex items-center justify-between p-3.5 rounded-lg border bg-card text-card-foreground">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                        <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Offline Safety Protocol</div>
                        <div className="text-sm font-medium">All enabled masters and vouchers commit locally and automatically push to Supabase upon reconnection.</div>
                        <div className="text-xs text-muted-foreground">One setting for the whole shop, stored in the database — not per browser. It applies only to counters that write live and lose the internet; a counter that writes locally works like the web app, gated by roles alone.</div>
                        {counter?.isCounter && counter.writePreference === "local" && (
                            <div className="text-xs font-medium text-amber-600">This counter writes locally, so these policies do not restrict it.</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Category 1: Point of Sale (POS) */}
            {posItems.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <ShoppingCart className="w-4 h-4 text-primary" />
                            <CardTitle className="text-base">1. Point of Sale (POS) Counter Billing</CardTitle>
                        </div>
                        <CardDescription>
                            Fast counter retail sales, barcode billing, shifts, and cash drawer management.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {posItems.map(renderItemRow)}
                    </CardContent>
                </Card>
            )}

            {/* Category 2: Financial Vouchers (GL) */}
            {financialItems.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <Receipt className="w-4 h-4 text-primary" />
                            <CardTitle className="text-base">2. Financial Vouchers (General Ledger Only)</CardTitle>
                        </div>
                        <CardDescription>
                            Cash/bank receipts, payments, contra transfers, and ledger adjustment entries.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {financialItems.map(renderItemRow)}
                    </CardContent>
                </Card>
            )}

            {/* Category 3: Trading Vouchers */}
            {tradingItems.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-primary" />
                            <CardTitle className="text-base">3. Trading Vouchers (GL + Stock Movements)</CardTitle>
                        </div>
                        <CardDescription>
                            Sales invoices, purchase bills, and merchandise sales/purchase returns.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {tradingItems.map(renderItemRow)}
                    </CardContent>
                </Card>
            )}

            {/* Category 4: Inventory Operations */}
            {inventoryItems.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <Warehouse className="w-4 h-4 text-primary" />
                            <CardTitle className="text-base">4. Inventory Operations (Stock Movement Only)</CardTitle>
                        </div>
                        <CardDescription>
                            Delivery challans, physical stock audits, branch transfers, and assembly journals.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {inventoryItems.map(renderItemRow)}
                    </CardContent>
                </Card>
            )}

            {/* Category 5: Optional Documents */}
            {optionalItems.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary" />
                            <CardTitle className="text-base">5. Quotations & Orders (Non-Binding Documents)</CardTitle>
                        </div>
                        <CardDescription>
                            Pre-sale quotations, customer sales orders, and supplier procurement orders.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {optionalItems.map(renderItemRow)}
                    </CardContent>
                </Card>
            )}

            {/* Category 6: Workflow & Service Tickets */}
            {workflowItems.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <Wrench className="w-4 h-4 text-primary" />
                            <CardTitle className="text-base">6. Workflow, Service Tickets & CRM</CardTitle>
                        </div>
                        <CardDescription>
                            Repair device intake, front-desk enquiries, CRM leads, and staff notes.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {workflowItems.map(renderItemRow)}
                    </CardContent>
                </Card>
            )}

            {/* Category 7: Master Data & Catalog (Products, Accounts, Taxonomy & Contacts) */}
            {masterItems.length > 0 && (
                <Card className="border-primary/20 bg-primary/[0.02]">
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-primary" />
                            <CardTitle className="text-base">7. Master Data, Products & Accounts (Create vs Edit Toggles)</CardTitle>
                        </div>
                        <CardDescription>
                            Granular control over adding new products, accounts, taxonomy, and modifying existing master records while offline.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {masterItems.map(renderItemRow)}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
