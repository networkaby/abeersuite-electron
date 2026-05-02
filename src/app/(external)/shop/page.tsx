import { prisma } from "@/lib/prisma";
import AddToCartButton from "@/modules/external/shop/AddToCartButton";
import { formatRupeesFromPaise } from "@/lib/money-inr";

export default async function ShopCatalogPage() {
    const products = await prisma.shopProduct.findMany({
        where: { isActive: true },
        orderBy: { id: "asc" },
    });

    return (
        <main className="mx-auto max-w-4xl px-4 py-8 space-y-8">
            <div>
                <h1 className="text-2xl font-semibold">Shop</h1>
                <p className="text-muted-foreground text-sm mt-1">Prices include GST where applicable · pay in ₹</p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
                {products.map((p) => (
                    <li key={p.id} className="rounded-lg border border-border p-4 flex flex-col gap-3">
                        <div className="flex-1">
                            <h2 className="font-medium">{p.name}</h2>
                            {p.description ? (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{p.description}</p>
                            ) : null}
                            <p className="text-lg font-semibold mt-2">{formatRupeesFromPaise(p.pricePaise)}</p>
                        </div>
                        <AddToCartButton productId={p.id} />
                    </li>
                ))}
            </ul>
            {products.length === 0 ? (
                <p className="text-muted-foreground">No products yet. Ask an admin to add catalog items.</p>
            ) : null}
        </main>
    );
}
