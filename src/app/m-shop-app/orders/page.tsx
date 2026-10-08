import Link from "next/link";
import { ChevronRight, Package } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import { loadPortalOrders } from "@/modules/external/portal/portalOrders";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { orderHeadline } from "@/modules/external/shopApp/appOrderStatus";
import { APP } from "@/modules/external/shopApp/appPaths";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";

/**
 * Orders tab: one card per order — the first item's photo, where it is
 * ("Delivered on 3 Oct", "Payment pending"), the total. Same orders as the
 * portal's My Orders (every profile the customer belongs to). Counter bills
 * live under Account → My Bills.
 */
export default async function CustomerAppOrdersPage() {
    const customerId = await requireAppCustomer(`${APP}/orders`);
    const [orders, products] = await Promise.all([loadPortalOrders(customerId), loadStorefrontProductsCached()]);
    // A photo for the card: the first line's product, when it is still in the shop.
    const photoByName = new Map(products.map((p) => [p.name, p.galleryUrls[0] ?? p.imageUrl]));

    return (
        <>
            <MobileHeader title="My orders" menu={false} />
            {orders.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-8 py-20 text-center">
                    <span className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Package className="size-9" />
                    </span>
                    <p className="text-lg font-semibold">No orders yet</p>
                    <p className="text-sm text-muted-foreground">Things you order in the app show here. Bills from our counter are under Account → My Bills.</p>
                    <Link href={APP} className="mt-2 rounded-xl bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground">
                        Start shopping
                    </Link>
                </div>
            ) : (
                <ul className="space-y-2 py-2">
                    {orders.map((o) => {
                        const head = orderHeadline(o);
                        const first = o.lines[0];
                        const more = o.lines.length - 1;
                        return (
                            <li key={o.id}>
                                <Link href={`${APP}/order/${o.id}`} className="flex items-center gap-3 bg-background px-4 py-3 active:bg-muted">
                                    <span className="relative size-16 shrink-0 overflow-hidden rounded-xl border bg-white">
                                        <ShopRemoteImage src={first ? photoByName.get(first.name) : null} alt="" fill sizes="64px" frame="square" className="object-contain p-1" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className={`block text-sm font-semibold ${head.tone}`}>{head.text}</span>
                                        <span className="mt-0.5 line-clamp-1 block text-sm">
                                            {first?.name ?? `Order #${o.id}`}
                                            {more > 0 ? ` + ${more} more` : ""}
                                        </span>
                                        <span className="block text-xs text-muted-foreground">
                                            #{o.id} · {formatRupeesFromPaise(o.goodsPaise + o.shippingPaise)}
                                        </span>
                                    </span>
                                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}
