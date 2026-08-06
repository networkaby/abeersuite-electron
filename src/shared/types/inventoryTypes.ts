/**
 * InvProduct augmented with ecommerce fields added in migration 20260504130000.
 * After running `prisma generate`, remove this file and import InvProduct directly.
 */
import type { InvProduct, PrismaClient } from "@/generated/prisma/client";

export type InvProductFull = InvProduct & {
    slug: string | null;
    shopSubheading: string | null;
    shopDescription: string | null;
    shopCategory: string | null;
    mrpPaise: number | null;
    shopBadge: string | null;
    imageUrl: string | null;
    galleryJson: unknown;
    specsJson: unknown;
    stock: number | null;
    lowStockThreshold: number;
    isListedInShop: boolean;
};

type InvProductWithCategory = InvProductFull & { category?: { name: string } | null };

/** Typed wrapper for invProduct Prisma operations that include the new ecommerce fields.
 *  Safe to use after migration 20260504130000. Remove the cast after `prisma generate`. */
export function invProductDb(prisma: PrismaClient) {
    return prisma.invProduct as unknown as {
        findMany: (args: {
            where?: Record<string, unknown>;
            include?: Record<string, unknown>;
            orderBy?: unknown;
            take?: number;
            skip?: number;
        }) => Promise<InvProductWithCategory[]>;

        findFirst: (args: {
            where?: Record<string, unknown>;
            include?: Record<string, unknown>;
        }) => Promise<InvProductWithCategory | null>;

        findUnique: (args: {
            where: Record<string, unknown>;
            include?: Record<string, unknown>;
        }) => Promise<InvProductWithCategory | null>;

        create: (args: {
            data: Record<string, unknown>;
            include?: Record<string, unknown>;
        }) => Promise<InvProductWithCategory>;

        update: (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
            include?: Record<string, unknown>;
        }) => Promise<InvProductWithCategory>;

        updateMany: (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
        }) => Promise<{ count: number }>;

        count: (args: { where: Record<string, unknown> }) => Promise<number>;

        delete: (args: { where: Record<string, unknown> }) => Promise<InvProductFull>;

        groupBy: (args: Record<string, unknown>) => Promise<
            Array<{ shopCategory: string | null; _count: { id: number } }>
        >;
    };
}
