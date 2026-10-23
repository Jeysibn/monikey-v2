import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPhp,
  moneyMinor,
  parsePhpMinor,
  serializeMoneyMinor,
} from "./index.js";

test("parses valid PHP values into exact minor units", () => {
  assert.equal(parsePhpMinor("1,250.50"), 125050n);
  assert.equal(parsePhpMinor("0.01"), 1n);
  assert.equal(parsePhpMinor("25"), 2500n);
  assert.equal(parsePhpMinor("01.00"), 100n);
  assert.equal(parsePhpMinor("-25.4"), -2540n);
});

test("rejects malformed separators, precision, and numeric syntax", () => {
  for (const value of ["12,34", "1,,000", "1.001", "1e3", "NaN"]) {
    assert.throws(() => parsePhpMinor(value), TypeError, value);
  }
});

test("preserves both signed PostgreSQL BIGINT boundaries", () => {
  assert.equal(parsePhpMinor("92233720368547758.07"), 9223372036854775807n);
  assert.equal(parsePhpMinor("-92233720368547758.08"), -9223372036854775808n);
  assert.throws(() => parsePhpMinor("92233720368547758.08"), RangeError);
  assert.throws(() => moneyMinor("-9223372036854775809"), RangeError);
});

test("serializes minor units as exact base-10 strings", () => {
  assert.equal(
    serializeMoneyMinor(moneyMinor("9007199254740993")),
    "9007199254740993",
  );
});

test("formats large values without converting the amount to Number", () => {
  assert.equal(formatPhp(moneyMinor("125050")), "₱\u202f1,250.50");
  assert.equal(
    formatPhp(moneyMinor("-123456789012345678")),
    "-₱\u202f1,234,567,890,123,456.78",
  );
});
