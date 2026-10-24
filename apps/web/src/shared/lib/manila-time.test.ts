import assert from "node:assert/strict";
import test from "node:test";
import {
  manilaBusinessDate,
  millisecondsUntilNextManilaMidnight,
  scheduleManilaMidnightRefresh,
} from "./manila-time.js";

test("schedules refresh at Manila midnight independent of UTC date", () => {
  assert.equal(
    millisecondsUntilNextManilaMidnight(new Date("2026-10-24T15:59:59.250Z")),
    750,
  );
  assert.equal(
    millisecondsUntilNextManilaMidnight(new Date("2026-10-24T16:00:00.000Z")),
    24 * 60 * 60 * 1000,
  );
});

test("schedules the year rollover at Manila midnight", () => {
  assert.equal(
    millisecondsUntilNextManilaMidnight(new Date("2026-12-31T15:59:59.000Z")),
    1000,
  );
});

test("formats Manila business dates independently of the browser timezone", () => {
  assert.equal(
    manilaBusinessDate(new Date("2026-12-31T16:30:00.000Z")),
    "2027-01-01",
  );
  assert.equal(
    manilaBusinessDate(new Date("2026-10-24T15:59:59.000Z")),
    "2026-10-24",
  );
});

test("schedules one cancellable refresh at the next Manila midnight", () => {
  let scheduled: (() => void) | undefined;
  let delay = 0;
  let cleared = false;
  let refreshCount = 0;
  const cancel = scheduleManilaMidnightRefresh(
    () => refreshCount++,
    () => new Date("2026-10-24T15:59:59.000Z"),
    (callback, nextDelay) => {
      scheduled = callback;
      delay = nextDelay;
      return 7;
    },
    (timer) => {
      assert.equal(timer, 7);
      cleared = true;
    },
  );
  assert.equal(delay, 1000);
  scheduled?.();
  assert.equal(refreshCount, 1);
  cancel();
  assert.equal(cleared, true);
});
