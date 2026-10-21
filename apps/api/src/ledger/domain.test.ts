import assert from "node:assert/strict";
import test from "node:test";
import { moneyMinor } from "@monikey/money";
import {
  assertBalancedPostings,
  LedgerValidationError,
  type LedgerPostingInput,
} from "./domain.js";

const expenseLedgerId = "141e4567-e89b-42d3-a456-426614174000";
const bankLedgerId = "241e4567-e89b-42d3-a456-426614174000";

function posting(
  ledgerAccountId: string,
  direction: "DEBIT" | "CREDIT",
  amount: bigint,
): LedgerPostingInput {
  return {
    ledgerAccountId,
    direction,
    amountMinor: moneyMinor(amount),
  };
}

test("accepts exact positive postings that balance", () => {
  assert.doesNotThrow(() =>
    assertBalancedPostings([
      posting(expenseLedgerId, "DEBIT", 25001n),
      posting(bankLedgerId, "CREDIT", 25001n),
    ]),
  );
});

test("requires two postings and distinct ledger accounts", () => {
  assert.throws(
    () => assertBalancedPostings([posting(expenseLedgerId, "DEBIT", 1n)]),
    LedgerValidationError,
  );
  assert.throws(
    () =>
      assertBalancedPostings([
        posting(expenseLedgerId, "DEBIT", 1n),
        posting(expenseLedgerId, "CREDIT", 1n),
      ]),
    LedgerValidationError,
  );
});

test("rejects unbalanced, non-positive, invalid, and out-of-range postings", () => {
  assert.throws(
    () =>
      assertBalancedPostings([
        posting(expenseLedgerId, "DEBIT", 2n),
        posting(bankLedgerId, "CREDIT", 1n),
      ]),
    /must balance/,
  );
  assert.throws(
    () =>
      assertBalancedPostings([
        posting(expenseLedgerId, "DEBIT", 0n),
        posting(bankLedgerId, "CREDIT", 0n),
      ]),
    /must be positive/,
  );
  assert.throws(
    () =>
      assertBalancedPostings([
        posting(expenseLedgerId, "DEBIT", 9223372036854775808n),
        posting(bankLedgerId, "CREDIT", 9223372036854775808n),
      ]),
    /exceeds PostgreSQL BIGINT range/,
  );
  assert.throws(
    () =>
      assertBalancedPostings([
        posting("not-a-uuid", "DEBIT", 1n),
        posting(bankLedgerId, "CREDIT", 1n),
      ]),
    /must be a UUID/,
  );
});
