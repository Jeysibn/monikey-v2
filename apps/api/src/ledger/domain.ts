import { moneyMinor, type MoneyMinor } from "@monikey/money";

export type PostingDirection = "DEBIT" | "CREDIT";

export type LedgerPostingInput = {
  ledgerAccountId: string;
  direction: PostingDirection;
  amountMinor: MoneyMinor;
};

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertBalancedPostings(
  postings: readonly LedgerPostingInput[],
): void {
  if (postings.length < 2) {
    throw new LedgerValidationError(
      "A journal requires at least two postings.",
    );
  }

  const accountIds = new Set<string>();
  let debits = 0n;
  let credits = 0n;

  for (const posting of postings) {
    if (!UUID_PATTERN.test(posting.ledgerAccountId)) {
      throw new LedgerValidationError("Ledger account ID must be a UUID.");
    }
    if (accountIds.has(posting.ledgerAccountId)) {
      throw new LedgerValidationError(
        "A journal must use each ledger account at most once.",
      );
    }
    accountIds.add(posting.ledgerAccountId);

    if (posting.direction !== "DEBIT" && posting.direction !== "CREDIT") {
      throw new LedgerValidationError("Posting direction is invalid.");
    }
    if (typeof posting.amountMinor !== "bigint") {
      throw new LedgerValidationError(
        "Posting amount must be a BigInt minor-unit value.",
      );
    }

    let amount: MoneyMinor;
    try {
      amount = moneyMinor(posting.amountMinor);
    } catch {
      throw new LedgerValidationError(
        "Posting amount exceeds PostgreSQL BIGINT range.",
      );
    }
    if (amount <= 0n) {
      throw new LedgerValidationError("Posting amount must be positive.");
    }

    if (posting.direction === "DEBIT") debits += amount;
    else credits += amount;
  }

  if (debits !== credits) {
    throw new LedgerValidationError("Journal debits and credits must balance.");
  }
}
