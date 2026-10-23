import { LedgerBalanceInvariantError } from "./domain.js";

let ledgerInvariantFailures = 0;

export function recordLedgerInvariantFailure() {
  ledgerInvariantFailures += 1;
}

export function recordLedgerInvariantValidationFailure(error: unknown) {
  if (error instanceof LedgerBalanceInvariantError) {
    recordLedgerInvariantFailure();
  }
}

export function recordDatabaseLedgerInvariantFailure(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23514" &&
    "message" in error &&
    typeof error.message === "string" &&
    /^Journal [0-9a-f-]+ must have at least two balanced postings$/i.test(
      error.message,
    )
  ) {
    recordLedgerInvariantFailure();
  }
}

export function getLedgerInvariantFailures() {
  return ledgerInvariantFailures;
}
