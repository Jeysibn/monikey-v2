import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiRequestError, apiRequest } from "../../shared/lib/api-request";

type Theme = "light" | "dark";

export type Profile = {
  user: {
    id: string;
    emailNormalized: string;
    timezone: "Asia/Manila";
    currency: "PHP";
    theme: Theme | "system";
    hideBalances: boolean;
  };
  serverToday: string;
  onboardingStatus: "NEEDS_FIRST_ACCOUNT" | "READY";
};

type AuthContextValue = {
  profile: Profile | null;
  loading: boolean;
  sessionStatus: "checking" | "authenticated" | "anonymous" | "unavailable";
  csrfToken: string | null;
  login: (email: string, password: string) => Promise<Profile>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
  retrySession: () => Promise<Profile | null>;
  createFirstAccount: (
    request: {
      type: "CASH" | "BANK" | "EWALLET" | "CREDIT_CARD";
      name: string;
      openingBalanceMinor: string;
      institution?: string;
    },
    idempotencyKey: string,
  ) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const sessionChannelName = "monikey-v2-session";

function broadcastSessionEvent(
  type: "changing" | "changed" | "ended",
  senderId: string,
) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(sessionChannelName);
  channel.postMessage({ type, senderId });
  channel.close();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionStatus, setSessionStatus] =
    useState<AuthContextValue["sessionStatus"]>("checking");
  const requestSequence = useRef(0);
  const sessionInstanceId = useRef(crypto.randomUUID());

  const updateProfile = useCallback((nextProfile: Profile | null) => {
    setProfile(nextProfile);
  }, []);

  const refreshProfile = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setCsrfToken(null);
    try {
      const result = await apiRequest<Profile>("/me");
      if (requestId !== requestSequence.current) return null;
      // Cookies are shared between tabs. If another tab signed in as a
      // different owner, remove the old owner's view before any later request
      // (including CSRF refresh) can fail.
      setProfile((current) =>
        current && current.user.id !== result.user.id ? null : current,
      );
      const csrf = await apiRequest<{ csrfToken: string }>("/auth/csrf");
      if (requestId !== requestSequence.current) return null;
      setCsrfToken(csrf.csrfToken);
      updateProfile(result);
      setSessionStatus("authenticated");
      return result;
    } catch (caught) {
      if (requestId !== requestSequence.current) return null;
      if (caught instanceof ApiRequestError && caught.status === 401) {
        updateProfile(null);
        setSessionStatus("anonymous");
        broadcastSessionEvent("ended", sessionInstanceId.current);
      } else {
        setSessionStatus("unavailable");
      }
      setCsrfToken(null);
      return null;
    }
  }, [updateProfile]);

  useEffect(() => {
    void refreshProfile().finally(() => setLoading(false));
  }, [refreshProfile]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(sessionChannelName);
    channel.onmessage = (
      event: MessageEvent<{ type?: string; senderId?: string }>,
    ) => {
      if (event.data?.senderId === sessionInstanceId.current) return;
      if (event.data?.type === "changing" || event.data?.type === "ended") {
        requestSequence.current += 1;
        updateProfile(null);
        setCsrfToken(null);
        setSessionStatus(
          event.data.type === "ended" ? "anonymous" : "checking",
        );
      } else if (event.data?.type === "changed") {
        void refreshProfile();
      }
    };
    return () => channel.close();
  }, [refreshProfile, updateProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      loading,
      sessionStatus,
      csrfToken,
      async login(email, password) {
        const requestId = ++requestSequence.current;
        // A login can rotate the shared cookie to a different owner. Remove
        // user-scoped state in this tab and notify other tabs before starting.
        broadcastSessionEvent("changing", sessionInstanceId.current);
        updateProfile(null);
        setCsrfToken(null);
        setSessionStatus("checking");
        let login: { csrfToken: string };
        try {
          login = await apiRequest<{ csrfToken: string }>("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
        } catch (caught) {
          if (requestId === requestSequence.current) {
            setSessionStatus(
              caught instanceof ApiRequestError && caught.status === 401
                ? "anonymous"
                : "unavailable",
            );
          }
          broadcastSessionEvent("changed", sessionInstanceId.current);
          throw caught;
        }
        let nextProfile: Profile;
        try {
          nextProfile = await apiRequest<Profile>("/me");
        } catch (caught) {
          if (requestId === requestSequence.current) {
            setCsrfToken(null);
            setSessionStatus("unavailable");
          }
          broadcastSessionEvent("changed", sessionInstanceId.current);
          throw caught;
        }
        if (requestId !== requestSequence.current)
          throw new Error("The session changed before sign-in completed.");
        setCsrfToken(login.csrfToken);
        updateProfile(nextProfile);
        setSessionStatus("authenticated");
        broadcastSessionEvent("changed", sessionInstanceId.current);
        return nextProfile;
      },
      async logout() {
        const requestId = ++requestSequence.current;
        const token = csrfToken;
        broadcastSessionEvent("ended", sessionInstanceId.current);
        updateProfile(null);
        setCsrfToken(null);
        setSessionStatus("anonymous");
        if (token) {
          try {
            await apiRequest("/auth/logout", {
              method: "POST",
              headers: { "x-csrf-token": token },
            });
          } catch (caught) {
            if (requestId === requestSequence.current) throw caught;
          }
        }
      },
      refreshProfile,
      retrySession: refreshProfile,
      async createFirstAccount(request, idempotencyKey) {
        if (!profile || !csrfToken)
          throw new Error("Your session needs to be refreshed.");
        await apiRequest("/onboarding/first-account", {
          method: "POST",
          headers: {
            "x-csrf-token": csrfToken,
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(request),
        });
        // The account may have committed even if profile refresh is temporarily
        // unavailable. Keep the caller's submission identity so retry can replay
        // the same idempotent onboarding operation and reconcile the profile.
        if (!(await refreshProfile())) {
          throw new Error(
            "Your first account was created, but the profile could not be refreshed. Retry to confirm it.",
          );
        }
      },
    }),
    [csrfToken, loading, profile, refreshProfile, sessionStatus, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required.");
  return context;
}
