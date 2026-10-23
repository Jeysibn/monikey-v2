const retentionMs = 30 * 24 * 60 * 60 * 1000;
const maximumEntries = 20;

type PendingSubmission = {
  fingerprint: string;
  key: string;
  createdAt: number;
};

const memory = new Map<string, PendingSubmission[]>();

function storageKey(userId: string, operation: string): string {
  return `monikey-v2.pending.${operation}.${userId}`;
}

function readEntries(key: string): PendingSubmission[] {
  let entries = memory.get(key) ?? [];
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (entry): entry is PendingSubmission =>
            typeof entry?.fingerprint === "string" &&
            typeof entry?.key === "string" &&
            typeof entry?.createdAt === "number",
        );
      }
    }
  } catch {
    // Keep the in-memory retry identity when browser storage is unavailable.
  }
  const cutoff = Date.now() - retentionMs;
  return entries
    .filter((entry) => entry.createdAt >= cutoff)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, maximumEntries);
}

function writeEntries(key: string, entries: PendingSubmission[]): void {
  const bounded = entries
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, maximumEntries);
  memory.set(key, bounded);
  try {
    if (bounded.length) sessionStorage.setItem(key, JSON.stringify(bounded));
    else sessionStorage.removeItem(key);
  } catch {
    // The in-memory record still protects retries for this page lifetime.
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Reuse an unresolved key for this exact operation payload, including after refresh. */
export async function pendingSubmissionKey(
  userId: string,
  operation: string,
  payload: unknown,
): Promise<string> {
  const key = storageKey(userId, operation);
  const digest = await fingerprint(payload);
  const entries = readEntries(key);
  const existing = entries.find((entry) => entry.fingerprint === digest);
  if (existing) {
    writeEntries(key, entries);
    return existing.key;
  }
  const next = {
    fingerprint: digest,
    key: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  writeEntries(key, [next, ...entries]);
  return next.key;
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
