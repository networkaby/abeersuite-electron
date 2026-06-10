/** Keep digits + a single decimal point. For free-typed money/qty text inputs. */
export const parseDecimalInput = (s: string): string =>
    s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

/** Keep digits only. */
export const parseDigitsInput = (s: string): string => s.replace(/[^\d]/g, "");

/** Keep digits + a single leading minus. */
export const parseSignedInput = (s: string): string =>
    s.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");
