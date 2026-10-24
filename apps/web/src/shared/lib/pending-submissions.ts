const retentionMs = 30 * 24 * 60 * 60 * 1000;
const maximumEntries = 20;

export type PendingSubmissionRecord = {
  id: string;
  key: string;
  createdAt: number;
};

type StoredSubmission = PendingSubmissionRecord & { fingerprint: string };

const memory = new Map<string, StoredSubmission[]>();

function storageKey(userId: string, operation: string): string {
  return `monikey-v2.pending.${operation}.${userId}`;
}

function readEntries(key: string): StoredSubmission[] {
  let entries = memory.get(key) ?? [];
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        entries = parsed.flatMap((entry): StoredSubmission[] => {
          if (
            typeof entry?.fingerprint !== "string" ||
            typeof entry?.key !== "string" ||
            typeof entry?.createdAt !== "number"
          ) {
            return [];
          }
          return [
            {
              id: typeof entry.id === "string" ? entry.id : entry.key,
              fingerprint: entry.fingerprint,
              key: entry.key,
              createdAt: entry.createdAt,
            },
          ];
        });
      }
    }
  } catch {
    // Keep the in-memory retry identity when browser storage is unavailable.
  }
  const cutoff = Date.now() - retentionMs;
  return entries
    .filter((entry) => entry.createdAt >= cutoff)
    .sort((left, right) => right.createdAt - left.createdAt);
}

function writeEntries(key: string, entries: StoredSubmission[]): void {
  const ordered = entries.sort(
    (left, right) => right.createdAt - left.createdAt,
  );
  memory.set(key, ordered);
  try {
    if (ordered.length) sessionStorage.setItem(key, JSON.stringify(ordered));
    else sessionStorage.removeItem(key);
  } catch {
    // The in-memory record still protects retries for this page lifetime.
  }
}

export function serializeSubmissionPayload(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(serializeSubmissionPayload).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeSubmissionPayload(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serializeSubmissionPayload(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Bind a key to one explicit user-action identity and its canonical payload.
 * Matching payloads never cause a new action to inherit an older key.
 */
export async function beginPendingSubmission(
  userId: string,
  operation: string,
  actionId: string,
  payload: unknown,
  retryExisting = false,
): Promise<{ id: string; key: string }> {
  const storageId = storageKey(userId, operation);
  const digest = await fingerprint(payload);
  const entries = readEntries(storageId);
  const existing = entries.find((entry) => entry.id === actionId);
  if (existing) {
    if (existing.fingerprint === digest) {
      writeEntries(storageId, entries);
      return { id: existing.id, key: existing.key };
    }
    if (retryExisting) {
      throw new Error(
        "These details do not match the saved attempt. Review the original details or start a new submission.",
      );
    }
  } else if (retryExisting) {
    throw new Error(
      "That saved attempt is no longer available. Start a new submission.",
    );
  }

  if (!existing && entries.length >= maximumEntries) {
    throw new Error(
      "There are several unresolved submissions. Retry or clear one before starting another.",
    );
  }

  const id: string = existing ? crypto.randomUUID() : actionId;
  const key = crypto.randomUUID();
  writeEntries(storageId, [
    ...entries,
    { id, fingerprint: digest, key, createdAt: Date.now() },
  ]);
  return { id, key };
}

/** Preserve payload-based retry identity for correction, bill, and statement forms. */
export async function pendingSubmissionKey(
  userId: string,
  operation: string,
  payload: unknown,
): Promise<string> {
  const digest = await fingerprint(payload);
  const existing = readEntries(storageKey(userId, operation)).find(
    (entry) => entry.fingerprint === digest,
  );
  if (existing) return existing.key;
  return (
    await beginPendingSubmission(
      userId,
      operation,
      crypto.randomUUID(),
      payload,
    )
  ).key;
}

export function listPendingSubmissions(
  userId: string,
  operation: string,
): PendingSubmissionRecord[] {
  return readEntries(storageKey(userId, operation)).map(
    ({ id, key, createdAt }) => ({ id, key, createdAt }),
  );
}

export async function pendingSubmissionMatchesPayload(
  userId: string,
  operation: string,
  submissionId: string,
  payload: unknown,
): Promise<boolean> {
  const digest = await fingerprint(payload);
  return readEntries(storageKey(userId, operation)).some(
    (entry) => entry.id === submissionId && entry.fingerprint === digest,
  );
}

/** Remove only the confirmed logical operation; retain every other unresolved submission. */
export function clearPendingSubmission(
  userId: string,
  operation: string,
  submissionKey: string,
): void {
  const key = storageKey(userId, operation);
  writeEntries(
    key,
    readEntries(key).filter((entry) => entry.key !== submissionKey),
  );
}
