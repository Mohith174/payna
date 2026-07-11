import { describe, expect, it } from "vitest";
import { addMonths, computeDeadline } from "./deadlines.js";

describe("addMonths", () => {
  it("clamps to the last day of the target month instead of rolling over (non-leap Feb)", () => {
    const result = addMonths(new Date(2023, 0, 31), 1); // Jan 31, 2023 + 1mo
    expect(result.getFullYear()).toBe(2023);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28);
  });

  it("clamps to Feb 29 in a leap year", () => {
    const result = addMonths(new Date(2024, 0, 31), 1); // Jan 31, 2024 + 1mo
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(29);
  });

  it("keeps the day-of-month when the target month is long enough", () => {
    const result = addMonths(new Date(2024, 0, 15), 1);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(15);
  });
});

describe("computeDeadline — null cadence", () => {
  it("returns no_deadline with a null nextDueDate when intervalMonths is null", () => {
    const result = computeDeadline({
      since: "2024-01-01",
      lastFiledAt: null,
      intervalMonths: null,
      dueMonthDay: null,
      graceDays: null,
    });
    expect(result).toEqual({ nextDueDate: null, status: "no_deadline" });
  });
});

describe("computeDeadline — graceDays boundary", () => {
  // lastFiledAt + 1 month = 2024-02-01; graceDays = 5 extends the overdue boundary to 2024-02-06.
  const base = {
    since: "2024-01-01",
    lastFiledAt: "2024-01-01",
    intervalMonths: 1,
    dueMonthDay: null,
    graceDays: 5,
  };

  it("is not overdue exactly on the grace boundary", () => {
    const result = computeDeadline(base, new Date(2024, 1, 6)); // Feb 6 = nextDue + 5 days
    expect(result.status).not.toBe("overdue");
  });

  it("is overdue the day after the grace boundary", () => {
    const result = computeDeadline(base, new Date(2024, 1, 7)); // Feb 7 = nextDue + 6 days
    expect(result.status).toBe("overdue");
  });
});

describe("computeDeadline — due_soon boundary (within 30 days)", () => {
  // intervalMonths 0 pins nextDueDate to lastFiledAt itself, isolating the day-count math.
  const base = {
    since: "2024-04-01",
    lastFiledAt: "2024-04-01",
    intervalMonths: 0,
    dueMonthDay: null,
    graceDays: 0,
  };

  it("is due_soon exactly 30 days out", () => {
    const result = computeDeadline(base, new Date(2024, 2, 2)); // Mar 2 -> Apr 1 = 30 days
    expect(result.status).toBe("due_soon");
  });

  it("is upcoming 31 days out", () => {
    const result = computeDeadline(base, new Date(2024, 2, 1)); // Mar 1 -> Apr 1 = 31 days
    expect(result.status).toBe("upcoming");
  });
});

describe("computeDeadline — dueMonthDay snapping", () => {
  it("snaps the computed date onto the fixed month/day", () => {
    const result = computeDeadline(
      {
        since: "2024-06-01",
        lastFiledAt: "2024-06-01",
        intervalMonths: 12,
        dueMonthDay: "03-31",
        graceDays: 0,
      },
      new Date(2024, 5, 2),
    );
    expect(result.nextDueDate).toBe("2025-03-31");
  });
});
