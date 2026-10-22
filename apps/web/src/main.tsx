import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router";
import {
  AmountEntry,
  MoneyValue,
  PrivacyMask,
  ReferenceSelect,
} from "./components";
import { formatPhp, moneyMinor, parsePhpMinor } from "@monikey/money";
import "./style.css";

type Theme = "light" | "dark";

const primaryNavigation = [
  { label: "Home", to: "/app", symbol: "⌂", end: true },
  { label: "Activity", to: "/app/activity", symbol: "◷" },
  { label: "Add", to: "/app/transactions/new", symbol: "+", action: true },
  { label: "Accounts", to: "/app/accounts", symbol: "▤" },
];

const secondaryNavigation = [
  { label: "Bills", to: "/app/bills", symbol: "□" },
  { label: "Reports", to: "/app/reports", symbol: "▥" },
  { label: "Settings", to: "/app/settings", symbol: "⚙" },
];

const pageTitles: Record<string, string> = {
  "/app": "Home",
  "/app/activity": "Activity",
  "/app/transactions/new": "Quick add",
  "/app/accounts": "Accounts",
  "/app/bills": "Bills",
  "/app/reports": "Reports",
  "/app/settings": "Settings",
  "/app/settings/categories": "Categories",
  "/app/settings/security": "Security",
  "/login": "Sign in",
  "/onboarding": "First account",
};

type Profile = {
  user: {
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
  csrfToken: string | null;
  login: (email: string, password: string) => Promise<Profile>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
  createFirstAccount: (request: {
    type: "CASH" | "BANK" | "EWALLET" | "CREDIT_CARD";
    name: string;
    openingBalanceMinor: string;
    institution?: string;
  }) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? "The request could not be completed.",
    );
  }
  return payload as T;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const result = await apiRequest<Profile>("/me");
      const csrf = await apiRequest<{ csrfToken: string }>("/auth/csrf");
      setCsrfToken(csrf.csrfToken);
      setProfile(result);
      return result;
    } catch {
      setProfile(null);
      setCsrfToken(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshProfile().finally(() => setLoading(false));
  }, [refreshProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      loading,
      csrfToken,
      async login(email, password) {
        const login = await apiRequest<{ csrfToken: string }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setCsrfToken(login.csrfToken);
        const nextProfile = await apiRequest<Profile>("/me");
        setProfile(nextProfile);
        return nextProfile;
      },
      async logout() {
        if (csrfToken) {
          await apiRequest("/auth/logout", {
            method: "POST",
            headers: { "x-csrf-token": csrfToken },
          });
        }
        setProfile(null);
        setCsrfToken(null);
      },
      refreshProfile,
      async createFirstAccount(request) {
        if (!csrfToken) throw new Error("Your session needs to be refreshed.");
        await apiRequest("/onboarding/first-account", {
          method: "POST",
          headers: {
            "x-csrf-token": csrfToken,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(request),
        });
        await refreshProfile();
      },
    }),
    [csrfToken, loading, profile, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required.");
  return context;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  return online;
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem("monikey-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("monikey-theme", theme);
    const themeColor =
      document.querySelector<HTMLMetaElement>("[data-theme-color]");
    const pageSurface = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface-page")
      .trim();
    if (themeColor && pageSurface) themeColor.content = pageSurface;
  }, [theme]);

  return [
    theme,
    () => setTheme((current) => (current === "light" ? "dark" : "light")),
  ];
}

function Brand() {
  return (
    <Link className="brand" to="/app" aria-label="MoniKey home">
      <span className="brand-mark" aria-hidden="true">
        M
      </span>
      <span className="brand-name">monikey</span>
      <span className="brand-version">V2</span>
    </Link>
  );
}

function NavigationLink({
  label,
  to,
  symbol,
  end,
  action = false,
}: {
  label: string;
  to: string;
  symbol: string;
  end?: boolean;
  action?: boolean;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        `nav-link${isActive ? " is-active" : ""}${action ? " nav-action" : ""}`
      }
      to={to}
      {...(end ? { end: true } : {})}
      {...(action ? { "aria-label": "Add transaction" } : {})}
    >
      <span className="nav-symbol" aria-hidden="true">
        {symbol}
      </span>
      <span>{label}</span>
    </NavLink>
  );
}

function AppShell() {
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const { profile, logout } = useAuth();
  const isOnline = useOnlineStatus();
  const pageTitle =
    pageTitles[location.pathname] ??
    (location.pathname.includes("/statements")
      ? "Statements"
      : location.pathname.includes("/transactions/")
        ? "Transaction details"
        : location.pathname.includes("/accounts/")
          ? "Account details"
          : "MoniKey");

  return (
    <div className="app-shell">
      <aside className="desktop-rail" aria-label="Main navigation">
        <Brand />
        <nav className="rail-nav" aria-label="Primary">
          {primaryNavigation.map((item) => (
            <NavigationLink key={item.to} {...item} />
          ))}
        </nav>
        <div className="rail-divider" />
        <nav className="rail-nav secondary-nav" aria-label="More">
          {secondaryNavigation.map((item) => (
            <NavigationLink key={item.to} {...item} />
          ))}
        </nav>
        <div className="rail-bottom">
          <button
            className="theme-button"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            <span aria-hidden="true">{theme === "light" ? "◐" : "☼"}</span>
            <span>{theme === "light" ? "Dark theme" : "Light theme"}</span>
          </button>
          <p className="rail-caption">Personal finance, clearly.</p>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand-wrap">
            <Brand />
          </div>
          <div className="desktop-page-title" aria-live="polite">
            {pageTitle}
          </div>
          <details className="mobile-more-menu">
            <summary aria-label="Open more pages">
              <span aria-hidden="true">···</span>
            </summary>
            <nav aria-label="More pages">
              {secondaryNavigation.map((item) => (
                <NavigationLink key={item.to} {...item} />
              ))}
            </nav>
          </details>
          <button
            className="mobile-theme-button"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            <span aria-hidden="true">{theme === "light" ? "◐" : "☼"}</span>
          </button>
          <Link
            className="profile-chip"
            to={profile ? "/app/settings" : "/login"}
          >
            <span className="profile-dot" aria-hidden="true" />
            <span>
              {profile ? profile.user.emailNormalized : "Private space"}
            </span>
          </Link>
        </header>

        <main className="page-content" id="main-content">
          {!isOnline ? (
            <div className="connection-notice" role="alert">
              <span className="notice-mark" aria-hidden="true">
                !
              </span>
              <span>
                Offline. Financial submissions are disabled until the connection
                returns.
              </span>
            </div>
          ) : null}
          <div className="preview-notice" role="status">
            <span className="notice-mark" aria-hidden="true">
              i
            </span>
            <span>
              {profile
                ? "Private session active. Financial records are stored in your journal."
                : "Foundation preview. Sign-in and financial records are not active yet."}
            </span>
          </div>
          {profile ? (
            <button
              className="session-link"
              type="button"
              onClick={() => void logout()}
            >
              Sign out
            </button>
          ) : null}
          <Outlet />
        </main>

        <nav className="mobile-nav" aria-label="Primary navigation">
          {primaryNavigation.map((item) => (
            <NavigationLink key={item.to} {...item} />
          ))}
        </nav>
      </div>
    </div>
  );
}

function RoutePage({
  eyebrow,
  title,
  description,
  icon,
  linkTo = "/app",
  linkLabel = "Back to Home",
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
  linkTo?: string;
  linkLabel?: string;
}) {
  return (
    <section className="route-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="page-heading">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <div className="empty-panel">
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="empty-copy">
          <p className="empty-title">Nothing to show yet</p>
          <p>
            This area will use your saved records once sign-in and real account
            workflows are ready. No sample balances or transactions are shown.
          </p>
        </div>
        <Link className="quiet-link" to={linkTo}>
          {linkLabel}
        </Link>
      </div>
    </section>
  );
}

function HomePage() {
  const { profile, loading } = useAuth();

  if (loading) {
    return <DashboardLoading />;
  }

  if (profile) {
    return <DashboardHome profile={profile} />;
  }

  return (
    <section className="home-page" aria-labelledby="page-heading">
      <div className="page-intro home-intro">
        <p className="eyebrow">A clearer view of your money</p>
        <h1 id="page-heading">Your money, in balance.</h1>
        <p className="page-description">
          A calm place for your everyday finances. Start with a real account
          when private sign-in is ready.
        </p>
      </div>
      <div className="home-grid">
        <div className="welcome-card">
          <div className="welcome-topline">
            <span className="welcome-kicker">YOUR PRIVATE FINANCE SPACE</span>
            <span className="welcome-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
          <h2>Built to help you trust every number.</h2>
          <p>
            MoniKey V2 is being built around a real, balanced ledger. Your
            dashboard will only show figures backed by your own saved records.
          </p>
          <div className="welcome-footnote">
            <span className="status-dot" />
            <span>Ready for the first real account</span>
          </div>
        </div>
        <aside className="privacy-card">
          <span className="privacy-icon" aria-hidden="true">
            ◇
          </span>
          <p className="privacy-title">Private by design</p>
          <p>
            This first version is for one person. Your data stays separate from
            MoniKey V1.
          </p>
          <Link to="/login" className="text-link">
            About private access <span aria-hidden="true">↗</span>
          </Link>
        </aside>
        <div className="home-lower-note">
          <span className="lower-rule" />
          <p>Designed for PHP · Asia/Manila</p>
          <span className="lower-rule" />
        </div>
      </div>
    </section>
  );
}

type DashboardAccount = {
  id: string;
  type: "CASH" | "BANK" | "EWALLET" | "CREDIT_CARD";
  name: string;
  balanceMinor: string;
  archivedAt: string | null;
};

type DashboardActivity = {
  transaction: {
    id: string;
    kind:
      | "OPENING_BALANCE"
      | "INCOME"
      | "EXPENSE"
      | "TRANSFER"
      | "REFUND"
      | "ADJUSTMENT"
      | "CARD_PAYMENT";
    status: "POSTED" | "VOID";
    currentRevision: number;
    occurredOn: string;
    categoryId: string | null;
    refundedTransactionId: string | null;
    note: string | null;
  };
  revision: Record<string, unknown>;
  createdAt: string;
};

type DashboardSummaryResponse = {
  availableMoneyMinor: string;
  cardDebtMinor: string;
  netFinancialPositionMinor: string;
  month: string;
  incomeMinor: string;
  spendingMinor: string;
  accounts: DashboardAccount[];
  recentActivity: DashboardActivity[];
  serverToday: string;
};

function dashboardMoney(value: string) {
  return <MoneyValue amount={moneyMinor(value)} />;
}

function phpInputFromMinor(value: string): string {
  const amount = moneyMinor(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n)
    .toString()
    .padStart(2, "0")}`;
}

function dashboardAccountType(type: DashboardAccount["type"]): string {
  return {
    CASH: "Cash",
    BANK: "Bank",
    EWALLET: "E-wallet",
    CREDIT_CARD: "Credit card",
  }[type];
}

function dashboardActivityAmount(activity: DashboardActivity): string | null {
  const amount = activity.revision.amountMinor;
  return typeof amount === "string" && /^-?\d+$/.test(amount) ? amount : null;
}

function dashboardActivityLabel(activity: DashboardActivity): string {
  if (activity.transaction.note) return activity.transaction.note;
  return {
    OPENING_BALANCE: "Opening balance",
    INCOME: "Income",
    EXPENSE: "Expense",
    TRANSFER: "Transfer",
    REFUND: "Refund",
    ADJUSTMENT: "Adjustment",
    CARD_PAYMENT: "Card payment",
  }[activity.transaction.kind];
}

function DashboardLoading() {
  return (
    <section className="dashboard-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Private dashboard</p>
        <h1 id="page-heading">Your money, in balance.</h1>
        <p className="page-description">Loading your saved figures…</p>
      </div>
      <div
        className="dashboard-skeleton"
        aria-label="Loading dashboard"
        role="status"
      >
        <span className="skeleton-line skeleton-line-wide" />
        <span className="skeleton-line" />
        <span className="skeleton-line skeleton-line-short" />
      </div>
    </section>
  );
}

function DashboardHome({ profile }: { profile: Profile }) {
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSummary(
        await apiRequest<DashboardSummaryResponse>("/dashboard/summary"),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your dashboard could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  if (loading && !summary) return <DashboardLoading />;

  return (
    <section className="dashboard-page" aria-labelledby="page-heading">
      <div className="dashboard-heading">
        <div className="page-intro">
          <p className="eyebrow">Private dashboard · {profile.user.currency}</p>
          <h1 id="page-heading">Your money, in balance.</h1>
          <p className="page-description">
            A current view of the accounts and journals that belong to you.
          </p>
        </div>
        <Link className="dashboard-primary-action" to="/app/transactions/new">
          <span aria-hidden="true">+</span> Add transaction
        </Link>
      </div>

      {error ? (
        <div className="dashboard-error" role="alert">
          <div>
            <strong>Dashboard unavailable</strong>
            <p>{error}</p>
          </div>
          <button
            type="button"
            className="quiet-button"
            onClick={() => void loadSummary()}
          >
            Try again
          </button>
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="dashboard-hero">
            <div>
              <p className="dashboard-label">Available money</p>
              <div className="dashboard-balance">
                <PrivacyMask label="available money">
                  {dashboardMoney(summary.availableMoneyMinor)}
                </PrivacyMask>
              </div>
              <p className="dashboard-helper">
                Cash, bank, and e-wallet balances · {summary.serverToday}
              </p>
            </div>
            <div className="dashboard-hero-meta">
              <span className="status-dot" aria-hidden="true" />
              <span>Posted journal totals</span>
            </div>
          </div>

          <div className="dashboard-stat-grid" aria-label="Financial summary">
            <div className="dashboard-stat">
              <p className="dashboard-label">Net position</p>
              <PrivacyMask label="net financial position">
                {dashboardMoney(summary.netFinancialPositionMinor)}
              </PrivacyMask>
              <p className="dashboard-helper">After card debt</p>
            </div>
            <div className="dashboard-stat">
              <p className="dashboard-label">Card debt</p>
              <PrivacyMask label="card debt">
                {dashboardMoney(summary.cardDebtMinor)}
              </PrivacyMask>
              <p className="dashboard-helper">Current liability balance</p>
            </div>
            <div className="dashboard-stat">
              <p className="dashboard-label">This month</p>
              <p className="dashboard-stat-line dashboard-income">
                <span>Income</span>
                {dashboardMoney(summary.incomeMinor)}
              </p>
              <p className="dashboard-stat-line dashboard-expense">
                <span>Spending</span>
                {dashboardMoney(summary.spendingMinor)}
              </p>
              <p className="dashboard-helper">{summary.month}</p>
            </div>
          </div>

          <div className="dashboard-columns">
            <section
              className="dashboard-panel"
              aria-labelledby="accounts-heading"
            >
              <div className="dashboard-panel-heading">
                <div>
                  <p className="dashboard-label">Your accounts</p>
                  <h2 id="accounts-heading">Balances at a glance</h2>
                </div>
                <Link className="quiet-link" to="/app/accounts">
                  View all
                </Link>
              </div>
              {summary.accounts.length ? (
                <div className="account-list">
                  {summary.accounts.map((account) => (
                    <Link
                      className="account-row"
                      key={account.id}
                      to={`/app/accounts/${account.id}`}
                    >
                      <span className="account-mark" aria-hidden="true">
                        {account.type === "CREDIT_CARD" ? "◇" : "•"}
                      </span>
                      <span className="account-copy">
                        <strong>{account.name}</strong>
                        <span>{dashboardAccountType(account.type)}</span>
                      </span>
                      <span className="account-balance">
                        <PrivacyMask label={`${account.name} balance`}>
                          {dashboardMoney(account.balanceMinor)}
                        </PrivacyMask>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="dashboard-empty">
                  <p>No accounts yet.</p>
                  <Link className="quiet-link" to="/onboarding">
                    Create your first account
                  </Link>
                </div>
              )}
            </section>

            <section
              className="dashboard-panel"
              aria-labelledby="activity-heading"
            >
              <div className="dashboard-panel-heading">
                <div>
                  <p className="dashboard-label">Latest records</p>
                  <h2 id="activity-heading">Recent activity</h2>
                </div>
                <Link className="quiet-link" to="/app/activity">
                  View all
                </Link>
              </div>
              {summary.recentActivity.length ? (
                <div className="activity-list">
                  {summary.recentActivity.map((activity) => {
                    const amount = dashboardActivityAmount(activity);
                    const isIncome = ["INCOME", "REFUND"].includes(
                      activity.transaction.kind,
                    );
                    return (
                      <Link
                        className="activity-row"
                        key={activity.transaction.id}
                        to={`/app/transactions/${activity.transaction.id}`}
                      >
                        <span className="activity-kind" aria-hidden="true">
                          {isIncome
                            ? "↑"
                            : activity.transaction.kind === "EXPENSE"
                              ? "↓"
                              : "↔"}
                        </span>
                        <span className="activity-copy">
                          <strong>{dashboardActivityLabel(activity)}</strong>
                          <span>
                            {activity.transaction.occurredOn} ·{" "}
                            {activity.transaction.status === "VOID"
                              ? "Voided"
                              : activity.transaction.kind.replaceAll("_", " ")}
                          </span>
                        </span>
                        <span
                          className={`activity-amount${isIncome ? " is-income" : ""}`}
                        >
                          {amount ? (
                            <PrivacyMask label="activity amount">
                              {dashboardMoney(amount)}
                            </PrivacyMask>
                          ) : (
                            "—"
                          )}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="dashboard-empty">
                  <p>Transactions will appear here after you record one.</p>
                  <Link className="quiet-link" to="/app/transactions/new">
                    Add a transaction
                  </Link>
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}

type ActivityFilters = {
  search: string;
  from: string;
  to: string;
  kind: string;
  accountId: string;
  categoryId: string;
};

const activityKinds = [
  "OPENING_BALANCE",
  "INCOME",
  "EXPENSE",
  "TRANSFER",
  "REFUND",
  "ADJUSTMENT",
  "CARD_PAYMENT",
] as const;

function activityFiltersFromParams(params: URLSearchParams): ActivityFilters {
  return {
    search: params.get("search") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    kind: params.get("kind") ?? "",
    accountId: params.get("accountId") ?? "",
    categoryId: params.get("categoryId") ?? "",
  };
}

function activityFilterParams(filters: ActivityFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params;
}

function formatActivityKind(kind: string): string {
  return kind
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^| )\S/g, (letter) => letter.toUpperCase());
}

function revisionText(revision: Record<string, unknown>, key: string): string {
  const value = revision[key];
  return typeof value === "string" ? value : "";
}

function activityAccountIds(revision: Record<string, unknown>): string[] {
  return ["sourceAccountId", "accountId", "fromAccountId", "toAccountId"]
    .map((key) => revisionText(revision, key))
    .filter(Boolean);
}

function ActivityPage() {
  const { profile, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();
  const [filters, setFilters] = useState<ActivityFilters>(() =>
    activityFiltersFromParams(searchParams),
  );
  const [accounts, setAccounts] = useState<DashboardAccount[]>([]);
  const [categories, setCategories] = useState<QuickAddCategory[]>([]);
  const [activity, setActivity] = useState<DashboardActivity[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    const urlFilters = activityFiltersFromParams(searchParams);
    setFilters(urlFilters);
    setLoading(true);
    setError("");
    const query = new URLSearchParams(searchParams);
    query.set("limit", "25");
    void Promise.all([
      apiRequest<{ activity: DashboardActivity[]; nextCursor: string | null }>(
        `/transactions?${query.toString()}`,
      ),
      apiRequest<{ accounts: DashboardAccount[] }>("/accounts"),
      apiRequest<{ categories: QuickAddCategory[] }>("/categories"),
    ])
      .then(([activityResult, accountResult, categoryResult]) => {
        setActivity(activityResult.activity);
        setNextCursor(activityResult.nextCursor);
        setAccounts(accountResult.accounts);
        setCategories(categoryResult.categories);
      })
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Activity could not be loaded.",
        );
      })
      .finally(() => setLoading(false));
  }, [paramsKey, profile]);

  function updateFilter(key: keyof ActivityFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchParams(activityFilterParams(filters));
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams());
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    const query = activityFilterParams(filters);
    query.set("limit", "25");
    query.set("cursor", nextCursor);
    try {
      const result = await apiRequest<{
        activity: DashboardActivity[];
        nextCursor: string | null;
      }>(`/transactions?${query.toString()}`);
      setActivity((current) => [...current, ...result.activity]);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "More activity could not be loaded.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const accountNames = new Map(
    accounts.map((account) => [account.id, account.name]),
  );
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name]),
  );

  if (authLoading) return <DashboardLoading />;
  if (!profile) {
    return (
      <RoutePage
        eyebrow="Your timeline"
        title="Activity"
        description="Activity is private and only loads records owned by the signed-in account."
        icon="◷"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }

  return (
    <section className="activity-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Your timeline · Private</p>
        <h1 id="page-heading">Activity that stays traceable.</h1>
        <p className="page-description">
          Search and filter the posted records behind your balances. Open any
          row to inspect its revision and correct or reverse it safely.
        </p>
      </div>

      <form className="activity-filter-panel" onSubmit={applyFilters}>
        <div className="activity-filter-grid">
          <label className="field-group activity-search-field">
            <span className="field-label">Search</span>
            <input
              className="text-input"
              type="search"
              value={filters.search}
              onChange={(event) =>
                updateFilter("search", event.currentTarget.value)
              }
              placeholder="Notes or labels"
            />
          </label>
          <label className="field-group">
            <span className="field-label">Type</span>
            <select
              className="reference-select"
              value={filters.kind}
              onChange={(event) =>
                updateFilter("kind", event.currentTarget.value)
              }
            >
              <option value="">All types</option>
              {activityKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {formatActivityKind(kind)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">Account</span>
            <select
              className="reference-select"
              value={filters.accountId}
              onChange={(event) =>
                updateFilter("accountId", event.currentTarget.value)
              }
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">Category</span>
            <select
              className="reference-select"
              value={filters.categoryId}
              onChange={(event) =>
                updateFilter("categoryId", event.currentTarget.value)
              }
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">From</span>
            <input
              className="text-input"
              type="date"
              value={filters.from}
              onChange={(event) =>
                updateFilter("from", event.currentTarget.value)
              }
            />
          </label>
          <label className="field-group">
            <span className="field-label">To</span>
            <input
              className="text-input"
              type="date"
              value={filters.to}
              onChange={(event) =>
                updateFilter("to", event.currentTarget.value)
              }
            />
          </label>
        </div>
        <div className="activity-filter-actions">
          <button className="save-button" type="submit">
            Apply filters
          </button>
          <button className="quiet-button" type="button" onClick={clearFilters}>
            Clear
          </button>
        </div>
      </form>

      {error ? (
        <div className="dashboard-error" role="alert">
          <div>
            <strong>Activity unavailable</strong>
            <p>{error}</p>
          </div>
          <button
            type="button"
            className="quiet-button"
            onClick={() => setSearchParams(new URLSearchParams(searchParams))}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="activity-results" aria-live="polite">
        {loading ? (
          <div className="dashboard-skeleton" role="status">
            <span className="skeleton-line skeleton-line-wide" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
          </div>
        ) : activity.length ? (
          <div className="activity-feed">
            {activity.map((item) => {
              const amount = dashboardActivityAmount(item);
              const ids = activityAccountIds(item.revision);
              const accountLabel = ids
                .map((id) => accountNames.get(id))
                .filter(Boolean)
                .join(" → ");
              const categoryLabel = item.transaction.categoryId
                ? categoryNames.get(item.transaction.categoryId)
                : null;
              const isIncome = ["INCOME", "REFUND"].includes(
                item.transaction.kind,
              );
              return (
                <Link
                  className="activity-feed-row"
                  key={item.transaction.id}
                  to={`/app/transactions/${item.transaction.id}`}
                >
                  <span
                    className={`activity-kind${isIncome ? " is-income" : ""}`}
                    aria-hidden="true"
                  >
                    {isIncome
                      ? "↑"
                      : item.transaction.kind === "EXPENSE"
                        ? "↓"
                        : "↔"}
                  </span>
                  <span className="activity-feed-copy">
                    <strong>{dashboardActivityLabel(item)}</strong>
                    <span>
                      {item.transaction.occurredOn} ·{" "}
                      {formatActivityKind(item.transaction.kind)}
                      {accountLabel ? ` · ${accountLabel}` : ""}
                      {categoryLabel ? ` · ${categoryLabel}` : ""}
                    </span>
                  </span>
                  <span
                    className={`activity-feed-amount${isIncome ? " is-income" : ""}`}
                  >
                    {amount ? (
                      <PrivacyMask label="activity amount">
                        {dashboardMoney(amount)}
                      </PrivacyMask>
                    ) : (
                      "—"
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-empty activity-empty">
            <p>No records match these filters.</p>
            <button
              className="quiet-button"
              type="button"
              onClick={clearFilters}
            >
              Show all activity
            </button>
          </div>
        )}
      </div>
      {nextCursor ? (
        <button
          className="quiet-button activity-load-more"
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}

type TransactionAuditRevision = {
  version: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  reason: string | null;
  createdAt: string;
};

type AccountRecord = DashboardAccount & {
  institution: string | null;
  currency: "PHP";
  sortOrder: number;
  creditLimitMinor: string | null;
  statementDay: number | null;
  dueDay: number | null;
};

function TransactionDetailPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const { csrfToken, profile, loading: authLoading } = useAuth();
  const [transaction, setTransaction] = useState<
    DashboardActivity["transaction"] | null
  >(null);
  const [revisions, setRevisions] = useState<TransactionAuditRevision[]>([]);
  const [accounts, setAccounts] = useState<DashboardAccount[]>([]);
  const [categories, setCategories] = useState<QuickAddCategory[]>([]);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    if (!transactionId || !profile) return;
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const [detail, audit, accountResult, categoryResult] = await Promise.all([
        apiRequest<{ transaction: DashboardActivity["transaction"] }>(
          `/transactions/${transactionId}`,
        ),
        apiRequest<{
          transaction: DashboardActivity["transaction"];
          revisions: TransactionAuditRevision[];
        }>(`/transactions/${transactionId}/audit`),
        apiRequest<{ accounts: DashboardAccount[] }>(
          "/accounts?includeArchived=true",
        ),
        apiRequest<{ categories: QuickAddCategory[] }>(
          "/categories?includeArchived=true",
        ),
      ]);
      if (version !== loadVersion.current) return;
      setTransaction(detail.transaction);
      setRevisions(audit.revisions);
      setAccounts(accountResult.accounts);
      setCategories(categoryResult.categories);
      const current = audit.revisions.at(-1)?.after ?? {};
      const currentAmount = revisionText(current, "amountMinor");
      setAmount(currentAmount ? phpInputFromMinor(currentAmount) : "");
      setAccountId(
        revisionText(current, "sourceAccountId") ||
          revisionText(current, "accountId"),
      );
      setCategoryId(
        detail.transaction.categoryId ?? revisionText(current, "categoryId"),
      );
      setOccurredOn(detail.transaction.occurredOn);
      setNote(detail.transaction.note ?? revisionText(current, "note"));
    } catch (caught) {
      if (version !== loadVersion.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be loaded.",
      );
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [profile, transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!transactionId || !csrfToken || !transaction) return;
    if (!reason.trim()) {
      setError("Give the revision a reason.");
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = parsePhpMinor(amount).toString();
      if (BigInt(amountMinor) <= 0n) throw new Error("positive");
    } catch {
      setError("Enter a positive PHP amount with up to two decimals.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/transactions/${transactionId}`, {
        method: "PATCH",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          kind: transaction.kind,
          sourceAccountId: accountId,
          categoryId,
          amountMinor,
          occurredOn,
          ...(note.trim() ? { note: note.trim() } : {}),
          reason: reason.trim(),
        }),
      });
      setSuccess("Transaction updated and re-posted through the ledger.");
      setReason("");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be updated.",
      );
    } finally {
      setPending(false);
    }
  }

  async function reverseTransaction() {
    setError("");
    setSuccess("");
    if (!transactionId || !csrfToken || !reason.trim()) {
      setError("Give the reversal a reason.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/transactions/${transactionId}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setSuccess(
        "Transaction reversed. Its original journal remains immutable.",
      );
      setReason("");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be reversed.",
      );
    } finally {
      setPending(false);
    }
  }

  if (authLoading || loading) return <DashboardLoading />;
  if (!profile) {
    return (
      <RoutePage
        eyebrow="Activity"
        title="Sign in to review this record."
        description="Transaction details are private and only available to the owning account."
        icon="↗"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }
  if (error && !transaction) {
    return (
      <section className="route-page" aria-labelledby="page-heading">
        <div className="page-intro">
          <p className="eyebrow">Activity</p>
          <h1 id="page-heading">Transaction unavailable.</h1>
          <p className="page-description">{error}</p>
        </div>
        <Link className="quiet-link" to="/app/activity">
          Back to Activity
        </Link>
      </section>
    );
  }
  if (!transaction) return null;

  const currentRevision = revisions.at(-1)?.after ?? {};
  const editable =
    transaction.kind === "INCOME" || transaction.kind === "EXPENSE";
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const matchingCategories = categories.filter(
    (category) =>
      !category.archivedAt && (!editable || category.kind === transaction.kind),
  );

  return (
    <section
      className="route-page transaction-detail-page"
      aria-labelledby="page-heading"
    >
      <div className="page-intro">
        <p className="eyebrow">
          Activity · {formatActivityKind(transaction.kind)}
        </p>
        <h1 id="page-heading">Review this record.</h1>
        <p className="page-description">
          Revision {transaction.currentRevision} ·{" "}
          {transaction.status === "VOID" ? "Voided" : "Posted"}. Changes create
          compensating journals and keep the original history.
        </p>
      </div>
      <div className="transaction-detail-card">
        <div className="transaction-detail-summary">
          <span className="dashboard-label">Current amount</span>
          {revisionText(currentRevision, "amountMinor") ? (
            <PrivacyMask label="transaction amount">
              {dashboardMoney(revisionText(currentRevision, "amountMinor"))}
            </PrivacyMask>
          ) : (
            <strong>{formatActivityKind(transaction.kind)}</strong>
          )}
          <span className="dashboard-helper">
            {transaction.occurredOn}
            {transaction.note ? ` · ${transaction.note}` : ""}
          </span>
        </div>

        {success ? (
          <p className="form-success" role="status">
            {success}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        {editable && transaction.status === "POSTED" ? (
          <form className="detail-edit-form" onSubmit={submitEdit}>
            <div className="form-heading">
              <div>
                <p className="form-kicker">EDIT POSTED RECORD</p>
                <h2>Correct the details</h2>
              </div>
              <span className="form-kind">Ledger-safe</span>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="detail-amount">
                Amount *
              </label>
              <input
                className="text-input"
                id="detail-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.currentTarget.value)}
              />
            </div>
            <div className="reference-grid">
              <label className="field-group">
                <span className="field-label">Account *</span>
                <select
                  className="reference-select"
                  value={accountId}
                  onChange={(event) => setAccountId(event.currentTarget.value)}
                >
                  <option value="">Choose an account</option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-group">
                <span className="field-label">Category *</span>
                <select
                  className="reference-select"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.currentTarget.value)}
                >
                  <option value="">Choose a category</option>
                  {matchingCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="reference-grid">
              <label className="field-group">
                <span className="field-label">Date *</span>
                <input
                  className="text-input"
                  type="date"
                  value={occurredOn}
                  onChange={(event) => setOccurredOn(event.currentTarget.value)}
                />
              </label>
              <label className="field-group">
                <span className="field-label">Note</span>
                <input
                  className="text-input"
                  value={note}
                  onChange={(event) => setNote(event.currentTarget.value)}
                  maxLength={500}
                />
              </label>
            </div>
            <button className="save-button" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save revision"}
            </button>
          </form>
        ) : null}

        {transaction.status === "POSTED" ? (
          <label className="field-group detail-reason-field">
            <span className="field-label">Reason for edit or reversal *</span>
            <input
              className="text-input"
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              maxLength={300}
              placeholder="Corrected receipt or duplicate entry"
            />
          </label>
        ) : null}

        {transaction.status === "POSTED" ? (
          <div className="detail-reversal-panel">
            <p className="dashboard-label">Reverse this record</p>
            <p>
              Use a reversal when the posted record should no longer affect
              balances. The original journal stays immutable.
            </p>
            <button
              className="quiet-button"
              type="button"
              onClick={() => void reverseTransaction()}
              disabled={pending || !reason.trim()}
            >
              {pending ? "Reversing…" : "Reverse transaction"}
            </button>
            <p className="field-hint">
              The reason is saved in the immutable audit history.
            </p>
          </div>
        ) : null}

        <div className="revision-history">
          <div className="dashboard-panel-heading">
            <div>
              <p className="dashboard-label">Immutable history</p>
              <h2>Revisions</h2>
            </div>
          </div>
          {revisions.map((revision) => (
            <div className="revision-row" key={revision.version}>
              <strong>Revision {revision.version}</strong>
              <span>
                {new Date(revision.createdAt).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              <span>{revision.reason ?? "Original posting"}</span>
            </div>
          ))}
        </div>
      </div>
      <Link className="quiet-link" to="/app/activity">
        Back to Activity
      </Link>
    </section>
  );
}

function accountTypeLabel(type: DashboardAccount["type"]): string {
  return dashboardAccountType(type);
}

function AccountsPage() {
  const { profile, loading: authLoading, csrfToken } = useAuth();
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [type, setType] = useState<AccountRecord["type"]>("BANK");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ accounts: AccountRecord[] }>(
        "/accounts?includeArchived=true",
      );
      setAccounts(result.accounts);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Accounts could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!csrfToken) {
      setError("Your session needs to be refreshed.");
      return;
    }
    if (!name.trim()) {
      setError("Give the account a name.");
      return;
    }
    let openingBalanceMinor: string;
    try {
      openingBalanceMinor = parsePhpMinor(openingBalance || "0").toString();
      if (BigInt(openingBalanceMinor) < 0n) throw new Error("negative");
    } catch {
      setError("Enter a valid non-negative PHP opening balance.");
      return;
    }
    let creditLimitMinor: string | undefined;
    if (type === "CREDIT_CARD" && creditLimit.trim()) {
      try {
        creditLimitMinor = parsePhpMinor(creditLimit).toString();
        if (BigInt(creditLimitMinor) <= 0n) throw new Error("positive");
      } catch {
        setError("Enter a positive PHP credit limit.");
        return;
      }
    }
    setPending(true);
    try {
      await apiRequest("/accounts", {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          type,
          name: name.trim(),
          openingBalanceMinor,
          ...(institution.trim() ? { institution: institution.trim() } : {}),
          ...(creditLimitMinor ? { creditLimitMinor } : {}),
        }),
      });
      setName("");
      setInstitution("");
      setOpeningBalance("");
      setCreditLimit("");
      setShowCreate(false);
      setSuccess("Account created with a ledger-backed opening balance.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The account could not be created.",
      );
    } finally {
      setPending(false);
    }
  }

  if (authLoading || (loading && !accounts.length)) return <DashboardLoading />;
  if (!profile) {
    return (
      <RoutePage
        eyebrow="Your money"
        title="Accounts"
        description="Sign in to see balances that belong to your private journal."
        icon="▤"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }

  const visibleAccounts = accounts.filter(
    (account) => showArchived || !account.archivedAt,
  );

  return (
    <section className="accounts-page" aria-labelledby="page-heading">
      <div className="accounts-heading">
        <div className="page-intro">
          <p className="eyebrow">Your money · Private</p>
          <h1 id="page-heading">Accounts you can trace.</h1>
          <p className="page-description">
            Balances come from posted journals. Archive an account when it is no
            longer active and its history remains available.
          </p>
        </div>
        <button
          className="dashboard-primary-action"
          type="button"
          onClick={() => setShowCreate((current) => !current)}
        >
          <span aria-hidden="true">+</span>{" "}
          {showCreate ? "Close form" : "Add account"}
        </button>
      </div>

      {success ? (
        <p className="form-success" role="status">
          {success}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {showCreate ? (
        <form className="account-create-card" onSubmit={createAccount}>
          <div className="form-heading">
            <div>
              <p className="form-kicker">NEW ACCOUNT</p>
              <h2>Give every balance a home.</h2>
            </div>
            <span className="form-kind">PHP</span>
          </div>
          <div className="reference-grid">
            <label className="field-group">
              <span className="field-label">Type *</span>
              <select
                className="reference-select"
                value={type}
                onChange={(event) =>
                  setType(event.currentTarget.value as AccountRecord["type"])
                }
              >
                <option value="CASH">Cash</option>
                <option value="BANK">Bank</option>
                <option value="EWALLET">E-wallet</option>
                <option value="CREDIT_CARD">Credit card</option>
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">Name *</span>
              <input
                className="text-input"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                maxLength={120}
              />
            </label>
          </div>
          <div className="reference-grid">
            <label className="field-group">
              <span className="field-label">Opening balance *</span>
              <input
                className="text-input"
                inputMode="decimal"
                value={openingBalance}
                onChange={(event) =>
                  setOpeningBalance(event.currentTarget.value)
                }
                placeholder="0.00"
              />
            </label>
            <label className="field-group">
              <span className="field-label">
                Institution <span className="field-optional">Optional</span>
              </span>
              <input
                className="text-input"
                value={institution}
                onChange={(event) => setInstitution(event.currentTarget.value)}
                maxLength={120}
              />
            </label>
          </div>
          {type === "CREDIT_CARD" ? (
            <label className="field-group account-credit-limit">
              <span className="field-label">
                Credit limit <span className="field-optional">Optional</span>
              </span>
              <input
                className="text-input"
                inputMode="decimal"
                value={creditLimit}
                onChange={(event) => setCreditLimit(event.currentTarget.value)}
                placeholder="0.00"
              />
            </label>
          ) : null}
          <button className="save-button" type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </button>
        </form>
      ) : null}

      <div className="accounts-toolbar">
        <p className="dashboard-label">
          {visibleAccounts.length}{" "}
          {visibleAccounts.length === 1 ? "account" : "accounts"}
        </p>
        <label className="archive-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.currentTarget.checked)}
          />
          <span>Include archived history</span>
        </label>
      </div>

      {visibleAccounts.length ? (
        <div className="accounts-list">
          {visibleAccounts.map((account) => (
            <Link
              className={`account-detail-row${account.archivedAt ? " is-archived" : ""}`}
              key={account.id}
              to={`/app/accounts/${account.id}`}
            >
              <span className="account-mark" aria-hidden="true">
                {account.type === "CREDIT_CARD" ? "◇" : "•"}
              </span>
              <span className="account-copy">
                <strong>{account.name}</strong>
                <span>
                  {accountTypeLabel(account.type)}
                  {account.institution ? ` · ${account.institution}` : ""}
                  {account.archivedAt ? " · Archived" : ""}
                </span>
              </span>
              <span className="account-balance">
                <PrivacyMask label={`${account.name} balance`}>
                  {dashboardMoney(account.balanceMinor)}
                </PrivacyMask>
              </span>
              <span className="account-row-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="dashboard-empty account-empty">
          <p>
            {showArchived
              ? "No accounts have been created yet."
              : "No active accounts."}
          </p>
          <button
            className="quiet-button"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            Create an account
          </button>
        </div>
      )}
    </section>
  );
}

function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const { profile, loading: authLoading, csrfToken } = useAuth();
  const [account, setAccount] = useState<AccountRecord | null>(null);
  const [activity, setActivity] = useState<DashboardActivity[]>([]);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    if (!profile || !accountId) return;
    setLoading(true);
    setError("");
    try {
      const [accountResult, activityResult] = await Promise.all([
        apiRequest<{ account: AccountRecord }>(`/accounts/${accountId}`),
        apiRequest<{ activity: DashboardActivity[] }>(
          `/accounts/${accountId}/activity?limit=50`,
        ),
      ]);
      setAccount(accountResult.account);
      setActivity(activityResult.activity);
      setName(accountResult.account.name);
      setSortOrder(String(accountResult.account.sortOrder));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The account could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, profile]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || !csrfToken || !name.trim()) {
      setError("Give the account a name.");
      return;
    }
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await apiRequest(`/accounts/${accountId}`, {
        method: "PATCH",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: name.trim(),
          sortOrder: Number(sortOrder) || 0,
        }),
      });
      setSuccess("Account details saved.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The account could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  async function archiveAccount() {
    if (!accountId || !csrfToken) return;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await apiRequest(`/accounts/${accountId}/archive`, {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
      });
      setSuccess("Account archived. Its history remains available.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The account could not be archived.",
      );
    } finally {
      setPending(false);
    }
  }

  if (authLoading || loading) return <DashboardLoading />;
  if (!profile) {
    return (
      <RoutePage
        eyebrow="Account overview"
        title="Sign in to review accounts."
        description="Account details and history are private to the owning account."
        icon="▤"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }
  if (!account) {
    return (
      <RoutePage
        eyebrow="Account overview"
        title="Account unavailable."
        description={
          error || "The requested account is not available to this owner."
        }
        icon="▤"
        linkTo="/app/accounts"
        linkLabel="Back to Accounts"
      />
    );
  }

  return (
    <section
      className="route-page account-detail-page"
      aria-labelledby="page-heading"
    >
      <div className="page-intro">
        <p className="eyebrow">
          {accountTypeLabel(account.type)} · Account overview
        </p>
        <h1 id="page-heading">{account.name}</h1>
        <p className="page-description">
          {account.institution ? `${account.institution} · ` : ""}
          {account.archivedAt ? "Archived history" : "Active account"}. Balance
          is derived from posted ledger entries.
        </p>
      </div>
      {success ? (
        <p className="form-success" role="status">
          {success}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="account-detail-hero">
        <span className="dashboard-label">Current balance</span>
        <PrivacyMask label={`${account.name} balance`}>
          {dashboardMoney(account.balanceMinor)}
        </PrivacyMask>
        <span className="dashboard-helper">
          {account.currency} · {activity.length} recorded{" "}
          {activity.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <form className="account-edit-card" onSubmit={saveAccount}>
        <div className="form-heading">
          <div>
            <p className="form-kicker">ACCOUNT METADATA</p>
            <h2>Keep the label useful</h2>
          </div>
          <span className="form-kind">
            {account.archivedAt ? "Archived" : "Editable"}
          </span>
        </div>
        <div className="reference-grid">
          <label className="field-group">
            <span className="field-label">Name *</span>
            <input
              className="text-input"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              disabled={Boolean(account.archivedAt)}
            />
          </label>
          <label className="field-group">
            <span className="field-label">Sort order</span>
            <input
              className="text-input"
              type="number"
              min="0"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.currentTarget.value)}
              disabled={Boolean(account.archivedAt)}
            />
          </label>
        </div>
        {!account.archivedAt ? (
          <button className="save-button" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save account details"}
          </button>
        ) : null}
      </form>

      {!account.archivedAt ? (
        <div className="account-archive-panel">
          <p className="dashboard-label">Archive account</p>
          <p>
            Archiving stops future postings while retaining this account and its
            activity for history.
          </p>
          <button
            className="quiet-button"
            type="button"
            onClick={() => void archiveAccount()}
            disabled={pending}
          >
            Archive account
          </button>
        </div>
      ) : null}

      <section
        className="account-history-panel"
        aria-labelledby="account-history-heading"
      >
        <div className="dashboard-panel-heading">
          <div>
            <p className="dashboard-label">Ledger history</p>
            <h2 id="account-history-heading">Recent activity</h2>
          </div>
          <Link
            className="quiet-link"
            to={`/app/activity?accountId=${account.id}`}
          >
            View all
          </Link>
        </div>
        {activity.length ? (
          <div className="activity-feed">
            {activity.map((item) => {
              const amount = dashboardActivityAmount(item);
              const isIncome = ["INCOME", "REFUND"].includes(
                item.transaction.kind,
              );
              return (
                <Link
                  className="activity-feed-row"
                  key={item.transaction.id}
                  to={`/app/transactions/${item.transaction.id}`}
                >
                  <span
                    className={`activity-kind${isIncome ? " is-income" : ""}`}
                    aria-hidden="true"
                  >
                    {isIncome
                      ? "↑"
                      : item.transaction.kind === "EXPENSE"
                        ? "↓"
                        : "↔"}
                  </span>
                  <span className="activity-feed-copy">
                    <strong>{dashboardActivityLabel(item)}</strong>
                    <span>
                      {item.transaction.occurredOn} ·{" "}
                      {formatActivityKind(item.transaction.kind)}
                    </span>
                  </span>
                  <span
                    className={`activity-feed-amount${isIncome ? " is-income" : ""}`}
                  >
                    {amount ? (
                      <PrivacyMask label="activity amount">
                        {dashboardMoney(amount)}
                      </PrivacyMask>
                    ) : (
                      "—"
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-empty">
            <p>No activity recorded for this account.</p>
          </div>
        )}
      </section>
      <Link className="quiet-link" to="/app/accounts">
        Back to Accounts
      </Link>
    </section>
  );
}

function LoginPage() {
  const { login, loading, profile } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (profile) {
      navigate(
        profile.onboardingStatus === "NEEDS_FIRST_ACCOUNT"
          ? "/onboarding"
          : "/app",
        { replace: true },
      );
    }
  }, [navigate, profile]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const nextProfile = await login(email, password);
      navigate(
        nextProfile.onboardingStatus === "NEEDS_FIRST_ACCOUNT"
          ? "/onboarding"
          : "/app",
        { replace: true },
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Sign-in could not be completed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="route-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Private access</p>
        <h1 id="page-heading">Sign in to your private space.</h1>
        <p className="page-description">
          Use the owner account configured for this MoniKey installation. There
          is no public registration or demo sign-in.
        </p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <div className="form-heading">
          <div>
            <p className="form-kicker">OWNER ACCESS</p>
            <h2>Welcome back</h2>
          </div>
          <span className="form-kind">Secure</span>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="login-email">
            Email <span aria-hidden="true">*</span>
          </label>
          <input
            className="text-input"
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="login-password">
            Password <span aria-hidden="true">*</span>
          </label>
          <input
            className="text-input"
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="save-button"
          type="submit"
          disabled={pending || loading}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <Link className="quiet-link auth-back-link" to="/app">
          Back to Home
        </Link>
      </form>
    </section>
  );
}

function OnboardingPage() {
  const { profile, loading, createFirstAccount } = useAuth();
  const navigate = useNavigate();
  const [type, setType] = useState<"CASH" | "BANK" | "EWALLET" | "CREDIT_CARD">(
    "CASH",
  );
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!loading && !profile) {
    return (
      <RoutePage
        eyebrow="Getting started"
        title="Sign in before creating your first account."
        description="Your first account belongs to the signed-in owner and creates the opening journal entry for the dashboard."
        icon="⌑"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }

  if (profile?.onboardingStatus === "READY") {
    return (
      <RoutePage
        eyebrow="Your accounts"
        title="Your first account is already set up."
        description="You can add more accounts from the Accounts area once that workflow is available."
        icon="✓"
        linkTo="/app"
        linkLabel="Go to Home"
      />
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    let openingBalanceMinor: bigint;
    try {
      openingBalanceMinor = parsePhpMinor(openingBalance || "0");
      if (openingBalanceMinor < 0n) throw new Error("negative");
    } catch {
      setError(
        "Enter a valid non-negative PHP amount with up to two decimals.",
      );
      return;
    }
    if (!name.trim()) {
      setError("Give the account a name.");
      return;
    }
    setPending(true);
    try {
      await createFirstAccount({
        type,
        name,
        openingBalanceMinor: openingBalanceMinor.toString(),
        ...(institution.trim() ? { institution: institution.trim() } : {}),
      });
      navigate("/app", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The first account could not be created.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="route-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Getting started</p>
        <h1 id="page-heading">Start with your first real account.</h1>
        <p className="page-description">
          The opening balance is recorded through the ledger so your dashboard
          starts with a number you can trace.
        </p>
      </div>
      <form className="auth-card onboarding-card" onSubmit={submit}>
        <div className="form-heading">
          <div>
            <p className="form-kicker">FIRST ACCOUNT</p>
            <h2>Where should we start?</h2>
          </div>
          <span className="form-kind">PHP</span>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="onboarding-type">
            Account type <span aria-hidden="true">*</span>
          </label>
          <select
            className="text-input"
            id="onboarding-type"
            value={type}
            onChange={(event) =>
              setType(event.currentTarget.value as typeof type)
            }
          >
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
            <option value="EWALLET">E-wallet</option>
            <option value="CREDIT_CARD">Credit card</option>
          </select>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="onboarding-name">
            Account name <span aria-hidden="true">*</span>
          </label>
          <input
            className="text-input"
            id="onboarding-name"
            type="text"
            autoComplete="off"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Everyday cash"
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="onboarding-institution">
            Institution <span className="field-optional">Optional</span>
          </label>
          <input
            className="text-input"
            id="onboarding-institution"
            type="text"
            autoComplete="organization"
            maxLength={120}
            value={institution}
            onChange={(event) => setInstitution(event.currentTarget.value)}
            placeholder="Bank or wallet provider"
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="onboarding-opening-balance">
            Opening balance <span className="field-optional">Optional</span>
          </label>
          <div className="amount-control">
            <span className="currency-prefix" aria-hidden="true">
              ₱
            </span>
            <input
              className="amount-input"
              id="onboarding-opening-balance"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={openingBalance}
              onChange={(event) => setOpeningBalance(event.currentTarget.value)}
              placeholder="0.00"
            />
          </div>
          <p className="field-hint">
            PHP · up to 2 decimal places · can be zero
          </p>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="save-button"
          type="submit"
          disabled={pending || loading}
        >
          {pending ? "Creating account…" : "Create first account"}
        </button>
      </form>
    </section>
  );
}

function QuickAddPreviewPage() {
  const [amount, setAmount] = useState("");

  return (
    <section className="route-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Quick add · Preview</p>
        <h1 id="page-heading">A clear entry, without extra steps.</h1>
        <p className="page-description">
          Amount entry uses exact PHP parsing. Account and category choices
          activate once real records can be saved.
        </p>
      </div>
      <form
        className="quick-add-card"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="form-heading">
          <div>
            <p className="form-kicker">EXPENSE</p>
            <h2>New transaction</h2>
          </div>
          <span className="form-kind">Today</span>
        </div>
        <AmountEntry id="amount" value={amount} onChange={setAmount} />
        <div className="reference-grid">
          <ReferenceSelect
            id="account"
            label="Account"
            unavailableText="No saved accounts"
          />
          <ReferenceSelect
            id="category"
            label="Category"
            unavailableText="No saved categories"
          />
        </div>
        <button className="save-button" type="submit" disabled>
          Record expense
        </button>
        <p className="no-save-note" role="status">
          Preview only. Nothing is saved from this screen yet.
        </p>
      </form>
    </section>
  );
}

type QuickAddMode = "EXPENSE" | "INCOME" | "TRANSFER";
type QuickAddAccount = {
  id: string;
  type: "CASH" | "BANK" | "EWALLET" | "CREDIT_CARD";
  name: string;
  balanceMinor: string;
  archivedAt: string | null;
};
type QuickAddCategory = {
  id: string;
  kind: "INCOME" | "EXPENSE";
  name: string;
  archivedAt: string | null;
};

function QuickAddPage() {
  const { profile, csrfToken } = useAuth();
  const isOnline = useOnlineStatus();
  const [mode, setMode] = useState<QuickAddMode>("EXPENSE");
  const [accounts, setAccounts] = useState<QuickAddAccount[]>([]);
  const [categories, setCategories] = useState<QuickAddCategory[]>([]);
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [feeCategoryId, setFeeCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState(profile?.serverToday ?? "");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [negativeConfirmation, setNegativeConfirmation] = useState(false);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    setOccurredOn(profile.serverToday);
    void Promise.all([
      apiRequest<{ accounts: QuickAddAccount[] }>("/accounts"),
      apiRequest<{ categories: QuickAddCategory[] }>("/categories"),
    ])
      .then(([accountResult, categoryResult]) => {
        const activeAccounts = accountResult.accounts.filter(
          (account) => !account.archivedAt && account.type !== "CREDIT_CARD",
        );
        const activeCategories = categoryResult.categories.filter(
          (category) => !category.archivedAt,
        );
        setAccounts(activeAccounts);
        setCategories(activeCategories);
        setSourceAccountId((current) => current || activeAccounts[0]?.id || "");
        setDestinationAccountId(
          (current) => current || activeAccounts[1]?.id || "",
        );
        setCategoryId((current) => current || "");
      })
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Saved accounts and categories could not be loaded.",
        );
      })
      .finally(() => setLoading(false));
  }, [profile]);

  const visibleCategories = categories.filter((category) =>
    mode === "TRANSFER" ? category.kind === "EXPENSE" : category.kind === mode,
  );
  const expenseCategories = categories.filter(
    (category) => category.kind === "EXPENSE",
  );

  function parsePositive(value: string, label: string): bigint {
    let parsed: bigint;
    try {
      parsed = parsePhpMinor(value);
    } catch {
      throw new Error(`${label} must be PHP with up to two decimal places.`);
    }
    if (parsed <= 0n) throw new Error(`${label} must be greater than zero.`);
    return parsed;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNegativeConfirmation(false);
    if (!isOnline) {
      setError("You are offline. Reconnect before recording a transaction.");
      return;
    }
    try {
      const amountMinor = parsePositive(amount, "Amount").toString();
      if (!profile || !csrfToken)
        throw new Error("Your session needs to be refreshed.");
      if (!sourceAccountId) throw new Error("Choose an account.");
      if (!occurredOn) throw new Error("Choose the transaction date.");
      const common = {
        occurredOn,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const body =
        mode === "TRANSFER"
          ? {
              kind: "TRANSFER" as const,
              fromAccountId: sourceAccountId,
              toAccountId: destinationAccountId,
              amountMinor,
              ...(fee.trim()
                ? { feeMinor: parsePositive(fee, "Transfer fee").toString() }
                : {}),
              ...(feeCategoryId ? { feeCategoryId } : {}),
              ...common,
            }
          : {
              kind: mode,
              sourceAccountId,
              categoryId,
              amountMinor,
              ...common,
            };
      if (mode !== "TRANSFER" && !categoryId) {
        throw new Error("Choose a category.");
      }
      if (mode === "TRANSFER" && !destinationAccountId) {
        throw new Error("Choose a destination account.");
      }
      if (mode === "TRANSFER" && destinationAccountId === sourceAccountId) {
        throw new Error("Choose two different accounts.");
      }
      setPending(true);
      const response = await fetch("/api/v1/transactions", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        const message =
          payload?.error?.message ?? "The transaction could not be saved.";
        if (response.status === 409 && message.includes("negative")) {
          setNegativeConfirmation(true);
        }
        throw new Error(message);
      }
      setAmount("");
      setFee("");
      setNote("");
      setNegativeConfirmation(false);
      setError("Transaction saved.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  async function confirmNegativeBalance() {
    if (!csrfToken) return;
    if (!isOnline) {
      setError("You are offline. Reconnect before recording a transaction.");
      return;
    }
    setError("");
    setPending(true);
    try {
      const amountMinor = parsePositive(amount, "Amount").toString();
      const body =
        mode === "TRANSFER"
          ? {
              kind: "TRANSFER" as const,
              fromAccountId: sourceAccountId,
              toAccountId: destinationAccountId,
              amountMinor,
              acknowledgeNegativeBalance: true,
              occurredOn,
              ...(fee.trim()
                ? { feeMinor: parsePositive(fee, "Transfer fee").toString() }
                : {}),
              ...(feeCategoryId ? { feeCategoryId } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            }
          : {
              kind: mode,
              sourceAccountId,
              categoryId,
              amountMinor,
              acknowledgeNegativeBalance: true,
              occurredOn,
              ...(note.trim() ? { note: note.trim() } : {}),
            };
      const response = await fetch("/api/v1/transactions", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message ?? "The transaction could not be saved.",
        );
      }
      setAmount("");
      setFee("");
      setNote("");
      setNegativeConfirmation(false);
      setError("Transaction saved.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!profile) return <QuickAddPreviewPage />;

  return (
    <section className="route-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Quick add · Private</p>
        <h1 id="page-heading">Record it while it is fresh.</h1>
        <p className="page-description">
          One short form for expenses, income, and transfers. Every save uses a
          balanced journal and can be safely retried.
        </p>
      </div>
      <form className="quick-add-card" onSubmit={submit}>
        <div className="mode-tabs" role="tablist" aria-label="Transaction type">
          {(["EXPENSE", "INCOME", "TRANSFER"] as QuickAddMode[]).map((item) => (
            <button
              key={item}
              className={`mode-tab${mode === item ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={mode === item}
              onClick={() => {
                setMode(item);
                setError("");
                setNegativeConfirmation(false);
              }}
            >
              {item[0] + item.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="form-heading">
          <div>
            <p className="form-kicker">{mode}</p>
            <h2>
              {mode === "TRANSFER" ? "Move money" : `New ${mode.toLowerCase()}`}
            </h2>
          </div>
          <span className="form-kind">{profile.serverToday}</span>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="quick-add-amount">
            Amount <span aria-hidden="true">*</span>
          </label>
          <div className="amount-control">
            <span className="currency-prefix" aria-hidden="true">
              ₱
            </span>
            <input
              className="amount-input"
              id="quick-add-amount"
              type="text"
              inputMode="decimal"
              required
              value={amount}
              onChange={(event) => setAmount(event.currentTarget.value)}
              placeholder="0.00"
            />
          </div>
          <p className="field-hint">PHP · up to 2 decimal places</p>
        </div>
        <div className="reference-grid">
          <label className="field-group">
            <span className="field-label">
              {mode === "TRANSFER" ? "From account" : "Account"}{" "}
              <span aria-hidden="true">*</span>
            </span>
            <select
              className="reference-select"
              value={sourceAccountId}
              onChange={(event) =>
                setSourceAccountId(event.currentTarget.value)
              }
              disabled={loading}
            >
              <option value="">
                {loading ? "Loading accounts…" : "Choose an account"}
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {formatPhp(moneyMinor(account.balanceMinor))}
                </option>
              ))}
            </select>
          </label>
          {mode === "TRANSFER" ? (
            <label className="field-group">
              <span className="field-label">
                To account <span aria-hidden="true">*</span>
              </span>
              <select
                className="reference-select"
                value={destinationAccountId}
                onChange={(event) =>
                  setDestinationAccountId(event.currentTarget.value)
                }
                disabled={loading}
              >
                <option value="">Choose a destination</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field-group">
              <span className="field-label">
                Category <span aria-hidden="true">*</span>
              </span>
              <select
                className="reference-select"
                value={categoryId}
                onChange={(event) => setCategoryId(event.currentTarget.value)}
                disabled={loading}
              >
                <option value="">
                  {loading ? "Loading categories…" : "Choose a category"}
                </option>
                {visibleCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {mode === "TRANSFER" ? (
          <div className="reference-grid transfer-options">
            <label className="field-group">
              <span className="field-label">
                Transfer fee <span className="field-optional">Optional</span>
              </span>
              <input
                className="text-input"
                type="text"
                inputMode="decimal"
                value={fee}
                onChange={(event) => setFee(event.currentTarget.value)}
                placeholder="0.00"
              />
            </label>
            <label className="field-group">
              <span className="field-label">
                Fee category <span className="field-optional">Optional</span>
              </span>
              <select
                className="reference-select"
                value={feeCategoryId}
                onChange={(event) =>
                  setFeeCategoryId(event.currentTarget.value)
                }
                disabled={!fee}
              >
                <option value="">Choose a fee category</option>
                {expenseCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className="reference-grid quick-add-details">
          <label className="field-group">
            <span className="field-label">
              Date <span aria-hidden="true">*</span>
            </span>
            <input
              className="text-input"
              type="date"
              value={occurredOn}
              max={profile.serverToday}
              onChange={(event) => setOccurredOn(event.currentTarget.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-label">
              Note <span className="field-optional">Optional</span>
            </span>
            <input
              className="text-input"
              type="text"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
              placeholder="What was this for?"
            />
          </label>
        </div>
        {error ? (
          <p
            className={
              error === "Transaction saved." ? "form-success" : "form-error"
            }
            role="status"
          >
            {error}
          </p>
        ) : null}
        {negativeConfirmation ? (
          <div className="confirmation-panel" role="alert">
            <p>This will make the source account negative. Continue?</p>
            <button
              className="save-button"
              type="button"
              onClick={() => void confirmNegativeBalance()}
              disabled={pending || !isOnline}
            >
              Confirm and record
            </button>
          </div>
        ) : (
          <button
            className="save-button"
            type="submit"
            disabled={pending || loading || !accounts.length || !isOnline}
          >
            {pending ? "Saving…" : `Record ${mode.toLowerCase()}`}
          </button>
        )}
      </form>
    </section>
  );
}

function SettingsPage() {
  return (
    <section className="route-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Your preferences</p>
        <h1 id="page-heading">Settings</h1>
        <p className="page-description">
          Choose how the interface looks and how private values appear on your
          screen.
        </p>
      </div>
      <div className="privacy-control-preview">
        <div>
          <p className="empty-title">Privacy mask preview</p>
          <p className="field-hint">
            Text sample only. No account balance is displayed here.
          </p>
        </div>
        <PrivacyMask label="preview text">
          <span className="preview-private-value">Private value</span>
        </PrivacyMask>
      </div>
    </section>
  );
}

function NotFoundPage() {
  return (
    <RoutePage
      eyebrow="Page not found"
      title="That page is not here."
      description="The address may have changed, or the page may not be part of this version yet."
      icon="↗"
      linkLabel="Return to Home"
    />
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="app" element={<HomePage />} />
          <Route path="app/activity" element={<ActivityPage />} />
          <Route path="app/transactions/new" element={<QuickAddPage />} />
          <Route
            path="app/transactions/:transactionId"
            element={<TransactionDetailPage />}
          />
          <Route path="app/accounts" element={<AccountsPage />} />
          <Route
            path="app/accounts/:accountId"
            element={<AccountDetailPage />}
          />
          <Route
            path="app/accounts/:accountId/statements"
            element={
              <RoutePage
                eyebrow="Credit cards"
                title="Statements"
                description="Review manually entered statement amounts and due dates."
                icon="□"
              />
            }
          />
          <Route
            path="app/bills"
            element={
              <RoutePage
                eyebrow="Plan ahead"
                title="Bills"
                description="Upcoming reminders will stay separate from posted account balances until you confirm a payment."
                icon="□"
              />
            }
          />
          <Route
            path="app/reports"
            element={
              <RoutePage
                eyebrow="Understand your month"
                title="Reports"
                description="Monthly totals and categories will come from the same saved journal as your balances."
                icon="▥"
              />
            }
          />
          <Route path="app/settings" element={<SettingsPage />} />
          <Route
            path="app/settings/categories"
            element={
              <RoutePage
                eyebrow="Personalize"
                title="Categories"
                description="Your income and expense categories will organize records without changing history."
                icon="◇"
              />
            }
          />
          <Route path="app/settings/security" element={<LoginPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
