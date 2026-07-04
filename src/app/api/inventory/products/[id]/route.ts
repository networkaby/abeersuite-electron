import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requirePermission, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { invProductUpdateSchema, TAX_CLASSIFICATION_FIELDS } from "@/shared/lib/schemas/inventorySchemas";
import { normalizeProductCodes } from "@/shared/lib/inventory";
import { findSkuCodeCollision, skuCodeCollisionMessage } from "@/shared/lib/inventory/codeCollision";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    productOpeningValue, syncProductCacheFromOpening,
} from "@/modules/inventory/lib/stockValue";
import { loadLastInwardCostMap } from "@/modules/inventory/lib/valuation";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import * as Sentry from "@sentry/nextjs";

const productInclude = {
    unit: { select: { id: true, code: true, label: true } },
    category: { select: { id: true, name: true } },
    group: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    warrantyTerm: { select: { id: true, name: true } },
    gstRate: { select: { id: true, rate: true, label: true } },
    codes: { select: { id: true, kind: true, value: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
} as const;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const row = await prisma.invProduct.findUnique({
            where: { id },
            include: productInclude,
        });
        if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const lastInward = await loadLastInwardCostMap([{ id: row.id, stock: row.stock }]);
        return NextResponse.json({
            ...row,
            lastPurchasePaise: lastInward.get(row.id) ?? null,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch product");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    // A body touching ONLY GST fields (the Tax Classification page's inline
    // edits) is allowed by the narrower compliance:tax:edit; anything that also
    // touches other product fields needs the full inventory:manage.
    let peekedBody: Record<string, unknown> = {};
    try { peekedBody = await req.clone().json(); } catch { /* invalid JSON — validateRequest reports it below */ }
    const bodyKeys = Object.keys(peekedBody);
    const taxFieldSet: readonly string[] = TAX_CLASSIFICATION_FIELDS;
    const isTaxOnly = bodyKeys.length > 0 && bodyKeys.every((k) => taxFieldSet.includes(k));

    const { response } = isTaxOnly
        ? await requireAnyPermission(PERMISSIONS.COMPLIANCE_TAX_EDIT, PERMISSIONS.INVENTORY_MANAGE)
        : await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error: idError } = await parseIdParam(params);
        if (idError) return idError;
        const { data, error } = await validateRequest(req, invProductUpdateSchema);
        if (error) return error;
        const b = data;
        const current = await prisma.invProduct.findUnique({ where: { id } });
        if (!current) return NextResponse.json({ error: "Product not found" }, { status: 404 });

        const unitId = b.unitId ?? current.unitId;
        const categoryId = b.categoryId !== undefined ? b.categoryId : current.categoryId;
        const groupId = b.groupId !== undefined ? b.groupId : current.groupId;
        const brandId = b.brandId !== undefined ? b.brandId : current.brandId;
        const warrantyTermId = b.warrantyTermId !== undefined ? b.warrantyTermId : current.warrantyTermId;

        const u = await prisma.invUnit.findUnique({ where: { id: unitId } });
        if (!u) return NextResponse.json({ error: "Unit not found" }, { status: 400 });
        if (categoryId != null) {
            const c = await prisma.invCategory.findUnique({ where: { id: categoryId } });
            if (!c) return NextResponse.json({ error: "Category not found" }, { status: 400 });
        }
        if (groupId != null) {
            const g = await prisma.invProductGroup.findUnique({ where: { id: groupId } });
            if (!g) return NextResponse.json({ error: "Product group not found" }, { status: 400 });
        }
        if (brandId != null) {
            const br = await prisma.invBrand.findUnique({ where: { id: brandId } });
            if (!br) return NextResponse.json({ error: "Brand not found" }, { status: 400 });
        }
        if (warrantyTermId != null) {
            const w = await prisma.invWarrantyTerm.findUnique({ where: { id: warrantyTermId } });
            if (!w) return NextResponse.json({ error: "Warranty term not found" }, { status: 400 });
        }
        if (b.gstRateId != null) {
            const gr = await prisma.gstRate.findUnique({ where: { id: b.gstRateId } });
            if (!gr) return NextResponse.json({ error: "GST rate not found" }, { status: 400 });
        }

        let sku = current.sku;
        if (b.sku !== undefined) {
            sku = b.sku.trim().toUpperCase();
            if (sku !== current.sku) {
                const clash = await prisma.invProduct.findFirst({ where: { sku, NOT: { id } } });
                if (clash) return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
            }
        }

        // Keep the scannable space (SKUs ∪ code values) disjoint. Check the new
        // SKU (only when it's changing) and any replacement code set, ignoring
        // this product's own rows.
        const collision = await findSkuCodeCollision({
            sku: b.sku !== undefined && sku !== current.sku ? sku : null,
            codeValues: b.codes !== undefined ? b.codes.map((c) => c.value) : [],
            excludeProductId: id,
        });
        if (collision) return NextResponse.json({ error: skuCodeCollisionMessage(collision) }, { status: 409 });

        const row = await prisma.invProduct.update({
            where: { id },
            data: {
                ...(b.sku !== undefined ? { sku } : {}),
                ...(b.name !== undefined ? { name: b.name } : {}),
                ...(b.namePart !== undefined ? { namePart: b.namePart } : {}),
                ...(b.unitId !== undefined ? { unitId: b.unitId } : {}),
                ...(b.categoryId !== undefined ? { categoryId: b.categoryId } : {}),
                ...(b.groupId !== undefined ? { groupId: b.groupId } : {}),
                ...(b.brandId !== undefined ? { brandId: b.brandId } : {}),
                ...(b.warrantyTermId !== undefined ? { warrantyTermId: b.warrantyTermId } : {}),
                ...(b.modelNo !== undefined ? { modelNo: b.modelNo } : {}),
                // Codes are a full replace-set: wipe existing rows, recreate from
                // the payload. Undefined = leave codes untouched.
                ...(b.codes !== undefined
                    ? { codes: { deleteMany: {}, create: normalizeProductCodes(b.codes).map((c, i) => ({ kind: c.kind, value: c.value, sortOrder: i })) } }
                    : {}),
                ...(b.notes !== undefined ? { notes: b.notes } : {}),
                ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
                ...(b.shopSubheading !== undefined ? { shopSubheading: b.shopSubheading } : {}),
                ...(b.slug !== undefined ? { slug: b.slug } : {}),
                ...(b.attrsJson !== undefined ? { attrsJson: b.attrsJson ?? Prisma.DbNull } : {}),
                ...(b.effectiveSalePricePaise !== undefined ? { effectiveSalePricePaise: b.effectiveSalePricePaise } : {}),
                ...(b.savedSalePricePaise !== undefined ? { savedSalePricePaise: b.savedSalePricePaise } : {}),
                ...(b.mrpPaise   !== undefined ? { mrpPaise:   b.mrpPaise   } : {}),
                // Opening fields are written together so openingValue stays consistent.
                ...((b.openingStock !== undefined || b.openingRate !== undefined) ? {
                    openingStock: b.openingStock ?? null,
                    openingRate:  b.openingRate  ?? null,
                    openingValue: productOpeningValue(b),
                    // Sync running caches via shared helper. Explicit
                    // costPaise (Pricing tab) wins over opening-derived cost.
                    ...syncProductCacheFromOpening(b),
                } : {}),
                ...(b.openingStockDate !== undefined ? {
                    openingStockDate: b.openingStockDate ? new Date(b.openingStockDate) : null,
                } : {}),
                // GST classification — null clears the override and re-enables cascade.
                ...(b.gstRateId  !== undefined ? { gstRateId:  b.gstRateId  } : {}),
                ...(b.hsnCode    !== undefined ? { hsnCode:    b.hsnCode    } : {}),
                ...(b.taxability !== undefined ? { taxability: b.taxability } : {}),
            },
            include: productInclude,
        });
        // Re-materialize effectiveSalePricePaise (saved price / cost / GST may have
        // changed) so POS reflects the edit. Skip when the caller set an explicit
        // effectiveSalePricePaise here — that's a deliberate exact price, don't clobber.
        if (b.effectiveSalePricePaise === undefined) {
            await recomputePricesForProducts([id]).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "price-recompute", productId: String(id) } });
                console.error("[price-recompute] failed for product", id, err);
            });
        }
        return NextResponse.json(row);
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return NextResponse.json({ error: "A product code (barcode / EAN / UPC) is already in use." }, { status: 409 });
        }
        return handleApiError(e, "Failed to update product");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const orderLineCount = await prisma.shopOrderLine.count({ where: { productId: id } });
        if (orderLineCount > 0) return NextResponse.json({ error: "Cannot delete — referenced in shop orders." }, { status: 400 });
        await prisma.invProduct.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete product");
    }
}
