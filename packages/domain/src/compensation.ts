/**
 * Compensation periods, and conversion between them.
 *
 * This exists because the same quantity was previously described three
 * different ways: the user's floor was monthly, agents were told in a live
 * input schema to send annual figures, and the board rendered the result with
 * no period at all. Any comparison between them was wrong by 12x and nothing
 * on screen made that visible.
 *
 * Mirrors `app.normalize_compensation` and the `public.compensation_period`
 * enum in `supabase/migrations/20250115122400_compensation_period.sql`.
 */
import type { CompensationPeriod } from "@upgradr/contracts";

export const compensationPeriodLabels: Record<CompensationPeriod, string> = {
  month: "per month",
  year: "per year",
};

/**
 * Converts an amount between periods.
 *
 * Only month and year exist, so this is exact. Hourly and daily rates are
 * deliberately not modelled: converting them needs an invented assumption
 * about hours worked, and that assumption would then be applied silently to a
 * *hard* compensation filter. An agent meeting an hourly rate converts it
 * itself and says so, which keeps the guess visible to the user.
 */
export function normalizeCompensation(
  amount: number,
  from: CompensationPeriod,
  to: CompensationPeriod,
): number {
  if (from === to) {
    return amount;
  }
  return from === "year" ? amount / 12 : amount * 12;
}

/**
 * Whether a posting's range clears the user's floor, both normalized to the
 * floor's own period first.
 *
 * Compares against the *bottom* of the range: a posting advertising
 * "40k-60k" against a 50k floor has not met it, it merely might. Treating the
 * top of the range as the test would let an agent justify almost anything.
 *
 * Returns `null` rather than `false` when there is nothing to compare --
 * either no floor set, or a posting that published no figures, which is most
 * of them. `null` means "not assessable", and the caller must not treat that
 * as a failed test. That distinction is the whole point: a hard filter that
 * reads "unknown" as "too low" would discard nearly every posting.
 *
 * Currency is deliberately not handled here. UpgradR has no exchange-rate
 * source and should not acquire one, so a cross-currency comparison is the
 * agent's job.
 */
export function meetsCompensationFloor(input: {
  floor: number | null;
  floorPeriod: CompensationPeriod;
  floorCurrency: string | null;
  amountMin: number | null;
  amountPeriod: CompensationPeriod | null;
  amountCurrency: string | null;
}): boolean | null {
  const { floor, floorPeriod, floorCurrency, amountMin, amountPeriod, amountCurrency } = input;

  if (floor === null || amountMin === null || amountPeriod === null) {
    return null;
  }

  // Not assessable rather than failed: converting would require a rate we do
  // not have, and guessing one here would silently drop opportunities.
  if (floorCurrency !== null && amountCurrency !== null && floorCurrency !== amountCurrency) {
    return null;
  }

  return normalizeCompensation(amountMin, amountPeriod, floorPeriod) >= floor;
}

/** Renders a range with its period, e.g. `SEK 45 000 – 55 000 per month`. */
export function formatCompensationRange(input: {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: CompensationPeriod | null;
}): string | null {
  const { min, max, currency, period } = input;
  if (min === null && max === null) {
    return null;
  }

  const amount = min !== null && max !== null && min !== max
    ? `${min.toLocaleString()} – ${max.toLocaleString()}`
    : (min ?? max)!.toLocaleString();

  return [currency, amount, period ? compensationPeriodLabels[period] : null]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}
