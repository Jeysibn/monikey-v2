import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { moneyMinor } from "@monikey/money";
import {
  BillOccurrenceQuerySchema,
  FinancialDateSchema,
} from "@monikey/contracts";
import {
  assertBalancedPostings,
  type LedgerPostingInput,
} from "./ledger/domain.js";

const ASSET_A = "141e4567-e89b-42d3-a456-426614174000";
const ASSET_B = "241e4567-e89b-42d3-a456-426614174000";
const EXPENSE = "341e4567-e89b-42d3-a456-426614174000";
const INCOME = "441e4567-e89b-42d3-a456-426614174000";
const EQUITY = "541e4567-e89b-42d3-a456-426614174000";

type Action =
  | { kind: "INCOME"; amount: bigint }
  | { kind: "EXPENSE"; amount: bigint }
  | { kind: "TRANSFER"; amount: bigint; fee: bigint }
  | { kind: "REFUND"; amount: bigint }
  | { kind: "ADJUSTMENT"; amount: bigint; increase: boolean }
  | { kind: "REVERSE_LAST" }
  | { kind: "EDIT_EXPENSE"; amount: bigint };

type Journal = {
  postings: readonly LedgerPostingInput[];
  assetDelta: bigint;
};

const positiveAmount = fc.bigInt({ min: 1n, max: 1_000_000n });
const actionArbitrary: fc.Arbitrary<Action> = fc.oneof(
  positiveAmount.map((amount) => ({ kind: "INCOME" as const, amount })),
  positiveAmount.map((amount) => ({ kind: "EXPENSE" as const, amount })),
  fc
    .record({
      amount: positiveAmount,
      fee: fc.bigInt({ min: 0n, max: 100_000n }),
    })
    .map(({ amount, fee }) => ({ kind: "TRANSFER" as const, amount, fee })),
  positiveAmount.map((amount) => ({ kind: "REFUND" as const, amount })),
  fc
    .record({ amount: positiveAmount, increase: fc.boolean() })
    .map(({ amount, increase }) => ({
      kind: "ADJUSTMENT" as const,
      amount,
      increase,
    })),
  fc.constant({ kind: "REVERSE_LAST" as const }),
  positiveAmount.map((amount) => ({ kind: "EDIT_EXPENSE" as const, amount })),
);

function posting(
  ledgerAccountId: string,
  direction: "DEBIT" | "CREDIT",
  amount: bigint,
): LedgerPostingInput {
  return { ledgerAccountId, direction, amountMinor: moneyMinor(amount) };
}

function signedPostingDelta(
  accountId: string,
  direction: "DEBIT" | "CREDIT",
  amount: bigint,
): bigint {
  return accountId === ASSET_A || accountId === ASSET_B
    ? direction === "DEBIT"
      ? amount
      : -amount
    : 0n;
}

function makeJournal(action: Action): Journal | null {
  switch (action.kind) {
    case "INCOME":
      return {
        postings: [
          posting(ASSET_A, "DEBIT", action.amount),
          posting(INCOME, "CREDIT", action.amount),
        ],
        assetDelta: action.amount,
      };
    case "EXPENSE":
      return {
        postings: [
          posting(EXPENSE, "DEBIT", action.amount),
          posting(ASSET_A, "CREDIT", action.amount),
        ],
        assetDelta: -action.amount,
      };
    case "TRANSFER": {
      const sourceAmount = action.amount + action.fee;
      return {
        postings: [
          posting(ASSET_B, "DEBIT", action.amount),
          ...(action.fee > 0n ? [posting(EXPENSE, "DEBIT", action.fee)] : []),
          posting(ASSET_A, "CREDIT", sourceAmount),
        ],
        assetDelta: -action.fee,
      };
    }
    case "REFUND":
      return {
        postings: [
          posting(ASSET_A, "DEBIT", action.amount),
          posting(EXPENSE, "CREDIT", action.amount),
        ],
        assetDelta: action.amount,
      };
    case "ADJUSTMENT":
      return action.increase
        ? {
            postings: [
              posting(ASSET_A, "DEBIT", action.amount),
              posting(EQUITY, "CREDIT", action.amount),
            ],
            assetDelta: action.amount,
          }
        : {
            postings: [
              posting(EQUITY, "DEBIT", action.amount),
              posting(ASSET_A, "CREDIT", action.amount),
            ],
            assetDelta: -action.amount,
          };
    case "REVERSE_LAST":
    case "EDIT_EXPENSE":
      return null;
  }
}

test("random valid operation sequences preserve balanced journals and exact asset deltas", () => {
  fc.assert(
    fc.property(
      fc.array(actionArbitrary, { minLength: 1, maxLength: 80 }),
      (actions) => {
        const journals: Journal[] = [];
        let expectedAssetDelta = 0n;

        for (const action of actions) {
          if (action.kind === "REVERSE_LAST") {
            const previous = journals.at(-1);
            if (previous) {
              const reversed = previous.postings.map((item) => ({
                ledgerAccountId: item.ledgerAccountId,
                direction:
                  item.direction === "DEBIT"
                    ? ("CREDIT" as const)
                    : ("DEBIT" as const),
                amountMinor: item.amountMinor,
              }));
              assertBalancedPostings(reversed);
              journals.push({
                postings: reversed,
                assetDelta: -previous.assetDelta,
              });
              expectedAssetDelta -= previous.assetDelta;
            }
            continue;
          }

          if (action.kind === "EDIT_EXPENSE") {
            const previous = journals.at(-1);
            if (previous) {
              const reversed = previous.postings.map((item) => ({
                ledgerAccountId: item.ledgerAccountId,
                direction:
                  item.direction === "DEBIT"
                    ? ("CREDIT" as const)
                    : ("DEBIT" as const),
                amountMinor: item.amountMinor,
              }));
              assertBalancedPostings(reversed);
              journals.push({
                postings: reversed,
                assetDelta: -previous.assetDelta,
              });
              expectedAssetDelta -= previous.assetDelta;
            }
            const replacement = makeJournal({
              kind: "EXPENSE",
              amount: action.amount,
            });
            assert.ok(replacement);
            assertBalancedPostings(replacement.postings);
            journals.push(replacement);
            expectedAssetDelta += replacement.assetDelta;
            continue;
          }

          const journal = makeJournal(action);
          assert.ok(journal);
          assertBalancedPostings(journal.postings);
          const calculatedAssetDelta = journal.postings.reduce(
            (total, item) =>
              total +
              signedPostingDelta(
                item.ledgerAccountId,
                item.direction,
                BigInt(item.amountMinor),
              ),
            0n,
          );
          assert.equal(calculatedAssetDelta, journal.assetDelta);
          journals.push(journal);
          expectedAssetDelta += journal.assetDelta;
        }

        const totalDebits = journals
          .flatMap((journal) => journal.postings)
          .filter((item) => item.direction === "DEBIT")
          .reduce((total, item) => total + BigInt(item.amountMinor), 0n);
        const totalCredits = journals
          .flatMap((journal) => journal.postings)
          .filter((item) => item.direction === "CREDIT")
          .reduce((total, item) => total + BigInt(item.amountMinor), 0n);
        assert.equal(totalDebits, totalCredits);

        const assetBalanceDelta = journals.reduce(
          (total, journal) => total + journal.assetDelta,
          0n,
        );
        assert.equal(assetBalanceDelta, expectedAssetDelta);
      },
    ),
    { numRuns: 100 },
  );
});

test("transfer fee and no-fee identities hold for exact bigint amounts", () => {
  fc.assert(
    fc.property(
      positiveAmount,
      fc.bigInt({ min: 0n, max: 100_000n }),
      (amount, fee) => {
        const noFee = makeJournal({ kind: "TRANSFER", amount, fee: 0n });
        const withFee = makeJournal({ kind: "TRANSFER", amount, fee });
        assert.ok(noFee);
        assert.ok(withFee);
        assert.equal(noFee.assetDelta, 0n);
        assert.equal(withFee.assetDelta, -fee);
      },
    ),
    { numRuns: 100 },
  );
});

test("values above JavaScript safe integer boundaries remain exact strings", () => {
  fc.assert(
    fc.property(
      fc.bigInt({
        min: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        max: 9_223_372_036_854_775_807n,
      }),
      (value) => {
        const serialized = moneyMinor(value).toString();
        assert.equal(BigInt(serialized), value);
      },
    ),
    { numRuns: 100 },
  );
});

test("financial dates reject impossible calendar values and occurrence windows are bounded", () => {
  for (const invalid of [
    "2026-02-31",
    "2026-13-01",
    "0000-01-01",
    "2026-04-00",
  ]) {
    assert.equal(
      FinancialDateSchema.safeParse(invalid).success,
      false,
      invalid,
    );
  }
  for (const valid of [
    "2024-02-29",
    "2026-10-24",
    "0001-01-01",
    "9999-12-31",
  ]) {
    assert.equal(FinancialDateSchema.safeParse(valid).success, true, valid);
  }
  assert.equal(
    BillOccurrenceQuerySchema.safeParse({
      from: "2026-01-01",
      to: "2027-01-03",
    }).success,
    false,
  );
  assert.equal(
    BillOccurrenceQuerySchema.safeParse({
      from: "2026-01-01",
      to: "2026-12-31",
    }).success,
    true,
  );
});
