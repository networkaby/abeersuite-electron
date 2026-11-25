import axios from "axios";

/** Sent with a lifecycle refusal when the voucher's status is no longer what the screen showed. */
export const VOUCHER_STALE = "VOUCHER_STALE";

/** The voucher had already been cancelled / restored elsewhere: close the box and reload. */
export function isVoucherStale(err: unknown): boolean {
    return axios.isAxiosError(err) && err.response?.data?.code === VOUCHER_STALE;
}
