import assert from "node:assert/strict";
import test from "node:test";
import { serverTodayInManila } from "./manila-date.js";

test("Manila business date rolls over at midnight, eight hours ahead of UTC", () => {
  assert.equal(
    serverTodayInManila(new Date("2026-10-24T15:59:59.999Z")),
    "2026-10-24",
  );
  assert.equal(
    serverTodayInManila(new Date("2026-10-24T16:00:00.000Z")),
    "2026-10-25",
  );
});

test("Manila business date follows the year boundary using the supplied clock", () => {
  assert.equal(
    serverTodayInManila(new Date("2026-12-31T15:59:59.999Z")),
    "2026-12-31",
  );
  assert.equal(
    serverTodayInManila(new Date("2026-12-31T16:00:00.000Z")),
    "2027-01-01",
  );
});
