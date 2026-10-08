import { notFound } from "next/navigation";
import { loadPortalOrders } from "@/modules/external/portal/portalOrders";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import AppOrderView from "@/modules/external/shopApp/AppOrderView";
import { APP } from "@/modules/external/shopApp/appPaths";
import { getPayableOnlineGateways } from "@/shared/lib/payments/activeOnlineGateway";

/**
 * One order. Read through loadPortalOrders with this customer's id, so only
 * their own order can open here — a typed or guessed number shows "not found".
 * An online order still unpaid gets Pay now (the website's own payment panel).
 */
export default async function CustomerAppOrderPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ pay?: string }>;
}) {
    const [{ id }, { pay }] = await Promise.all([params, searchParams]);
    const orderId = Number(id);
    const customerId = await requireAppCustomer(`${APP}/order/${id}`);
    if (!Number.isInteger(orderId) || orderId < 1) notFound();
    const [order] = await loadPortalOrders(customerId, orderId);
    if (!order) notFound();
    // Only what the pay buttons need — never the gateway rows themselves.
    const gateways = order.awaitingPayment
        ? (await getPayableOnlineGateways()).map((g) => ({ provider: g.provider, displayName: g.displayName }))
        : [];
    return <AppOrderView order={order} gateways={gateways} payFailed={pay === "failed"} />;
}
