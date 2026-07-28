import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  nextRecurringDueAt,
  normalizeIntervalSeconds,
  normalizeScheduleKind,
  occurrenceKeyForDueAt,
} from "./scheduler.ts";

Deno.test("schedule kind defaults condition for market-cap triggers", () => {
  assertEquals(normalizeScheduleKind("", "market_cap"), "condition");
  assertEquals(normalizeScheduleKind("", "time"), "one_time");
  assertEquals(normalizeScheduleKind("every", "time"), "interval");
});

Deno.test("interval seconds are bounded", () => {
  assertEquals(normalizeIntervalSeconds("daily", null), 86_400);
  assertEquals(normalizeIntervalSeconds("weekly", null), 604_800);
  assertEquals(normalizeIntervalSeconds("interval", 300), 300);
  assertThrows(
    () => normalizeIntervalSeconds("interval", 30),
    Error,
    "interval_too_short",
  );
});

Deno.test("recurring schedules advance from the last due time", () => {
  const next = nextRecurringDueAt(
    {
      schedule_kind: "interval",
      interval_seconds: 300,
      last_due_at: "2026-07-27T10:00:00.000Z",
      occurrence_count: 1,
      max_occurrences: 3,
    },
    new Date("2026-07-27T10:01:00.000Z"),
  );
  assertEquals(next, "2026-07-27T10:05:00.000Z");
});

Deno.test("recurring schedules stop at max occurrences and end date", () => {
  assertEquals(
    nextRecurringDueAt(
      {
        schedule_kind: "daily",
        interval_seconds: 86_400,
        last_due_at: "2026-07-27T10:00:00.000Z",
        occurrence_count: 2,
        max_occurrences: 2,
      },
      new Date("2026-07-27T10:01:00.000Z"),
    ),
    null,
  );
  assertEquals(
    nextRecurringDueAt(
      {
        schedule_kind: "interval",
        interval_seconds: 300,
        last_due_at: "2026-07-27T10:00:00.000Z",
        ends_at: "2026-07-27T10:04:00.000Z",
      },
      new Date("2026-07-27T10:01:00.000Z"),
    ),
    null,
  );
});

Deno.test("occurrence keys are stable ISO due keys", () => {
  assertEquals(
    occurrenceKeyForDueAt("2026-07-27T10:00:00.000Z"),
    "due:2026-07-27T10:00:00.000Z",
  );
});
