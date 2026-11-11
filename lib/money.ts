import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
export function money(value: string | number | Decimal): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite() || result.isNegative()) throw new Error("Amount must be a finite, non-negative decimal.");
  return result.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
export function currency(value: string): string {
  const code = value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Currency must be an ISO 4217 code.");
  return code;
}
