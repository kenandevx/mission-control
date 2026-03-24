import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkerSettings,
  isScheduleReady,
  isPickupEligible,
  capacityLeft,
} from "./worker-core.mjs";

test("normalizeWorkerSettings clamps values", () => {
  const out = normalizeWorkerSettings({ enabled: true, pollIntervalSeconds: 1, maxConcurrency: 100 });
  assert.equal(out.pollIntervalSeconds, 5);
  assert.equal(out.maxConcurrency, 20);
});

test("isScheduleReady handles null/past/future", () => {
  const now = new Date("2026-03-23T20:20:00Z");
  assert.equal(isScheduleReady(null, now), true);
  assert.equal(isScheduleReady("2026-03-23T20:19:59Z", now), true);
  assert.equal(isScheduleReady("2026-03-23T20:20:01Z", now), false);
});

test("isPickupEligible enforces queue rules", () => {
  const inProgressIds = new Set(["col-doing"]);
  const now = new Date("2026-03-23T20:20:00Z");

  assert.equal(
    isPickupEligible(
      {
        id: "t1",
        board_id: "b1",
        column_id: "col-doing",
        assigned_agent_id: "main",
        execution_state: "queued",
        scheduled_for: null,
      },
      inProgressIds,
      now,
    ),
    true,
  );

  assert.equal(
    isPickupEligible(
      {
        id: "t2",
        board_id: "b1",
        column_id: "col-todo",
        assigned_agent_id: "main",
        execution_state: "queued",
        scheduled_for: null,
      },
      inProgressIds,
      now,
    ),
    false,
  );
});

test("capacityLeft computes available slots", () => {
  assert.equal(capacityLeft(3, 0), 3);
  assert.equal(capacityLeft(3, 2), 1);
  assert.equal(capacityLeft(3, 5), 0);
});
