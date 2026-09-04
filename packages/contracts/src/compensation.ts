/**
 * The periods a compensation figure can be quoted in.
 *
 * Only month and year, because those are the only two that convert into each
 * other exactly. Hourly and daily rates need an assumption about hours worked,
 * and this value feeds a *hard* filter -- a guessed factor here would silently
 * discard opportunities the user never learns existed. Agents convert those
 * themselves and disclose the assumption.
 *
 * Mirrors the `public.compensation_period` Postgres enum.
 */
export const compensationPeriods = ["month", "year"] as const;

export type CompensationPeriod = (typeof compensationPeriods)[number];
