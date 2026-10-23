import { useCallback, useEffect, useRef, useState } from "react";

type ResourceState<T> = {
  key: string;
  data: T | null;
  error: string;
  errorStatus: number | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  updatedAt: number | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

/** A small request lifecycle for screens where old financial data must be marked stale. */
export function useLatestResource<T>(
  key: string,
  loader: () => Promise<T>,
  enabled = true,
) {
  const sequence = useRef(0);
  const [state, setState] = useState<ResourceState<T>>({
    key,
    data: null,
    error: "",
    errorStatus: null,
    loading: enabled,
    refreshing: false,
    stale: false,
    updatedAt: null,
  });

  const reload = useCallback(async () => {
    if (!enabled) return;
    const request = ++sequence.current;
    setState((current) => {
      const sameKey = current.key === key;
      return {
        key,
        data: sameKey ? current.data : null,
        error: "",
        errorStatus: null,
        loading: !(sameKey && current.data),
        refreshing: Boolean(sameKey && current.data),
        stale: sameKey && current.stale,
        updatedAt: sameKey ? current.updatedAt : null,
      };
    });
    try {
      const data = await loader();
      if (sequence.current !== request) return;
      setState({
        key,
        data,
        error: "",
        errorStatus: null,
        loading: false,
        refreshing: false,
        stale: false,
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (sequence.current !== request) return;
      setState((current) => {
        const sameKey = current.key === key;
        return {
          key,
          data: sameKey ? current.data : null,
          error: errorMessage(error),
          errorStatus:
            error &&
            typeof error === "object" &&
            "status" in error &&
            typeof error.status === "number"
              ? error.status
              : null,
          loading: false,
          refreshing: false,
          stale: Boolean(sameKey && current.data),
          updatedAt: sameKey ? current.updatedAt : null,
        };
      });
    }
  }, [enabled, key, loader]);

  useEffect(() => {
    void reload();
    return () => {
      sequence.current += 1;
    };
  }, [reload]);

  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : "",
    errorStatus: current ? state.errorStatus : null,
    loading: enabled && (!current || state.loading),
    refreshing: current && state.refreshing,
    stale: current && state.stale,
    updatedAt: current ? state.updatedAt : null,
    reload,
  };
}
