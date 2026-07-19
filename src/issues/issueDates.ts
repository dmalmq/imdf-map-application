import type { LocaleCode } from "../imdf/types";

/**
 * Local-calendar due-date helpers. A due date is a date-only `YYYY-MM-DD`
 * value; it is never parsed with `new Date("YYYY-MM-DD")` (that form is UTC)
 * and never converted through a timestamp, so no hidden time-zone shift can
 * move the day. Classification compares calendar components only.
 */

export interface LocalDateComponents {
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
}

export type DueDateClass = "overdue" | "due_soon" | "none";

const DUE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Local calendar components of an instant, in the viewer's time zone. */
export function localToday(now: Date): LocalDateComponents {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * Parses an exact `YYYY-MM-DD` calendar date. Validates the day against the
 * real calendar (leap years included) and returns `null` for anything else —
 * no `Date` overflow coercion can accept a day like February 30.
 */
export function parseDueDate(dueDate: string): LocalDateComponents | null {
  const match = DUE_DATE_PATTERN.exec(dueDate);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return null;
  }
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 && isLeapYear ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  if (day < 1 || day > maxDay) {
    return null;
  }
  return { year, month, day };
}

/**
 * Days-from-civil (Howard Hinnant's algorithm): an exact serial number per
 * calendar day. Subtracting two serials yields a calendar-day difference with
 * no daylight-saving or time-of-day interference.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

/**
 * Classifies a due date against local today: before today is overdue, today
 * through three local calendar days ahead is due soon, day four onward is
 * neither.
 */
export function classifyDueDate(due: LocalDateComponents, today: LocalDateComponents): DueDateClass {
  const difference =
    daysFromCivil(due.year, due.month, due.day) - daysFromCivil(today.year, today.month, today.day);
  if (difference < 0) {
    return "overdue";
  }
  return difference <= 3 ? "due_soon" : "none";
}

/**
 * Localized display of a date-only value. The `Date` is built from numeric
 * components (local midnight) and formatted the same day, so the shown date
 * is the stored date in every time zone. Invalid input is returned unchanged.
 */
export function formatDueDate(dueDate: string, locale: LocaleCode): string {
  const components = parseDueDate(dueDate);
  if (components === null) {
    return dueDate;
  }
  // Two-digit years hit the legacy Date constructor's 1900 offset, so build
  // in leap year 2000 (every parsed month/day is valid there) and set the
  // real year afterwards. parseDueDate already rejected Feb 29 in non-leap
  // years, so setFullYear cannot roll the date over.
  const date = new Date(2000, components.month - 1, components.day);
  date.setFullYear(components.year);
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    // Gregorian year 0 is 1 BC and, without an era, formats identically to
    // year 1 (1 AD). Show the localized era only at that boundary.
    ...(components.year === 0 ? { era: "short" as const } : {}),
  }).format(date);
}

/**
 * Localized display of a UTC RFC 3339 instant as its local calendar date.
 * Used for created/updated timestamps, which are true instants (unlike the
 * date-only due date).
 */
export function formatIssueInstant(isoUtc: string, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(isoUtc));
}
