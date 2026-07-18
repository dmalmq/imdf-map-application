import { describe, expect, it } from "vitest";
import {
  classifyDueDate,
  formatDueDate,
  formatIssueInstant,
  localToday,
  parseDueDate,
  type LocalDateComponents,
} from "./issueDates";

describe("localToday", () => {
  it("returns the local calendar components of the given instant", () => {
    // Numeric Date construction is local time; no date-only string parsing.
    expect(localToday(new Date(2026, 0, 31, 23, 59, 59))).toEqual({
      year: 2026,
      month: 1,
      day: 31,
    });
    expect(localToday(new Date(2024, 1, 29, 0, 0, 0))).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });
});

describe("parseDueDate", () => {
  it("accepts an exact YYYY-MM-DD calendar date", () => {
    expect(parseDueDate("2026-07-19")).toEqual({ year: 2026, month: 7, day: 19 });
    expect(parseDueDate("0001-01-01")).toEqual({ year: 1, month: 1, day: 1 });
  });

  it("accepts a leap day only in a leap year", () => {
    expect(parseDueDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDueDate("2025-02-29")).toBeNull();
    expect(parseDueDate("2100-02-29")).toBeNull();
    expect(parseDueDate("2000-02-29")).not.toBeNull();
  });

  it.each([
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-01-00",
    "2026-01-32",
    "2026-7-19",
    "26-07-19",
    "2026/07/19",
    " 2026-07-19",
    "2026-07-19 ",
    "2026-07-19T00:00:00Z",
    "garbage",
    "",
  ])("rejects %j without Date coercion", (input) => {
    expect(parseDueDate(input)).toBeNull();
  });
});

/** Adds local calendar days without ever parsing a date-only string. */
function shiftLocal(today: LocalDateComponents, days: number): LocalDateComponents {
  return localToday(new Date(today.year, today.month - 1, today.day + days, 12, 0, 0));
}

describe("classifyDueDate", () => {
  const today: LocalDateComponents = { year: 2026, month: 7, day: 19 };

  it("marks any day before local today overdue", () => {
    expect(classifyDueDate(shiftLocal(today, -1), today)).toBe("overdue");
    expect(classifyDueDate(shiftLocal(today, -30), today)).toBe("overdue");
  });

  it("marks today through three local calendar days ahead due soon", () => {
    expect(classifyDueDate(shiftLocal(today, 0), today)).toBe("due_soon");
    expect(classifyDueDate(shiftLocal(today, 1), today)).toBe("due_soon");
    expect(classifyDueDate(shiftLocal(today, 2), today)).toBe("due_soon");
    expect(classifyDueDate(shiftLocal(today, 3), today)).toBe("due_soon");
  });

  it("marks day four and beyond neither overdue nor due soon", () => {
    expect(classifyDueDate(shiftLocal(today, 4), today)).toBe("none");
    expect(classifyDueDate(shiftLocal(today, 45), today)).toBe("none");
  });

  it("crosses a month boundary by calendar day, not by timestamp", () => {
    const endOfMonth: LocalDateComponents = { year: 2026, month: 1, day: 31 };
    expect(classifyDueDate({ year: 2026, month: 2, day: 3 }, endOfMonth)).toBe("due_soon");
    expect(classifyDueDate({ year: 2026, month: 2, day: 4 }, endOfMonth)).toBe("none");
  });

  it("crosses a leap day by calendar day", () => {
    const beforeLeap: LocalDateComponents = { year: 2024, month: 2, day: 28 };
    expect(classifyDueDate({ year: 2024, month: 3, day: 2 }, beforeLeap)).toBe("due_soon");
    expect(classifyDueDate({ year: 2024, month: 3, day: 3 }, beforeLeap)).toBe("none");
  });

  it("crosses a year boundary by calendar day", () => {
    const newYearsEve: LocalDateComponents = { year: 2025, month: 12, day: 31 };
    expect(classifyDueDate({ year: 2026, month: 1, day: 3 }, newYearsEve)).toBe("due_soon");
    expect(classifyDueDate({ year: 2026, month: 1, day: 4 }, newYearsEve)).toBe("none");
    expect(classifyDueDate({ year: 2025, month: 12, day: 30 }, newYearsEve)).toBe("overdue");
  });
});

describe("formatDueDate", () => {
  it("formats the calendar date in English", () => {
    expect(formatDueDate("2026-07-19", "en")).toBe("Jul 19, 2026");
  });

  it("formats the calendar date in Japanese", () => {
    expect(formatDueDate("2026-07-19", "ja")).toBe("2026年7月19日");
  });

  it("returns an invalid value unchanged", () => {
    expect(formatDueDate("not-a-date", "en")).toBe("not-a-date");
  });

  it("formats accepted years 0000–0099 without the legacy Date 1900 offset", () => {
    expect(formatDueDate("0050-07-19", "en")).toBe("Jul 19, 50");
    expect(formatDueDate("0050-07-19", "ja")).toBe("50年7月19日");
    expect(formatDueDate("0001-01-01", "en")).toBe("Jan 1, 1");
    expect(formatDueDate("0001-01-01", "ja")).toBe("1年1月1日");
    expect(formatDueDate("0004-02-29", "en")).toBe("Feb 29, 4");
  });

  it("disambiguates Gregorian year 0000 from 0001 with a localized era", () => {
    // Year 0 (1 BC) and year 1 (1 AD) both format as "1" without an era.
    expect(formatDueDate("0000-01-01", "en")).toBe("Jan 1, 1 BC");
    expect(formatDueDate("0000-01-01", "ja")).toBe("紀元前1年1月1日");
    expect(formatDueDate("0001-01-01", "en")).toBe("Jan 1, 1");
    expect(formatDueDate("0001-01-01", "ja")).toBe("1年1月1日");
  });
});

describe("formatIssueInstant", () => {
  it("shows the local calendar date of a UTC instant", () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      expect(formatIssueInstant("2026-07-19T10:01:00Z", "en")).toBe("Jul 19, 2026");
      expect(formatIssueInstant("2026-07-19T10:01:00Z", "ja")).toBe("2026年7月19日");
      // 16:00 UTC is 01:00 the next day in Tokyo — the local date must move.
      expect(formatIssueInstant("2026-07-19T16:00:00Z", "en")).toBe("Jul 20, 2026");
      expect(formatIssueInstant("2026-07-19T16:00:00Z", "ja")).toBe("2026年7月20日");
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });
});
