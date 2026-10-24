import { useCallback, useEffect, useState } from "react";
import {
  listPendingSubmissions,
  pendingSubmissionMatchesPayload,
  type PendingSubmissionRecord,
} from "../lib/pending-submissions";

export function usePendingSubmissionMatches(
  userId: string | undefined,
  operation: string,
  payload: unknown | null,
) {
  const key = `${userId ?? "signed-out"}:${operation}`;
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(
    () => setRefreshVersion((version) => version + 1),
    [],
  );
  const [state, setState] = useState<{
    key: string;
    matches: PendingSubmissionRecord[];
    payloadMatches: Set<string>;
  }>({ key: "", matches: [], payloadMatches: new Set() });

  useEffect(() => {
    if (!userId) {
      setState({ key, matches: [], payloadMatches: new Set() });
      return;
    }
    let active = true;
    const entries = listPendingSubmissions(userId, operation);
    setState({ key, matches: entries, payloadMatches: new Set() });
    if (payload !== null) {
      for (const entry of entries) {
        void pendingSubmissionMatchesPayload(
          userId,
          operation,
          entry.id,
          payload,
        ).then((matches) => {
          if (active && matches)
            setState((current) => {
              if (current.key !== key) return current;
              return {
                ...current,
                payloadMatches: new Set(current.payloadMatches).add(entry.id),
              };
            });
        });
      }
    }
    return () => {
      active = false;
    };
  }, [key, operation, payload, refreshVersion, userId]);

  return state.key === key
    ? { entries: state.matches, payloadMatches: state.payloadMatches, refresh }
    : { entries: [], payloadMatches: new Set<string>(), refresh };
}
