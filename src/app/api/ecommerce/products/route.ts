import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { shopProductToAdmin } from "@/modules/ecommerce/lib/product-admin";
import { z } from "zod";

const specsSchema = z.record(z.string(), z.string()).optional();

const createSchema = z.object({
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1).optional().nullable(),
    subheading: z.string().trim().optional().nullable(),
    description: z.string().trim().optional().nullable(),
    category: z.string().trim().min(1).optional(),
    pricePaise: z.coerce.number().int().positive(),
    mrpPaise: z.coerce.number().int().positive().optional().nullable(),
    badge: z.string().trim().optional().nullable(),
    imageUrl: z.string().url().optional().nullable().or(z.literal("")),
    galleryUrls: z.array(z.string().url()).optional(),
    specs: specsSchema,
    stock: z.coerce.number().int().min(0).optional().nullable(),
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
});

export async function GET(req: Request) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const q = searchParams.get("q")?.trim();
        const category = searchParams.get("category")?.trim();
        const products = await prisma.shopProduct.findMany({
            where: {
                ...(q
                    ? {
                          OR: [
                              { name: { contains: q, mode: "insensitive" } },
                              { slug: { contains: q, mode: "insensitive" } },
                          ],
                      }
                    : {}),
                ...(category && category !== "all" ? { category } : {}),
            },
            orderBy: [{ category: "asc" }, { id: "desc" }],
        });
        return NextResponse.json(products.map(shopProductToAdmin));
    } catch {
        return NextResponse.json({ error: "Failed to list products" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const parsed = createSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
                { status: 400 }
            );
        }
        const b = parsed.data;
        const galleryJson =
            b.galleryUrls && b.galleryUrls.length > 0 ? b.galleryUrls : undefined;
        const specsJson = b.specs && Object.keys(b.specs).length > 0 ? b.specs : undefined;

        const p = await prisma.shopProduct.create({
            data: {
                name: b.name,
                slug: b.slug?.trim() || null,
                subheading: b.subheading ?? null,
                description: b.description ?? null,
                category: b.category ?? "Accessories",
                pricePaise: b.pricePaise,
                mrpPaise: b.mrpPaise ?? null,
                badge: b.badge ?? null,
                imageUrl: b.imageUrl && b.imageUrl !== "" ? b.imageUrl : galleryJson?.[0] ?? null,
                galleryJson: galleryJson ?? undefined,
                specsJson: specsJson ?? undefined,
                stock: b.stock === undefined ? null : b.stock,
                lowStockThreshold: b.lowStockThreshold ?? 5,
                isActive: b.isActive ?? true,
            },
        });
        return NextResponse.json(shopProductToAdmin(p), { status: 201 });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
    }
}
