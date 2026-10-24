import type { PendingSubmissionRecord } from "../lib/pending-submissions";

const manilaTime = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
  timeStyle: "short",
});

export function PendingSubmissionRecovery({
  matches,
  selectedId,
  operationLabel,
  canRetry,
  onSelect,
  onStartNew,
}: {
  matches: PendingSubmissionRecord[];
  selectedId: string | null;
  operationLabel: string;
  canRetry: (id: string) => boolean;
  onSelect: (id: string) => void;
  onStartNew: () => void;
}) {
  if (matches.length === 0) return null;
  return (
    <details className="pending-recovery">
      <summary>
        Check {matches.length === 1 ? "a saved attempt" : "saved attempts"}
      </summary>
      <p>
        Saved attempt details stay private in this browser. Re-enter the
        original details to replay one, or start a separate {operationLabel}.
      </p>
      <div className="pending-recovery-actions">
        {matches.map((match) => (
          <button
            className="quiet-button"
            type="button"
            aria-pressed={selectedId === match.id}
            key={match.id}
            onClick={() => canRetry(match.id) && onSelect(match.id)}
            disabled={!canRetry(match.id)}
          >
            {selectedId === match.id
              ? "Selected saved attempt"
              : "Retry saved attempt"}
            <span>{manilaTime.format(match.createdAt)}</span>
          </button>
        ))}
        <button
          className="quiet-link pending-recovery-new"
          type="button"
          onClick={onStartNew}
          disabled={!matches.some((match) => canRetry(match.id))}
        >
          Start a separate {operationLabel}
        </button>
      </div>
    </details>
  );
}
