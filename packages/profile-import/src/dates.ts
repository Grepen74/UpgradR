import type { DateResult } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999) {
    return false;
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

function toIso(year: number, month: number, day: number): string | null {
  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export type DateNormalizationIssue = "none" | "ambiguous" | "unparseable";

export interface DateNormalizationOutcome {
  result: DateResult;
  issue: DateNormalizationIssue;
}

/**
 * Normalizes a free-text date found in an export file into an ISO
 * `YYYY-MM-DD` string, but only when the day, month, and year are all
 * unambiguously present in the source text. Month/year-only values (very
 * common in LinkedIn "Started On" / "Finished On" columns, e.g. "Jan 2020")
 * are deliberately left un-normalized rather than guessing a day-of-month;
 * callers should surface the `ambiguous` issue as a warning and keep the raw
 * text available for the user to fill in themselves.
 */
export function normalizeDate(raw: string | null | undefined): DateNormalizationOutcome {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return { result: { iso: null, raw: null }, issue: "none" };
  }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const [, y, m, d] = isoMatch as unknown as [string, string, string, string];
    const iso = toIso(Number(y), Number(m), Number(d));
    return iso
      ? { result: { iso, raw: trimmed }, issue: "none" }
      : { result: { iso: null, raw: trimmed }, issue: "unparseable" };
  }

  const slashMatch = /^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/.exec(trimmed);
  if (slashMatch) {
    const [, a, b, c] = slashMatch as unknown as [string, string, string, string];
    // Disambiguate YYYY/MM/DD vs MM/DD/YYYY by which side looks like a year.
    let year: number;
    let month: number;
    let day: number;
    if (a.length === 4) {
      year = Number(a);
      month = Number(b);
      day = Number(c);
    } else if (c.length === 4) {
      const first = Number(a);
      const second = Number(b);
      if (first <= 12 && second <= 12) {
        return { result: { iso: null, raw: trimmed }, issue: "ambiguous" };
      }
      if (first > 12 && second <= 12) {
        day = first;
        month = second;
      } else {
        month = first;
        day = second;
      }
      year = Number(c);
    } else {
      return { result: { iso: null, raw: trimmed }, issue: "ambiguous" };
    }
    const iso = toIso(year, month, day);
    return iso
      ? { result: { iso, raw: trimmed }, issue: "none" }
      : { result: { iso: null, raw: trimmed }, issue: "unparseable" };
  }

  const dayMonthYear = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(trimmed);
  if (dayMonthYear) {
    const [, d, monthName, y] = dayMonthYear as unknown as [string, string, string, string];
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const iso = toIso(Number(y), month, Number(d));
      return iso
        ? { result: { iso, raw: trimmed }, issue: "none" }
        : { result: { iso: null, raw: trimmed }, issue: "unparseable" };
    }
  }

  const monthDayYear = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(trimmed);
  if (monthDayYear) {
    const [, monthName, d, y] = monthDayYear as unknown as [string, string, string, string];
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const iso = toIso(Number(y), month, Number(d));
      return iso
        ? { result: { iso, raw: trimmed }, issue: "none" }
        : { result: { iso: null, raw: trimmed }, issue: "unparseable" };
    }
  }

  // "Jan 2020" / "January 2020" — a real value, but no day is present so we
  // cannot safely produce a full ISO date. Surface as ambiguous rather than
  // guessing the 1st of the month.
  const monthYearOnly = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(trimmed);
  if (monthYearOnly) {
    const [, monthName] = monthYearOnly as unknown as [string, string, string];
    if (MONTHS[monthName.slice(0, 3).toLowerCase()] !== undefined) {
      return { result: { iso: null, raw: trimmed }, issue: "ambiguous" };
    }
  }

  // Year only, e.g. "2020".
  if (/^\d{4}$/.test(trimmed)) {
    return { result: { iso: null, raw: trimmed }, issue: "ambiguous" };
  }

  return { result: { iso: null, raw: trimmed }, issue: "unparseable" };
}
