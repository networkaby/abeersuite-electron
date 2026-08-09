// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERSONAL SNAPSHOT — reverse-create YOUR real config from the live DB, and
// overlay it back on top of the generic bootstrap.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// The generic `bootstrap-seed.ts` is the NEW-CLIENT installer — it stays
// generic and keeps evolving with the schema. It never carries your real
// values. This module is the other half: it snapshots the configured state of
// YOUR install (settings, masters, chart of accounts, org structure, RBAC,
// workflow, POS setup) to a committed JSON — scrubbed of password hashes — and
// restores it afterwards.
//
// SCOPE — "everything except tickets, vouchers, customers, products".
//   INCLUDED : config singletons, inventory/tax masters, chart of accounts
//              (GL ledgers only), spend-tier ladders, branches, departments,
//              roles + grants, positions, staff users, POS counters/rails/
//              services/gateways, the whole repair pipeline (statuses/workers/
//              works), print templates, pricing points.
//   EXCLUDED : Ticket* / UniversalVoucher* / journal / invoice / payment /
//              stock-ledger (transactions); Person / Company / Phone / Email /
//              party ledgers (customers); InvProduct* (products); and anything
//              that entangles those — Coupon / GiftCard / LoyaltyEarnRule /
//              LoyaltyMilestone rows (only the CouponConfig / LoyaltyConfig
//              SINGLETONS are kept).
//
// ID PORTABILITY — the RBAC + org + pipeline layers use human-assigned STRING
// ids (R1, DEP-ADMIN, ...), which survive a reseed unchanged, so their rows +
// join tables port by id. The Int-autoincrement models (accounts, gst, units,
// categories, counters, gateways) are referenced across the snapshot by their
// NATURAL KEY (account code/name, gst label, ...); those refs are re-resolved
// to local ids on import, so nothing breaks even on a fresh database.
//
// SAFETY — import is UPSERT-ONLY. It never deletes. It layers on top of a
// fresh generic bootstrap, overriding baseline values and adding your custom
// rows. Re-runnable.
//
// ⚠️ MAINTENANCE — when you add a config table to the schema, add it here too
// (export + import) so the personal snapshot stays complete. See docs/seeds.md.

// This seed transformer reshapes arbitrary Prisma rows by string key (see the
// `Row`/`Ref` note below) and destructures fields purely to drop them. Loose
// `any` and rest-to-omit unused bindings are intentional here, not oversights.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import type { PrismaClient } from "../../../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import { aliasRows } from "../../../src/modules/accountancy/lib/accountAlias";

export const SNAPSHOT_VERSION = 1;

// Staff password hashes are NEVER exported (would leak into git). A user
// CREATED by an overlay gets this default; existing users keep their password
// untouched. Change it after seeding — the snapshot never carries real ones.
export const DEFAULT_SEED_PASSWORD = "changeme123";

// Loosely-typed rows — seeds don't need the generated per-model input types.
type Row = Record<string, any>;
type Db = PrismaClient;

export interface PersonalSnapshot {
    _meta: { version: number; exportedAt: string; note: string };
    singletons: Record<string, Row | null>;
    gstRates: Row[];
    invUnits: Row[];
    invBrands: Row[];
    invWarrantyTerms: Row[];
    invCategories: Row[];
    invProductGroups: Row[];
    invAttributeMasters: Row[];
    strategyPoints: Row[];
    voucherPrintTemplates: Row[];
    accountGroups: Row[];
    accounts: Row[];
    tierPeriods: Row[];
    branches: Row[];
    departments: Row[];
    roles: Row[];
    rolePermissions: Row[];
    departmentPermissions: Row[];
    positions: Row[];
    positionRoles: Row[];
    users: Row[];
    userPositions: Row[];
    userPermissions: Row[];
    paymentGateways: Row[];
    deliveryMethods: Row[];
    /** Customer Quality marketing-group master (Settings → Customer Groups). */
    customerGroups: Row[];
    posCounters: Row[];
    posPaymentAccounts: Row[];
    posServices: Row[];
    pipelines: Row[];
    workGroups: Row[];
    works: Row[];
    workGroupWorks: Row[];
    ticketStatuses: Row[];
    ticketWorkers: Row[];
    statusTransitions: Row[];
    workerTransitions: Row[];
}

// ─────────────────────────────────────────────────────────────────────────
// Natural-key reference index — maps Int ids ↔ portable natural keys so a
// snapshot taken on one DB re-resolves cleanly on another.
// ─────────────────────────────────────────────────────────────────────────

type Ref = Record<string, any> | null;

interface RefIndex {
    account: { toRef: (id: number | null) => Ref; toId: (ref: Ref) => number | null };
    accountGroup: { toRef: (id: number | null) => Ref; toId: (ref: Ref) => number | null };
    gstRate: { toRef: (id: number | null) => Ref; toId: (ref: Ref) => number | null };
    invUnit: { toRef: (id: number | null) => Ref; toId: (ref: Ref) => number | null };
    invCategory: { toRef: (id: number | null) => Ref; toId: (ref: Ref) => number | null };
    user: { toRef: (id: number | null) => Ref; toId: (ref: Ref) => number | null };
    posCounter: { toRef: (id: number | null) => Ref; toId: (ref: Ref) => number | null };
    paymentGateway: { toRef: (id: number | null) => Ref; toId: (ref: Ref) => number | null };
}

async function buildRefIndex(prisma: Db): Promise<RefIndex> {
    const [accounts, groups, gsts, units, cats, users, counters, gateways] = await Promise.all([
        prisma.account.findMany({ select: { id: true, code: true, name: true, personId: true, companyId: true } }),
        prisma.accountGroup.findMany({ select: { id: true, name: true } }),
        prisma.gstRate.findMany({ select: { id: true, label: true } }),
        prisma.invUnit.findMany({ select: { id: true, code: true } }),
        prisma.invCategory.findMany({ select: { id: true, slug: true, name: true } }),
        prisma.user.findMany({ select: { id: true, email: true } }),
        prisma.posCounter.findMany({ select: { id: true, branchId: true, name: true } }),
        prisma.paymentGateway.findMany({ select: { id: true, provider: true, displayName: true } }),
    ]);

    const accById = new Map(accounts.map((a) => [a.id, a]));
    const accByCode = new Map(accounts.filter((a) => a.code).map((a) => [a.code as string, a.id]));
    // Only GL ledgers (no party) are addressed by name — party ledgers are excluded.
    const glAccByName = new Map(
        accounts.filter((a) => a.personId == null && a.companyId == null).map((a) => [a.name, a.id]),
    );
    const grpById = new Map(groups.map((g) => [g.id, g.name]));
    const grpByName = new Map(groups.map((g) => [g.name, g.id]));
    const gstById = new Map(gsts.map((g) => [g.id, g.label]));
    const gstByLabel = new Map(gsts.map((g) => [g.label, g.id]));
    const unitById = new Map(units.map((u) => [u.id, u.code]));
    const unitByCode = new Map(units.map((u) => [u.code, u.id]));
    const catById = new Map(cats.map((c) => [c.id, c]));
    const catBySlug = new Map(cats.filter((c) => c.slug).map((c) => [c.slug as string, c.id]));
    const catByName = new Map(cats.map((c) => [c.name, c.id]));
    const userById = new Map(users.map((u) => [u.id, u.email]));
    const userByEmail = new Map(users.map((u) => [u.email, u.id]));
    const ctrById = new Map(counters.map((c) => [c.id, c]));
    const ctrByKey = new Map(counters.map((c) => [`${c.branchId} ${c.name}`, c.id]));
    const gwById = new Map(gateways.map((g) => [g.id, g]));
    const gwByKey = new Map(gateways.map((g) => [`${g.provider} ${g.displayName}`, g.id]));

    return {
        account: {
            toRef: (id) => {
                if (id == null) return null;
                const a = accById.get(id);
                return a ? { code: a.code ?? null, name: a.name } : null;
            },
            toId: (ref) => {
                if (!ref) return null;
                if (ref.code && accByCode.has(ref.code)) return accByCode.get(ref.code)!;
                if (ref.name && glAccByName.has(ref.name)) return glAccByName.get(ref.name)!;
                return null;
            },
        },
        accountGroup: {
            toRef: (id) => (id == null ? null : grpById.has(id) ? { name: grpById.get(id)! } : null),
            toId: (ref) => (ref?.name && grpByName.has(ref.name) ? grpByName.get(ref.name)! : null),
        },
        gstRate: {
            toRef: (id) => (id == null ? null : gstById.has(id) ? { label: gstById.get(id)! } : null),
            toId: (ref) => (ref?.label && gstByLabel.has(ref.label) ? gstByLabel.get(ref.label)! : null),
        },
        invUnit: {
            toRef: (id) => (id == null ? null : unitById.has(id) ? { code: unitById.get(id)! } : null),
            toId: (ref) => (ref?.code && unitByCode.has(ref.code) ? unitByCode.get(ref.code)! : null),
        },
        invCategory: {
            toRef: (id) => {
                if (id == null) return null;
                const c = catById.get(id);
                return c ? { slug: c.slug ?? null, name: c.name } : null;
            },
            toId: (ref) => {
                if (!ref) return null;
                if (ref.slug && catBySlug.has(ref.slug)) return catBySlug.get(ref.slug)!;
                if (ref.name && catByName.has(ref.name)) return catByName.get(ref.name)!;
                return null;
            },
        },
        user: {
            toRef: (id) => (id == null ? null : userById.has(id) ? { email: userById.get(id)! } : null),
            toId: (ref) => (ref?.email && userByEmail.has(ref.email) ? userByEmail.get(ref.email)! : null),
        },
        posCounter: {
            toRef: (id) => {
                if (id == null) return null;
                const c = ctrById.get(id);
                return c ? { branchId: c.branchId, name: c.name } : null;
            },
            toId: (ref) => (ref ? ctrByKey.get(`${ref.branchId} ${ref.name}`) ?? null : null),
        },
        paymentGateway: {
            toRef: (id) => {
                if (id == null) return null;
                const g = gwById.get(id);
                return g ? { provider: g.provider, displayName: g.displayName } : null;
            },
            toId: (ref) => (ref ? gwByKey.get(`${ref.provider} ${ref.displayName}`) ?? null : null),
        },
    };
}

// Drop DB-managed / computed fields we never want to carry across.
function omit(row: Row, keys: string[]): Row {
    const out: Row = { ...row };
    for (const k of keys) delete out[k];
    return out;
}

// Replace an Int-FK field IN PLACE with its portable natural-key ref (export),
// or back to a local id (import). `map` = { fieldName: refKind }.
type RefKind = keyof RefIndex;
function externalize(row: Row, map: Record<string, RefKind>, idx: RefIndex): Row {
    const out: Row = { ...row };
    for (const [field, kind] of Object.entries(map)) out[field] = idx[kind].toRef(out[field] ?? null);
    return out;
}
function internalize(row: Row, map: Record<string, RefKind>, idx: RefIndex): Row {
    const out: Row = { ...row };
    for (const [field, kind] of Object.entries(map)) out[field] = idx[kind].toId(out[field] ?? null);
    return out;
}

// ═════════════════════════════════════════════════════════════════════════
// EXPORT — read the live DB into a portable snapshot. Read-only.
// ═════════════════════════════════════════════════════════════════════════

export async function exportPersonal(prisma: Db): Promise<PersonalSnapshot> {
    const idx = await buildRefIndex(prisma);

    // ── Config singletons (id=1) ──
    const [orgDefaults, invNamingConfig, loyaltyConfig, couponConfig, creditLimitConfig, booksConfig] =
        await Promise.all([
            prisma.orgDefaults.findFirst(),
            prisma.invNamingConfig.findFirst(),
            prisma.loyaltyConfig.findFirst(),
            prisma.couponConfig.findFirst(),
            prisma.creditLimitConfig.findFirst(),
            prisma.booksConfig.findFirst(),
        ]);

    const singletons: Record<string, Row | null> = {
        orgDefaults: orgDefaults
            ? externalize(omit(orgDefaults, ["id", "updatedAt"]), { defaultUnitId: "invUnit", defaultGstRateId: "gstRate", shippingPoolGroupId: "accountGroup" }, idx)
            : null,
        invNamingConfig: invNamingConfig ? omit(invNamingConfig, ["id", "updatedAt"]) : null,
        loyaltyConfig: loyaltyConfig
            ? externalize(omit(loyaltyConfig, ["id"]), { redeemExpenseAccountId: "account" }, idx)
            : null,
        couponConfig: couponConfig
            ? externalize(omit(couponConfig, ["id"]), { couponExpenseAccountId: "account", giftCardLiabilityAccountId: "account", giftCardBreakageAccountId: "account" }, idx)
            : null,
        creditLimitConfig: creditLimitConfig ? omit(creditLimitConfig, ["id", "updatedAt"]) : null,
        booksConfig: booksConfig ? omit(booksConfig, ["updatedAt"]) : null,
    };

    // ── Inventory / tax masters ──
    const gstRates = (await prisma.gstRate.findMany()).map((r) => omit(r, ["id"]));
    // Units are self-referencing (a compound unit like DOZ points at a base
    // unit like NOS). Keep the base as a CODE pointer — Int ids don't survive a
    // reseed into a different DB. Mirrors the invCategories parentName pattern.
    const unitRows = await prisma.invUnit.findMany();
    const unitCodeById = new Map(unitRows.map((u) => [u.id, u.code]));
    const invUnits = unitRows.map((u) => ({
        ...omit(u, ["id", "baseUnitId", "createdAt", "updatedAt"]),
        baseUnitCode: u.baseUnitId != null ? unitCodeById.get(u.baseUnitId) ?? null : null,
    }));
    const invBrands = (await prisma.invBrand.findMany()).map((r) => omit(r, ["id", "createdAt", "updatedAt"]));
    const invWarrantyTerms = (await prisma.invWarrantyTerm.findMany()).map((r) => omit(r, ["id", "createdAt", "updatedAt"]));
    // Self-ref: keep parent as a name pointer (resolved on import); drop the Int id/parentId.
    const catRows = await prisma.invCategory.findMany();
    const catNameById = new Map(catRows.map((c) => [c.id, c.name]));
    const invCategories = catRows.map((c) => ({ ...omit(c, ["id", "parentId", "createdAt", "updatedAt"]), parentName: c.parentId != null ? catNameById.get(c.parentId) ?? null : null }));
    const grpRows = await prisma.invProductGroup.findMany();
    const grpNameById = new Map(grpRows.map((g) => [g.id, g.name]));
    const invProductGroups = grpRows.map((g) => externalize({ ...omit(g, ["id", "parentId", "createdAt", "updatedAt"]), parentName: g.parentId != null ? grpNameById.get(g.parentId) ?? null : null }, { gstRateId: "gstRate" }, idx));
    const invAttributeMasters = (await prisma.invAttributeMaster.findMany()).map((r) => externalize(omit(r, ["id", "createdAt", "updatedAt"]), { categoryId: "invCategory" }, idx));
    const strategyPoints = (await prisma.strategyPoint.findMany()).map((r) => omit(r, ["id", "updatedAt"]));
    const voucherPrintTemplates = (await prisma.voucherPrintTemplate.findMany()).map((r) => omit(r, ["id", "updatedAt", "updatedById"]));

    // ── Chart of accounts (GL ledgers only — no party accounts) ──
    const groupRows = await prisma.accountGroup.findMany();
    const groupNameById = new Map(groupRows.map((g) => [g.id, g.name]));
    const accountGroups = groupRows.map((g) => ({ ...omit(g, ["id", "parentId"]), parentName: g.parentId != null ? groupNameById.get(g.parentId) ?? null : null }));

    const accRows = await prisma.account.findMany({
        where: { personId: null, companyId: null },
        // Aliases travel with their ledger as plain strings — aliasKey is derived
        // on restore, never captured.
        include: { aliases: { select: { alias: true }, orderBy: { id: "asc" } } },
    });
    const accNameById = new Map(accRows.map((a) => [a.id, a.name]));
    const accounts = accRows.map((a) => externalize(
        {
            ...omit(a, ["id", "parentId", "personId", "companyId", "balance", "createdAt", "aliases"]),
            parentName: a.parentId != null ? accNameById.get(a.parentId) ?? null : null,
            aliases: a.aliases.map((x) => x.alias),
        },
        { groupId: "accountGroup" }, idx,
    ));

    // ── Spend-tier ladders (period → nested levels) ──
    const periodRows = await prisma.customerTierPeriod.findMany({ include: { levels: true } });
    const tierPeriods = periodRows.map((p) => ({
        ...omit(p, ["id", "createdAt", "updatedAt", "levels"]),
        levels: p.levels.map((l) => omit(l, ["id", "periodId", "createdAt", "updatedAt"])),
    }));

    // ── Org structure ──
    const branches = (await prisma.branch.findMany()).map((b) => externalize(omit(b, ["createdAt"]), { vaultAccountId: "account" }, idx));
    const departments = (await prisma.department.findMany()).map((d) => omit(d, ["createdAt"]));

    // ── RBAC (roles + grants + positions + staff users) ──
    // Permission rows themselves are code-owned by bootstrap — never snapshotted.
    const roles = (await prisma.role.findMany()).map((r) => ({ ...r }));
    const rolePermissions = (await prisma.rolePermission.findMany()).map((r) => ({ ...r }));
    const departmentPermissions = (await prisma.departmentPermission.findMany()).map((r) => ({ ...r }));
    const positions = (await prisma.position.findMany()).map((p) => omit(p, ["createdAt"]));
    const positionRoles = (await prisma.positionRole.findMany()).map((r) => ({ ...r }));

    const userRows = await prisma.user.findMany();
    const userEmailById = new Map(userRows.map((u) => [u.id, u.email]));
    // `password` is deliberately dropped — hashes never belong in the snapshot.
    const users = userRows.map((u) => ({
        ...omit(u, ["id", "password", "createdAt", "tokensValidFrom", "managerId"]),
        managerEmail: u.managerId != null ? userEmailById.get(u.managerId) ?? null : null,
    }));
    const userPositions = (await prisma.userPosition.findMany()).map((up) => externalize(omit(up, ["createdAt"]), { userId: "user" }, idx));
    const userPermissions = (await prisma.userPermission.findMany()).map((up) => externalize(omit(up, ["id", "createdAt"]), { userId: "user" }, idx));

    // ── Delivery methods (courier options offered at checkout — config only) ──
    const deliveryMethods = (await prisma.deliveryMethod.findMany()).map((m) => omit(m, ["id", "createdAt", "updatedAt"]));

    // ── Customer Quality: marketing-group master (name-keyed, no refs) ──
    const customerGroups = (await prisma.customerGroup.findMany()).map((g) => omit(g, ["id", "createdAt"]));

    // ── POS setup ──
    const paymentGateways = (await prisma.paymentGateway.findMany()).map((g) => omit(g, ["id", "createdAt", "updatedAt"]));
    const posCounters = (await prisma.posCounter.findMany()).map((c) => {
        const base = externalize(omit(c, ["id", "createdAt", "boundDeviceId", "boundDeviceLabel", "boundAt"]), { tillAccountId: "account" }, idx);
        // allowedExpenseAccountIds is a JSON number[] of Account ids → externalize each.
        const allowed = Array.isArray(c.allowedExpenseAccountIds) ? (c.allowedExpenseAccountIds as number[]) : [];
        base.allowedExpenseAccountIds = allowed.map((id) => idx.account.toRef(id)).filter(Boolean);
        return base;
    });
    const posPaymentAccounts = (await prisma.posCounterPaymentAccount.findMany()).map((pa) => externalize(omit(pa, ["id"]), { counterId: "posCounter", accountId: "account", gatewayId: "paymentGateway" }, idx));
    const posServices = (await prisma.posService.findMany()).map((s) => externalize(omit(s, ["id", "createdAt", "updatedAt"]), { accountId: "account", gstRateId: "gstRate" }, idx));

    // ── Repair pipeline / workflow (all string ids — port as-is) ──
    const pipelines = (await prisma.pipeline.findMany()).map((p) => omit(p, ["createdAt"]));
    const workGroups = (await prisma.workGroup.findMany()).map((g) => omit(g, ["createdAt"]));
    const works = (await prisma.work.findMany()).map((w) => ({ ...w }));
    const workGroupWorks = (await prisma.workGroupWork.findMany()).map((r) => ({ workGroupId: r.workGroupId, workId: r.workId }));
    const ticketStatuses = (await prisma.ticketStatus.findMany()).map((s) => ({ ...s }));
    const ticketWorkers = (await prisma.ticketWorker.findMany()).map((w) => ({ ...w }));
    const statusTransitions = (await prisma.statusTransition.findMany()).map((t) => omit(t, ["id"]));
    const workerTransitions = (await prisma.workerTransition.findMany()).map((t) => omit(t, ["id"]));

    return {
        _meta: { version: SNAPSHOT_VERSION, exportedAt: new Date().toISOString(), note: "Personal config snapshot — everything except tickets, vouchers, customers, products." },
        singletons,
        gstRates, invUnits, invBrands, invWarrantyTerms, invCategories, invProductGroups, invAttributeMasters, strategyPoints, voucherPrintTemplates,
        accountGroups, accounts,
        tierPeriods,
        branches, departments,
        roles, rolePermissions, departmentPermissions, positions, positionRoles, users, userPositions, userPermissions,
        paymentGateways, deliveryMethods, customerGroups, posCounters, posPaymentAccounts, posServices,
        pipelines, workGroups, works, workGroupWorks, ticketStatuses, ticketWorkers, statusTransitions, workerTransitions,
    };
}

// ═════════════════════════════════════════════════════════════════════════
// IMPORT — overlay the snapshot on top of a fresh generic bootstrap.
// Upsert-only, FK-safe order. Never deletes.
// ═════════════════════════════════════════════════════════════════════════

// findFirst + create/update by an arbitrary (possibly non-unique) natural where.
// Strips `id` from the update payload; keeps it on create (string-id models).
async function put(delegate: any, where: Row, data: Row): Promise<void> {
    const found = await delegate.findFirst({ where, select: { id: true } });
    if (found) {
        const { id, ...rest } = data;
        await delegate.update({ where: { id: found.id }, data: rest });
    } else {
        await delegate.create({ data });
    }
}

interface ImportStats {
    sections: Record<string, number>;
    skipped: string[];
}

export async function importPersonal(prisma: Db, snap: PersonalSnapshot): Promise<ImportStats> {
    const stats: ImportStats = { sections: {}, skipped: [] };
    const count = (k: string, n: number) => { stats.sections[k] = (stats.sections[k] ?? 0) + n; };

    if (snap._meta?.version !== SNAPSHOT_VERSION) {
        throw new Error(`Snapshot version ${snap._meta?.version} ≠ engine version ${SNAPSHOT_VERSION}. Re-run the capture with the current code.`);
    }

    // ── Phase 1: dependency-free masters ──
    for (const r of snap.gstRates) await put(prisma.gstRate, { label: r.label }, r);
    count("gstRates", snap.gstRates.length);
    // Units (self-ref): pass 1 without the base pointer, pass 2 link by code —
    // a compound unit's base may appear later in the list. Snapshots captured
    // before compound units existed simply carry no baseUnitCode and stay base.
    for (const r of snap.invUnits) {
        const { baseUnitCode: _baseUnitCode, ...data } = r;
        await put(prisma.invUnit, { code: r.code }, data);
    }
    for (const r of snap.invUnits) {
        if (!r.baseUnitCode) continue;
        const [base, self] = await Promise.all([
            prisma.invUnit.findUnique({ where: { code: r.baseUnitCode as string }, select: { id: true } }),
            prisma.invUnit.findUnique({ where: { code: r.code as string }, select: { id: true } }),
        ]);
        if (base && self) await prisma.invUnit.update({ where: { id: self.id }, data: { baseUnitId: base.id } });
    }
    count("invUnits", snap.invUnits.length);
    for (const r of snap.invBrands) await put(prisma.invBrand, { name: r.name }, r);
    count("invBrands", snap.invBrands.length);
    for (const r of snap.invWarrantyTerms) await put(prisma.invWarrantyTerm, { name: r.name }, r);
    count("invWarrantyTerms", snap.invWarrantyTerms.length);
    for (const r of snap.strategyPoints) await put(prisma.strategyPoint, { dimension: r.dimension, refKey: r.refKey }, r);
    count("strategyPoints", snap.strategyPoints.length);

    // Categories (self-ref): pass 1 without parent, pass 2 set parent by name.
    for (const c of snap.invCategories) {
        const { parentName, ...data } = c;
        await put(prisma.invCategory, c.slug ? { slug: c.slug } : { name: c.name }, data);
    }
    for (const c of snap.invCategories) {
        if (!c.parentName) continue;
        const parent = await prisma.invCategory.findFirst({ where: { name: c.parentName }, select: { id: true } });
        const self = await prisma.invCategory.findFirst({ where: c.slug ? { slug: c.slug } : { name: c.name }, select: { id: true } });
        if (parent && self) await prisma.invCategory.update({ where: { id: self.id }, data: { parentId: parent.id } });
    }
    count("invCategories", snap.invCategories.length);

    // Rebuild index now that gst/units/categories exist, for the ref-bearing masters.
    let idx = await buildRefIndex(prisma);

    // Product groups (self-ref + gstRate ref).
    for (const g of snap.invProductGroups) {
        const { parentName, ...rest } = internalize(g, { gstRateId: "gstRate" }, idx);
        await put(prisma.invProductGroup, { name: g.name }, rest);
    }
    for (const g of snap.invProductGroups) {
        if (!g.parentName) continue;
        const parent = await prisma.invProductGroup.findFirst({ where: { name: g.parentName }, select: { id: true } });
        const self = await prisma.invProductGroup.findFirst({ where: { name: g.name }, select: { id: true } });
        if (parent && self) await prisma.invProductGroup.update({ where: { id: self.id }, data: { parentId: parent.id } });
    }
    count("invProductGroups", snap.invProductGroups.length);

    for (const a of snap.invAttributeMasters) {
        const data = internalize(a, { categoryId: "invCategory" }, idx);
        await put(prisma.invAttributeMaster, { key: a.key, categoryId: data.categoryId ?? null }, data);
    }
    count("invAttributeMasters", snap.invAttributeMasters.length);

    // ── Phase 2: chart of accounts ──
    // Account groups (self-ref by name).
    for (const g of snap.accountGroups) {
        const { parentName, ...data } = g;
        await put(prisma.accountGroup, { name: g.name }, data);
    }
    for (const g of snap.accountGroups) {
        if (!g.parentName) continue;
        const parent = await prisma.accountGroup.findFirst({ where: { name: g.parentName }, select: { id: true } });
        const self = await prisma.accountGroup.findFirst({ where: { name: g.name }, select: { id: true } });
        if (parent && self) await prisma.accountGroup.update({ where: { id: self.id }, data: { parentId: parent.id } });
    }
    count("accountGroups", snap.accountGroups.length);

    // Accounts (GL): group ref + self-ref parent by name. Key by code if present, else name.
    idx = await buildRefIndex(prisma); // groups now exist
    const accWhere = (a: Row) => (a.code ? { code: a.code } : { name: a.name, personId: null, companyId: null });
    for (const a of snap.accounts) {
        const { parentName, aliases, ...rest } = internalize(a, { groupId: "accountGroup" }, idx);
        await put(prisma.account, accWhere(a), rest);
        // Aliases are a child table, so they can't ride the upsert payload.
        // Replace the ledger's set — upsert-only semantics still hold, nothing
        // outside this ledger is touched.
        const aliasList = Array.isArray(aliases) ? (aliases as string[]) : [];
        const self = await prisma.account.findFirst({ where: accWhere(a), select: { id: true } });
        if (!self) continue;
        await prisma.accountAlias.deleteMany({ where: { accountId: self.id } });
        for (const row of aliasRows(aliasList)) {
            await prisma.accountAlias.create({ data: { accountId: self.id, ...row } });
        }
    }
    for (const a of snap.accounts) {
        if (!a.parentName) continue;
        const parent = await prisma.account.findFirst({ where: { name: a.parentName, personId: null, companyId: null }, select: { id: true } });
        const self = await prisma.account.findFirst({ where: accWhere(a), select: { id: true } });
        if (parent && self) await prisma.account.update({ where: { id: self.id }, data: { parentId: parent.id } });
    }
    count("accounts", snap.accounts.length);

    // From here on the full ref index (incl. accounts) is needed.
    idx = await buildRefIndex(prisma);

    // ── Phase 3: config singletons ──
    const s = snap.singletons;
    if (s.orgDefaults) await put(prisma.orgDefaults, { id: 1 }, { id: 1, ...internalize(s.orgDefaults, { defaultUnitId: "invUnit", defaultGstRateId: "gstRate", shippingPoolGroupId: "accountGroup" }, idx) });
    if (s.invNamingConfig) await put(prisma.invNamingConfig, { id: 1 }, { id: 1, ...s.invNamingConfig });
    if (s.loyaltyConfig) await put(prisma.loyaltyConfig, { id: 1 }, { id: 1, ...internalize(s.loyaltyConfig, { redeemExpenseAccountId: "account" }, idx) });
    if (s.couponConfig) await put(prisma.couponConfig, { id: 1 }, { id: 1, ...internalize(s.couponConfig, { couponExpenseAccountId: "account", giftCardLiabilityAccountId: "account", giftCardBreakageAccountId: "account" }, idx) });
    if (s.creditLimitConfig) await put(prisma.creditLimitConfig, { id: 1 }, { id: 1, ...s.creditLimitConfig });
    if (s.booksConfig) await put(prisma.booksConfig, { id: s.booksConfig.id ?? 1 }, s.booksConfig);
    count("singletons", Object.values(s).filter(Boolean).length);

    // VoucherPrintTemplate's PK is `kind` (no `id` column), so the generic put()
    // helper (findFirst-by-id) can't be used — upsert on the real key directly.
    for (const t of snap.voucherPrintTemplates) {
        await prisma.voucherPrintTemplate.upsert({
            where: { kind: t.kind },
            update: omit(t, ["kind"]),
            create: t as any,
        });
    }
    count("voucherPrintTemplates", snap.voucherPrintTemplates.length);

    // ── Phase 4: org structure ──
    for (const b of snap.branches) await put(prisma.branch, { id: b.id }, internalize(b, { vaultAccountId: "account" }, idx));
    count("branches", snap.branches.length);
    for (const d of snap.departments) await put(prisma.department, { id: d.id }, d);
    count("departments", snap.departments.length);

    // ── Phase 5: RBAC ──
    const permIds = new Set((await prisma.permission.findMany({ select: { id: true } })).map((p) => p.id));
    for (const r of snap.roles) await put(prisma.role, { id: r.id }, r);
    count("roles", snap.roles.length);
    // Grants are pure link rows → createMany skipDuplicates, filtered to permissions that still exist.
    {
        const rows = snap.rolePermissions.filter((r) => permIds.has(r.permissionId));
        const dropped = snap.rolePermissions.length - rows.length;
        if (dropped) stats.skipped.push(`${dropped} rolePermission grant(s) referenced permissions not present in this build`);
        await prisma.rolePermission.createMany({ data: rows as any, skipDuplicates: true });
        count("rolePermissions", rows.length);
    }
    {
        const rows = snap.departmentPermissions.filter((r) => permIds.has(r.permissionId));
        await prisma.departmentPermission.createMany({ data: rows as any, skipDuplicates: true });
        count("departmentPermissions", rows.length);
    }
    // Positions (self-ref parent by id, all string). Pass 1 without parent, pass 2 set.
    for (const p of snap.positions) await put(prisma.position, { id: p.id }, omit(p, ["parentPositionId"]));
    for (const p of snap.positions) {
        if (!p.parentPositionId) continue;
        await prisma.position.update({ where: { id: p.id }, data: { parentPositionId: p.parentPositionId } }).catch(() => {});
    }
    count("positions", snap.positions.length);
    await prisma.positionRole.createMany({ data: snap.positionRoles as any, skipDuplicates: true });
    count("positionRoles", snap.positionRoles.length);

    // Staff users (by email; manager self-ref by email in pass 2; role is a string FK).
    // Password is NOT in the snapshot: existing users keep theirs; a newly-created
    // user gets DEFAULT_SEED_PASSWORD (to be changed after seeding).
    const seededPasswordFor: string[] = [];
    for (const u of snap.users) {
        const { managerEmail, password, ...data } = u; // password never present, but guard anyway
        const existing = await prisma.user.findFirst({ where: { email: u.email }, select: { id: true } });
        if (existing) {
            await prisma.user.update({ where: { id: existing.id }, data: data as any });
        } else {
            await prisma.user.create({ data: { ...data, password: bcrypt.hashSync(DEFAULT_SEED_PASSWORD, 10) } as any });
            seededPasswordFor.push(u.email);
        }
    }
    if (seededPasswordFor.length) {
        stats.skipped.push(`${seededPasswordFor.length} new user(s) got the default password "${DEFAULT_SEED_PASSWORD}" — change it: ${seededPasswordFor.join(", ")}`);
    }
    idx = await buildRefIndex(prisma); // users now resolvable
    for (const u of snap.users) {
        if (!u.managerEmail) continue;
        const mgrId = idx.user.toId({ email: u.managerEmail });
        if (mgrId) await prisma.user.update({ where: { email: u.email }, data: { managerId: mgrId } }).catch(() => {});
    }
    count("users", snap.users.length);
    {
        const rows = snap.userPositions
            .map((up) => ({ ...up, userId: idx.user.toId(up.userId) }))
            .filter((up) => up.userId != null);
        await prisma.userPosition.createMany({ data: rows as any, skipDuplicates: true });
        count("userPositions", rows.length);
    }
    {
        const rows = snap.userPermissions
            .map((up) => ({ ...up, userId: idx.user.toId(up.userId) }))
            .filter((up: Row) => up.userId != null && permIds.has(up.permissionId));
        await prisma.userPermission.createMany({ data: rows as any, skipDuplicates: true });
        count("userPermissions", rows.length);
    }

    // ── Phase 6: spend-tier ladders ──
    for (const p of snap.tierPeriods) {
        const { levels, ...pdata } = p;
        const existing = await prisma.customerTierPeriod.findFirst({ where: { name: p.name, fromDay: p.fromDay, toDay: p.toDay }, select: { id: true } });
        const periodId = existing
            ? (await prisma.customerTierPeriod.update({ where: { id: existing.id }, data: pdata as any })).id
            : (await prisma.customerTierPeriod.create({ data: pdata as any })).id;
        for (const l of levels as Row[]) {
            const lvl = await prisma.customerTier.findFirst({ where: { periodId, name: l.name }, select: { id: true } });
            if (lvl) await prisma.customerTier.update({ where: { id: lvl.id }, data: l as any });
            else await prisma.customerTier.create({ data: { ...l, periodId } as any });
        }
    }
    count("tierPeriods", snap.tierPeriods.length);

    // ── Phase 7: POS setup ──
    for (const g of snap.paymentGateways) await put(prisma.paymentGateway, { provider: g.provider, displayName: g.displayName }, g);
    count("paymentGateways", snap.paymentGateways.length);

    // Delivery methods (courier options). Keyed by kind+displayName; guard older
    // snapshots taken before this field existed.
    const deliveryMethods = snap.deliveryMethods ?? [];
    for (const m of deliveryMethods) await put(prisma.deliveryMethod, { kind: m.kind, displayName: m.displayName }, m);
    count("deliveryMethods", deliveryMethods.length);

    // Customer Quality marketing groups (guard older snapshots without the field).
    const customerGroups = snap.customerGroups ?? [];
    for (const g of customerGroups) await put(prisma.customerGroup, { name: g.name }, g);
    count("customerGroups", customerGroups.length);
    idx = await buildRefIndex(prisma); // gateways now resolvable
    for (const c of snap.posCounters) {
        const data = internalize(c, { tillAccountId: "account" }, idx);
        data.allowedExpenseAccountIds = (Array.isArray(c.allowedExpenseAccountIds) ? c.allowedExpenseAccountIds : [])
            .map((ref: Ref) => idx.account.toId(ref)).filter((v: number | null) => v != null);
        if (data.tillAccountId == null) { stats.skipped.push(`POS counter "${c.name}" skipped — its till account did not resolve`); continue; }
        await put(prisma.posCounter, { branchId: c.branchId, name: c.name }, data);
    }
    count("posCounters", snap.posCounters.length);
    idx = await buildRefIndex(prisma); // counters now resolvable
    for (const pa of snap.posPaymentAccounts) {
        const data = internalize(pa, { counterId: "posCounter", accountId: "account", gatewayId: "paymentGateway" }, idx);
        if (data.counterId == null || data.accountId == null) { stats.skipped.push(`POS payment rail "${pa.label}" skipped — counter/account did not resolve`); continue; }
        await put(prisma.posCounterPaymentAccount, { counterId: data.counterId, label: pa.label, channel: pa.channel }, data);
    }
    count("posPaymentAccounts", snap.posPaymentAccounts.length);
    for (const svc of snap.posServices) {
        const data = internalize(svc, { accountId: "account", gstRateId: "gstRate" }, idx);
        if (data.accountId == null) { stats.skipped.push(`POS service "${svc.name}" skipped — income account did not resolve`); continue; }
        await put(prisma.posService, { name: svc.name }, data);
    }
    count("posServices", snap.posServices.length);

    // ── Phase 8: repair pipeline / workflow (string ids; cross-linked → staged) ──
    for (const g of snap.workGroups) await put(prisma.workGroup, { id: g.id }, permIds.has(g.permissionId) ? g : { ...g, permissionId: null });
    count("workGroups", snap.workGroups.length);
    for (const w of snap.works) await put(prisma.work, { id: w.id }, permIds.has(w.permissionId) ? w : { ...w, permissionId: null });
    count("works", snap.works.length);
    await prisma.workGroupWork.createMany({ data: snap.workGroupWorks as any, skipDuplicates: true });
    count("workGroupWorks", snap.workGroupWorks.length);
    for (const p of snap.pipelines) await put(prisma.pipeline, { id: p.id }, p);
    count("pipelines", snap.pipelines.length);
    // Statuses first WITHOUT their worker cross-links (workers don't exist yet).
    for (const st of snap.ticketStatuses) await put(prisma.ticketStatus, { id: st.id }, omit(st, ["workId", "startWorkerId"]));
    // Workers WITHOUT their worker↔worker self-links (other workers may not exist yet).
    for (const w of snap.ticketWorkers) await put(prisma.ticketWorker, { id: w.id }, omit(w, ["successWorkerId", "failWorkerId"]));
    // Pass 2: wire the deferred FKs now that both sides exist.
    for (const w of snap.ticketWorkers) {
        await prisma.ticketWorker.update({ where: { id: w.id }, data: { successWorkerId: w.successWorkerId ?? null, failWorkerId: w.failWorkerId ?? null } }).catch(() => {});
    }
    for (const st of snap.ticketStatuses) {
        await prisma.ticketStatus.update({ where: { id: st.id }, data: { workId: st.workId ?? null, startWorkerId: st.startWorkerId ?? null } }).catch(() => {});
    }
    count("ticketStatuses", snap.ticketStatuses.length);
    count("ticketWorkers", snap.ticketWorkers.length);
    await prisma.statusTransition.createMany({ data: snap.statusTransitions as any, skipDuplicates: true });
    count("statusTransitions", snap.statusTransitions.length);
    await prisma.workerTransition.createMany({ data: snap.workerTransitions as any, skipDuplicates: true });
    count("workerTransitions", snap.workerTransitions.length);

    return stats;
}
