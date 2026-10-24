import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  PrivacyPreferenceProvider,
  ReferenceSelect,
} from "./components";
import { formatPhp, moneyMinor, parsePhpMinor } from "@monikey/money";
import {
  AuthProvider,
  useAuth,
  type Profile,
} from "./features/identity/AuthProvider";
import { ReportsFeature } from "./features/reports/ReportsFeature";
import { useLatestResource } from "./shared/hooks/use-latest-resource";
import {
  ApiRequestError,
  apiRequest,
  isTerminalClientError,
} from "./shared/lib/api-request";
import { usePendingSubmissionMatches } from "./shared/hooks/use-pending-submission-matches";
import { scheduleManilaMidnightRefresh } from "./shared/lib/manila-time";
import {
  beginPendingSubmission,
  clearPendingSubmission,
  pendingSubmissionKey,
} from "./shared/lib/pending-submissions";
import { PendingSubmissionRecovery } from "./shared/components/PendingSubmissionRecovery";
import "./style.css";

type Theme = "light" | "dark";

const primaryNavigation = [
  { label: "Home", to: "/app", icon: "home", end: true },
  { label: "Activity", to: "/app/activity", icon: "activity" },
  {
    label: "Add",
    to: "/app/transactions/new",
    icon: "add",
    action: true,
  },
  { label: "Accounts", to: "/app/accounts", icon: "accounts" },
] as const;

const secondaryNavigation = [
  { label: "Bills", to: "/app/bills", icon: "bills" },
  { label: "Reports", to: "/app/reports", icon: "reports" },
  { label: "Settings", to: "/app/settings", icon: "settings" },
] as const;

type NavigationIcon =
  | "home"
  | "activity"
  | "add"
  | "accounts"
  | "bills"
  | "reports"
  | "settings"
  | "collapse"
  | "expand"
  | "moon"
  | "sun";

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
  const { profile, csrfToken } = useAuth();
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem("monikey-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    if (profile?.user.theme === "light" || profile?.user.theme === "dark") {
      setTheme(profile.user.theme);
    }
  }, [profile?.user.theme]);

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
    () => {
      const next = theme === "light" ? "dark" : "light";
      setTheme(next);
      window.localStorage.setItem("monikey-theme", next);
      if (profile && csrfToken) {
        void apiRequest("/me/preferences", {
          method: "PATCH",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify({ theme: next }),
        }).catch(() => undefined);
      }
    },
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

function AppIcon({ name }: { name: NavigationIcon }) {
  let drawing: React.ReactNode;
  switch (name) {
    case "home":
      drawing = <path d="m3.5 10 8.5-7 8.5 7M5.5 9v11h13V9M9.5 20v-6h3v6" />;
      break;
    case "activity":
      drawing = <path d="M3 12h4l2.5-7 4.5 14 2.5-7H21" />;
      break;
    case "add":
      drawing = <path d="M12 5v14M5 12h14" />;
      break;
    case "accounts":
      drawing = (
        <>
          <rect x="3.5" y="4" width="17" height="16" rx="2" />
          <path d="M7.5 8h9M7.5 12h9M7.5 16h5" />
        </>
      );
      break;
    case "bills":
      drawing = (
        <>
          <path d="M6 3.5h9l3 3V20H6z" />
          <path d="M14.5 3.5V7h3.5M9 11h6M9 14.5h6M9 18h4" />
        </>
      );
      break;
    case "reports":
      drawing = (
        <>
          <path d="M4 20V11M10 20V5M16 20v-8M22 20H2" />
        </>
      );
      break;
    case "settings":
      drawing = (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a7.8 7.8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a7.8 7.8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7.8 7.8 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a7.8 7.8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a7.8 7.8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7.8 7.8 0 0 1 0 1.8Z" />
        </>
      );
      break;
    case "collapse":
      drawing = <path d="m14.5 6-6 6 6 6" />;
      break;
    case "expand":
      drawing = <path d="m9.5 6 6 6-6 6" />;
      break;
    case "moon":
      drawing = (
        <path d="M19.2 15.1A7.8 7.8 0 0 1 8.9 4.8 8 8 0 1 0 19.2 15Z" />
      );
      break;
    case "sun":
      drawing = (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      );
      break;
  }

  return (
    <svg
      aria-hidden="true"
      className="app-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {drawing}
    </svg>
  );
}

function NavigationLink({
  label,
  to,
  icon,
  end,
  action = false,
}: {
  label: string;
  to: string;
  icon: NavigationIcon;
  end?: boolean;
  action?: boolean;
}) {
  const location = useLocation();
  const contextualFrom =
    action && location.pathname !== to
      ? `${location.pathname}${location.search}`
      : undefined;
  return (
    <NavLink
      className={({ isActive }) =>
        `nav-link${isActive ? " is-active" : ""}${action ? " nav-action" : ""}`
      }
      to={to}
      aria-label={action ? "Add transaction" : label}
      title={label}
      {...(end ? { end: true } : {})}
      {...(contextualFrom ? { state: { from: contextualFrom } } : {})}
    >
      <span className="nav-symbol">
        <AppIcon name={icon} />
      </span>
      <span>{label}</span>
    </NavLink>
  );
}

function AppShell() {
  const [theme, toggleTheme] = useTheme();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const location = useLocation();
  const { profile, logout, sessionStatus, retrySession } = useAuth();
  const isOnline = useOnlineStatus();
  const [signOutError, setSignOutError] = useState("");
  const pageTitle =
    location.pathname === "/app"
      ? ""
      : ((location.pathname === "/onboarding" &&
        profile?.onboardingStatus === "READY"
          ? "Accounts"
          : pageTitles[location.pathname]) ??
        (location.pathname.includes("/statements")
          ? "Statements"
          : location.pathname.includes("/transactions/")
            ? "Transaction details"
            : location.pathname.includes("/accounts/")
              ? "Account details"
              : "MoniKey"));

  useEffect(() => {
    const handleOnline = () => {
      if (sessionStatus === "unavailable") void retrySession();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [retrySession, sessionStatus]);

  useEffect(() => {
    if (!profile) return;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        await retrySession();
      } finally {
        refreshing = false;
      }
    };
    const handleResume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const cancelMidnightRefresh = scheduleManilaMidnightRefresh(() => {
      void refresh();
    });
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    return () => {
      cancelMidnightRefresh();
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [profile?.user.id, retrySession]);

  useEffect(() => {
    if (!profile) return;
    const dateSensitiveRoute =
      location.pathname === "/app/transactions/new" ||
      location.pathname === "/app/bills" ||
      location.pathname === "/app/reports" ||
      /\/app\/accounts\/[^/]+\/pay$/.test(location.pathname);
    if (dateSensitiveRoute) void retrySession();
  }, [location.pathname, profile?.user.id, retrySession]);

  const handleLogout = () => {
    setSignOutError("");
    void logout().catch(() =>
      setSignOutError(
        "Your device cleared this session, but MoniKey could not confirm sign-out with the server. Reconnect and sign in again to verify it.",
      ),
    );
  };

  return (
    <div className={`app-shell${railCollapsed ? " is-rail-collapsed" : ""}`}>
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
            className="rail-collapse-button"
            type="button"
            aria-label={
              railCollapsed ? "Expand navigation" : "Collapse navigation"
            }
            aria-expanded={!railCollapsed}
            title={railCollapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => setRailCollapsed((collapsed) => !collapsed)}
          >
            <AppIcon name={railCollapsed ? "expand" : "collapse"} />
            <span>
              {railCollapsed ? "Expand navigation" : "Collapse navigation"}
            </span>
          </button>
          <button
            className="theme-button"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            <AppIcon name={theme === "light" ? "moon" : "sun"} />
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
          <div
            className="desktop-page-title"
            aria-live="polite"
            aria-hidden={!pageTitle}
          >
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
              {profile ? (
                <button
                  className="mobile-menu-sign-out"
                  type="button"
                  onClick={handleLogout}
                >
                  Sign out
                </button>
              ) : null}
            </nav>
          </details>
          <button
            className="mobile-theme-button"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            <AppIcon name={theme === "light" ? "moon" : "sun"} />
          </button>
          <div className="topbar-actions">
            {profile ? (
              <button
                className="topbar-sign-out"
                type="button"
                onClick={handleLogout}
              >
                Sign out
              </button>
            ) : null}
            <Link
              className="profile-chip"
              to={profile ? "/app/settings" : "/login"}
            >
              <span className="profile-dot" aria-hidden="true" />
              <span>
                {profile ? profile.user.emailNormalized : "Private space"}
              </span>
            </Link>
          </div>
        </header>

        <main
          className={`page-content${location.pathname === "/app" ? " page-content-dashboard" : ""}`}
          id="main-content"
        >
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
          {sessionStatus === "unavailable" ? (
            <div className="connection-notice" role="alert">
              <span className="notice-mark" aria-hidden="true">
                !
              </span>
              <span>
                {profile
                  ? "Your saved view remains available, but financial changes are paused until your session is verified."
                  : "MoniKey cannot verify your sign-in right now. Financial data and changes stay hidden until the connection recovers."}
              </span>
              <button
                className="connection-retry"
                type="button"
                onClick={() => void retrySession()}
              >
                Try again
              </button>
            </div>
          ) : null}
          {signOutError ? (
            <p className="form-error" role="alert">
              {signOutError}
            </p>
          ) : null}
          {!profile && sessionStatus === "anonymous" ? (
            <div className="preview-notice" role="status">
              <span className="notice-mark" aria-hidden="true">
                i
              </span>
              <span>
                Foundation preview. Sign-in and financial records are not active
                yet.
              </span>
            </div>
          ) : null}
          <Outlet key={profile?.user.id ?? "signed-out"} />
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
  emptyTitle = "Nothing to show yet",
  emptyDescription = "Saved records appear here when this view has something to show. No sample balances or transactions are added.",
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
  linkTo?: string;
  linkLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
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
          <p className="empty-title">{emptyTitle}</p>
          <p>{emptyDescription}</p>
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
  creditLimitMinor?: string | null;
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
  upcomingBills: {
    id: string;
    billName: string;
    expectedAmountMinor: string | null;
    actualAmountMinor: string | null;
    dueOn: string;
    status: "UPCOMING" | "OVERDUE" | "PAID" | "SKIPPED";
  }[];
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
  const amount =
    activity.transaction.kind === "OPENING_BALANCE"
      ? activity.revision.openingBalanceMinor
      : activity.revision.amountMinor;
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
  const { refreshProfile } = useAuth();
  const fetchSummary = useCallback(
    () => apiRequest<DashboardSummaryResponse>("/dashboard/summary"),
    [],
  );
  const resource = useLatestResource(
    `dashboard:${profile.user.id}`,
    fetchSummary,
  );
  const summary = resource.data;

  useEffect(() => {
    if (resource.errorStatus === 401) void refreshProfile();
  }, [refreshProfile, resource.errorStatus]);

  if (resource.loading && !summary) return <DashboardLoading />;

  return (
    <section className="dashboard-page" aria-labelledby="page-heading">
      <div className="dashboard-heading">
        <div className="page-intro">
          <p className="eyebrow">YOUR FINANCES · {profile.user.currency}</p>
          <h1 id="page-heading">Overview</h1>
          <p className="page-description">
            Your money, accounts and latest activity.
          </p>
        </div>
        <div className="dashboard-heading-actions">
          <button
            className="quiet-button"
            type="button"
            onClick={() => void resource.reload()}
          >
            {resource.refreshing ? "Refreshing…" : "Refresh balances"}
          </button>
          <Link className="dashboard-primary-action" to="/app/transactions/new">
            <span aria-hidden="true">+</span> Add transaction
          </Link>
        </div>
      </div>

      {resource.error ? (
        <div className="dashboard-error" role="alert">
          <div>
            <strong>
              {resource.stale
                ? "Showing previously loaded figures"
                : "Dashboard unavailable"}
            </strong>
            <p>
              {resource.stale
                ? `These figures could not be refreshed. ${resource.error}`
                : resource.error}
            </p>
          </div>
          <button
            type="button"
            className="quiet-button"
            onClick={() => void resource.reload()}
            disabled={resource.refreshing}
          >
            {resource.refreshing ? "Refreshing…" : "Try again"}
          </button>
        </div>
      ) : null}
      {resource.refreshing ? (
        <p className="dashboard-helper" role="status">
          Refreshing verified balances…
        </p>
      ) : null}

      {summary ? (
        <>
          <div className="dashboard-overview-grid">
            <section
              className="dashboard-summary-card"
              aria-label="Financial summary"
            >
              <div className="dashboard-summary-main">
                <div>
                  <p className="dashboard-label">Available money</p>
                  <div className="dashboard-balance">
                    <PrivacyMask label="available money">
                      {dashboardMoney(summary.availableMoneyMinor)}
                    </PrivacyMask>
                  </div>
                  <p className="dashboard-helper">
                    Cash, bank and e-wallet balances · {summary.serverToday}
                  </p>
                </div>
                <span className="dashboard-hero-meta">
                  <span className="status-dot" aria-hidden="true" />
                  Posted journal totals
                </span>
              </div>
              <div className="dashboard-stat-grid">
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
                <div className="dashboard-stat dashboard-month-stat">
                  <p className="dashboard-label">
                    This month <span>{summary.month}</span>
                  </p>
                  <p className="dashboard-stat-line dashboard-income">
                    <span>Income</span>
                    {dashboardMoney(summary.incomeMinor)}
                  </p>
                  <p className="dashboard-stat-line dashboard-expense">
                    <span>Spending</span>
                    {dashboardMoney(summary.spendingMinor)}
                  </p>
                </div>
              </div>
            </section>
          </div>

          <div className="dashboard-overview-columns">
            <div className="dashboard-overview-main">
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
                    {summary.recentActivity.slice(0, 6).map((activity) => {
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
                                : activity.transaction.kind.replaceAll(
                                    "_",
                                    " ",
                                  )}
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
            <aside className="dashboard-overview-side">
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
                className="dashboard-panel dashboard-side-bills"
                aria-labelledby="dashboard-bills-heading"
              >
                <div className="dashboard-panel-heading">
                  <div>
                    <p className="dashboard-label">Plan ahead</p>
                    <h2 id="dashboard-bills-heading">Upcoming bills</h2>
                  </div>
                  <Link className="quiet-link" to="/app/bills">
                    View bills
                  </Link>
                </div>
                {summary.upcomingBills.length ? (
                  <div className="bill-list">
                    {summary.upcomingBills.slice(0, 4).map((bill) => (
                      <div className="bill-row" key={bill.id}>
                        <div>
                          <strong>{bill.billName}</strong>
                          <span>
                            {bill.dueOn} · {bill.status.toLowerCase()}
                          </span>
                        </div>
                        <span className="bill-amount">
                          {bill.expectedAmountMinor ? (
                            <PrivacyMask
                              label={`${bill.billName} expected bill`}
                            >
                              {dashboardMoney(bill.expectedAmountMinor)}
                            </PrivacyMask>
                          ) : (
                            "Variable amount"
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="dashboard-empty">
                    <p>No upcoming bills.</p>
                    <Link className="quiet-link" to="/app/bills">
                      Manage bills
                    </Link>
                  </div>
                )}
              </section>
            </aside>
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
  const appliedFilters = activityFiltersFromParams(
    new URLSearchParams(paramsKey),
  );
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
  const [moreError, setMoreError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const requestId = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMoreError("");
    setActivity([]);
    setNextCursor(null);
    const urlFilters = activityFiltersFromParams(
      new URLSearchParams(paramsKey),
    );
    setFilters(urlFilters);
    setLoading(true);
    setError("");
    const query = activityFilterParams(urlFilters);
    query.set("limit", "25");
    void Promise.all([
      apiRequest<{ activity: DashboardActivity[]; nextCursor: string | null }>(
        `/transactions?${query.toString()}`,
        { signal: controller.signal },
      ),
      apiRequest<{ accounts: DashboardAccount[] }>("/accounts", {
        signal: controller.signal,
      }),
      apiRequest<{ categories: QuickAddCategory[] }>("/categories", {
        signal: controller.signal,
      }),
    ])
      .then(([activityResult, accountResult, categoryResult]) => {
        if (id !== requestId.current) return;
        setActivity(activityResult.activity);
        setNextCursor(activityResult.nextCursor);
        setAccounts(accountResult.accounts);
        setCategories(categoryResult.categories);
      })
      .catch((caught) => {
        if (controller.signal.aborted || id !== requestId.current) return;
        setActivity([]);
        setError(
          caught instanceof Error
            ? caught.message
            : "Activity could not be loaded.",
        );
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    return () => {
      controller.abort();
      moreController.current?.abort();
    };
  }, [paramsKey, profile, retryVersion]);

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
    if (!nextCursor || loadingMoreRef.current || loading || error) return;
    loadingMoreRef.current = true;
    const id = requestId.current;
    const requestKey = paramsKey;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setMoreError("");
    const query = activityFilterParams(appliedFilters);
    query.set("limit", "25");
    query.set("cursor", nextCursor);
    try {
      const result = await apiRequest<{
        activity: DashboardActivity[];
        nextCursor: string | null;
      }>(`/transactions?${query.toString()}`, { signal: controller.signal });
      if (id !== requestId.current || requestKey !== paramsKey) return;
      setActivity((current) => {
        const seen = new Set(current.map((item) => item.transaction.id));
        const additions = result.activity.filter((item) => {
          const transactionId = item.transaction.id;
          if (seen.has(transactionId)) return false;
          seen.add(transactionId);
          return true;
        });
        return [...current, ...additions];
      });
      setNextCursor(result.nextCursor);
    } catch (caught) {
      if (controller.signal.aborted || id !== requestId.current) return;
      setMoreError(
        caught instanceof Error
          ? caught.message
          : "More activity could not be loaded.",
      );
    } finally {
      if (moreController.current === controller) {
        moreController.current = null;
        loadingMoreRef.current = false;
        if (id === requestId.current) setLoadingMore(false);
      }
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
        <h1 id="page-heading">Activity</h1>
        <p className="page-description">
          Search posted records and open one to review, edit, or reverse it.
        </p>
      </div>

      <form className="activity-filter-panel" onSubmit={applyFilters}>
        <button
          type="button"
          className="activity-filter-toggle"
          aria-expanded={filtersExpanded}
          aria-controls="activity-advanced-filters"
          onClick={() => setFiltersExpanded((expanded) => !expanded)}
        >
          Filters{" "}
          <span>
            {Object.values(appliedFilters).filter(Boolean).length
              ? `${Object.values(appliedFilters).filter(Boolean).length} applied`
              : "All activity"}
          </span>
        </button>
        <div
          className={`activity-filter-content${filtersExpanded ? " is-expanded" : ""}`}
          id="activity-advanced-filters"
        >
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
            <button
              className="quiet-button"
              type="button"
              onClick={clearFilters}
            >
              Clear
            </button>
          </div>
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
            onClick={() => setRetryVersion((version) => version + 1)}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="activity-results" aria-live="polite">
        {error ? null : loading ? (
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
      {moreError ? (
        <div className="dashboard-error" role="alert">
          <p>{moreError}</p>
          <button
            type="button"
            className="quiet-button"
            onClick={() => void loadMore()}
          >
            Retry loading more
          </button>
        </div>
      ) : null}
      {nextCursor && !error ? (
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

type CardStatementRecord = {
  id: string;
  cardAccountId: string;
  statementDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  amountDueMinor: string;
  allocatedMinor: string;
  remainingDueMinor: string;
  paymentDueDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
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
  const [editNegativeConfirmation, setEditNegativeConfirmation] =
    useState(false);
  const [editCardCreditConfirmation, setEditCardCreditConfirmation] =
    useState(false);
  const [reverseNegativeConfirmation, setReverseNegativeConfirmation] =
    useState(false);
  const [reverseCreditConfirmation, setReverseCreditConfirmation] =
    useState(false);

  function resetEditConfirmations() {
    setEditNegativeConfirmation(false);
    setEditCardCreditConfirmation(false);
    setReverseNegativeConfirmation(false);
    setReverseCreditConfirmation(false);
  }

  function projectedEditEffects() {
    if (
      !transaction ||
      (transaction.kind !== "EXPENSE" && transaction.kind !== "INCOME")
    )
      return null;
    const current = revisions.at(-1)?.after ?? {};
    const oldAccountId = revisionText(current, "sourceAccountId");
    const oldAmountText = revisionText(current, "amountMinor");
    const nextAccount = accounts.find((account) => account.id === accountId);
    if (!oldAccountId || !oldAmountText || !nextAccount) return null;
    try {
      const oldAmount = BigInt(oldAmountText);
      const nextAmount = BigInt(parsePhpMinor(amount));
      const negativeAssets = [...new Set([oldAccountId, nextAccount.id])]
        .map((id) => accounts.find((account) => account.id === id))
        .filter(
          (account): account is DashboardAccount =>
            account !== undefined && account.type !== "CREDIT_CARD",
        )
        .map((account) => {
          let projectedBalanceMinor = BigInt(account.balanceMinor);
          if (account.id === oldAccountId) {
            projectedBalanceMinor +=
              transaction.kind === "EXPENSE" ? oldAmount : -oldAmount;
          }
          if (account.id === nextAccount.id) {
            projectedBalanceMinor +=
              transaction.kind === "EXPENSE" ? -nextAmount : nextAmount;
          }
          return { account, projectedBalanceMinor };
        })
        .filter((item) => item.projectedBalanceMinor < 0n)
        .map((item) => ({
          accountName: item.account.name,
          balanceMinor: moneyMinor(item.projectedBalanceMinor.toString()),
        }));
      const cardCredits = [...new Set([oldAccountId, nextAccount.id])]
        .map((id) => accounts.find((account) => account.id === id))
        .filter(
          (account): account is DashboardAccount =>
            account !== undefined && account.type === "CREDIT_CARD",
        )
        .map((account) => {
          let projectedBalanceMinor = BigInt(account.balanceMinor);
          if (account.id === oldAccountId) projectedBalanceMinor -= oldAmount;
          if (account.id === nextAccount.id)
            projectedBalanceMinor += nextAmount;
          return { account, projectedBalanceMinor };
        })
        .filter((item) => item.projectedBalanceMinor < 0n)
        .map((item) => ({
          accountName: item.account.name,
          creditMinor: moneyMinor((-item.projectedBalanceMinor).toString()),
        }));
      return {
        negativeAssets,
        cardCredits,
      };
    } catch {
      return null;
    }
  }

  function projectedReversalEffects() {
    if (!transaction || transaction.kind === "OPENING_BALANCE") return null;
    const current = revisions.at(-1)?.after ?? {};
    const amountText = revisionText(current, "amountMinor");
    if (!amountText) return null;
    try {
      const amountMinor = BigInt(amountText);
      const feeMinor = BigInt(revisionText(current, "feeMinor") || "0");
      const deltas = new Map<string, bigint>();
      const addDelta = (id: string, delta: bigint) => {
        if (id) deltas.set(id, (deltas.get(id) ?? 0n) + delta);
      };
      if (transaction.kind === "EXPENSE") {
        const id = revisionText(current, "sourceAccountId");
        const account = accounts.find((item) => item.id === id);
        addDelta(
          id,
          account?.type === "CREDIT_CARD" ? -amountMinor : amountMinor,
        );
      } else if (transaction.kind === "INCOME") {
        addDelta(revisionText(current, "sourceAccountId"), -amountMinor);
      } else if (transaction.kind === "TRANSFER") {
        addDelta(
          revisionText(current, "fromAccountId"),
          amountMinor + feeMinor,
        );
        addDelta(revisionText(current, "toAccountId"), -amountMinor);
      } else if (transaction.kind === "REFUND") {
        const id = revisionText(current, "sourceAccountId");
        const account = accounts.find((item) => item.id === id);
        addDelta(
          id,
          account?.type === "CREDIT_CARD" ? amountMinor : -amountMinor,
        );
      } else if (transaction.kind === "ADJUSTMENT") {
        const id = revisionText(current, "accountId");
        const account = accounts.find((item) => item.id === id);
        const increases = revisionText(current, "direction") === "INCREASE";
        addDelta(
          id,
          account?.type === "CREDIT_CARD"
            ? increases
              ? amountMinor
              : -amountMinor
            : increases
              ? -amountMinor
              : amountMinor,
        );
      } else if (transaction.kind === "CARD_PAYMENT") {
        addDelta(revisionText(current, "cardAccountId"), amountMinor);
        addDelta(revisionText(current, "fundingAccountId"), amountMinor);
      }
      const negativeAssets: Array<{
        accountName: string;
        amountMinor: ReturnType<typeof moneyMinor>;
      }> = [];
      const cardCredits: Array<{
        accountName: string;
        amountMinor: ReturnType<typeof moneyMinor>;
      }> = [];
      for (const [id, delta] of deltas) {
        const account = accounts.find((item) => item.id === id);
        if (!account) continue;
        const projected = BigInt(account.balanceMinor) + delta;
        if (account.type === "CREDIT_CARD" && projected < 0n) {
          cardCredits.push({
            accountName: account.name,
            amountMinor: moneyMinor((-projected).toString()),
          });
          continue;
        }
        if (account.type !== "CREDIT_CARD" && projected < 0n) {
          negativeAssets.push({
            accountName: account.name,
            amountMinor: moneyMinor(projected.toString()),
          });
        }
      }
      return { negativeAssets, cardCredits };
    } catch {
      return null;
    }
  }
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

  async function submitEdit(
    event: React.FormEvent<HTMLFormElement>,
    acknowledgeNegative = false,
    acknowledgeCardCredit = false,
  ) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!acknowledgeNegative && !acknowledgeCardCredit) {
      setEditNegativeConfirmation(false);
      setEditCardCreditConfirmation(false);
    }
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
    const body = {
      kind: transaction.kind,
      sourceAccountId: accountId,
      categoryId,
      amountMinor,
      occurredOn,
      ...(note.trim() ? { note: note.trim() } : {}),
      reason: reason.trim(),
      ...(acknowledgeNegative ? { acknowledgeNegativeBalance: true } : {}),
      ...(acknowledgeCardCredit ? { acknowledgeCardCreditBalance: true } : {}),
    };
    setPending(true);
    try {
      const idempotencyKey = await pendingSubmissionKey(
        profile!.user.id,
        `transaction-edit:${transactionId}`,
        body,
      );
      await apiRequest(`/transactions/${transactionId}`, {
        method: "PATCH",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      clearPendingSubmission(
        profile!.user.id,
        `transaction-edit:${transactionId}`,
        idempotencyKey,
      );
      setSuccess("Transaction updated and re-posted through the ledger.");
      setEditNegativeConfirmation(false);
      setEditCardCreditConfirmation(false);
      setReason("");
      await load();
    } catch (caught) {
      if (
        caught instanceof ApiRequestError &&
        isTerminalClientError(caught.status)
      ) {
        // The rejected command did not post. Keep the form usable for correction.
      }
      const message =
        caught instanceof Error
          ? caught.message
          : "The transaction could not be updated.";
      if (message.includes("card credit")) {
        setEditCardCreditConfirmation(true);
        setError(
          editNegativeConfirmation
            ? "Confirm the projected card credit and negative account balance below."
            : "Confirm the projected card credit below.",
        );
      } else if (message.includes("negative")) {
        setEditNegativeConfirmation(true);
        setError(
          editCardCreditConfirmation
            ? "Confirm the projected card credit and negative account balance below."
            : "Confirm the projected account balance below.",
        );
      } else {
        setError(message);
      }
    } finally {
      setPending(false);
    }
  }

  async function reverseTransaction(
    acknowledgeNegative = false,
    acknowledgeCardCredit = false,
  ) {
    setError("");
    setSuccess("");
    if (!transactionId || !csrfToken || !reason.trim()) {
      setError("Give the reversal a reason.");
      return;
    }
    setPending(true);
    const operation = `transaction-delete:${transactionId}`;
    let idempotencyKey: string | null = null;
    try {
      const body = {
        reason: reason.trim(),
        ...(acknowledgeNegative ? { acknowledgeNegativeBalance: true } : {}),
        ...(acknowledgeCardCredit
          ? { acknowledgeCardCreditBalance: true }
          : {}),
      };
      idempotencyKey = await pendingSubmissionKey(
        profile!.user.id,
        operation,
        body,
      );
      await apiRequest(`/transactions/${transactionId}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      clearPendingSubmission(profile!.user.id, operation, idempotencyKey);
      setReverseNegativeConfirmation(false);
      setReverseCreditConfirmation(false);
      setSuccess(
        "Transaction reversed. Its original journal remains immutable.",
      );
      setReason("");
      await load();
    } catch (caught) {
      if (
        idempotencyKey &&
        caught instanceof ApiRequestError &&
        isTerminalClientError(caught.status)
      ) {
        clearPendingSubmission(profile!.user.id, operation, idempotencyKey);
      }
      if (caught instanceof Error && caught.message.includes("card credit")) {
        setReverseCreditConfirmation(true);
        setError("Confirm the projected card credit shown below.");
        return;
      }
      if (caught instanceof Error && caught.message.includes("negative")) {
        setReverseNegativeConfirmation(true);
        setError("Confirm the projected negative balance shown below.");
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be reversed.",
      );
    } finally {
      setPending(false);
    }
  }

  const editEffects = projectedEditEffects();
  const reversalEffects = projectedReversalEffects();

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
          <form
            className="detail-edit-form"
            onSubmit={(event) =>
              void submitEdit(
                event,
                editNegativeConfirmation,
                editCardCreditConfirmation,
              )
            }
          >
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
                onChange={(event) => {
                  resetEditConfirmations();
                  setAmount(event.currentTarget.value);
                }}
              />
            </div>
            <div className="reference-grid">
              <label className="field-group">
                <span className="field-label">Account *</span>
                <select
                  className="reference-select"
                  value={accountId}
                  onChange={(event) => {
                    resetEditConfirmations();
                    setAccountId(event.currentTarget.value);
                  }}
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
                  onChange={(event) => {
                    resetEditConfirmations();
                    setCategoryId(event.currentTarget.value);
                  }}
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
                  onChange={(event) => {
                    resetEditConfirmations();
                    setOccurredOn(event.currentTarget.value);
                  }}
                />
              </label>
              <label className="field-group">
                <span className="field-label">Note</span>
                <input
                  className="text-input"
                  value={note}
                  onChange={(event) => {
                    resetEditConfirmations();
                    setNote(event.currentTarget.value);
                  }}
                  maxLength={500}
                />
              </label>
            </div>
            {editNegativeConfirmation || editCardCreditConfirmation ? (
              <div className="confirmation-panel" role="alert">
                {editNegativeConfirmation ? (
                  editEffects?.negativeAssets.length ? (
                    editEffects.negativeAssets.map((effect) => (
                      <p key={effect.accountName}>
                        This correction leaves {effect.accountName} at{" "}
                        {formatPhp(effect.balanceMinor)}.
                      </p>
                    ))
                  ) : (
                    <p>This correction leaves an affected account negative.</p>
                  )
                ) : null}
                {editCardCreditConfirmation &&
                editEffects?.cardCredits.length ? (
                  editEffects.cardCredits.map((credit) => (
                    <p key={credit.accountName}>
                      This correction leaves {credit.accountName} with a card
                      credit of {formatPhp(credit.creditMinor)}.
                    </p>
                  ))
                ) : editCardCreditConfirmation ? (
                  <p>This correction creates a projected card credit.</p>
                ) : null}
                {editNegativeConfirmation && editCardCreditConfirmation ? (
                  <p>Confirm both projected balances to continue.</p>
                ) : null}
                <button
                  className="save-button"
                  type="submit"
                  disabled={pending}
                >
                  {pending
                    ? "Saving…"
                    : editCardCreditConfirmation && editNegativeConfirmation
                      ? "Confirm both balances and save"
                      : editCardCreditConfirmation
                        ? "Confirm card credit and save"
                        : "Confirm negative balance and save"}
                </button>
              </div>
            ) : (
              <button className="save-button" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save revision"}
              </button>
            )}
          </form>
        ) : null}

        {transaction.status === "POSTED" ? (
          <label className="field-group detail-reason-field">
            <span className="field-label">Reason for edit or reversal *</span>
            <input
              className="text-input"
              value={reason}
              onChange={(event) => {
                resetEditConfirmations();
                setReason(event.currentTarget.value);
              }}
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
              onClick={() =>
                void reverseTransaction(
                  reverseNegativeConfirmation,
                  reverseCreditConfirmation,
                )
              }
              disabled={pending || !reason.trim()}
            >
              {pending
                ? "Reversing…"
                : reverseNegativeConfirmation && reverseCreditConfirmation
                  ? "Confirm both balances and reverse"
                  : reverseCreditConfirmation
                    ? "Confirm card credit and reverse"
                    : reverseNegativeConfirmation
                      ? "Confirm negative balance and reverse"
                      : "Reverse transaction"}
            </button>
            {reverseNegativeConfirmation || reverseCreditConfirmation ? (
              <p className="field-hint" role="alert">
                {[
                  ...(reversalEffects?.negativeAssets ?? []).map(
                    (effect) =>
                      `${effect.accountName} will be ${formatPhp(effect.amountMinor)} negative`,
                  ),
                  ...(reversalEffects?.cardCredits ?? []).map(
                    (effect) =>
                      `${effect.accountName} will have a card credit of ${formatPhp(effect.amountMinor)}`,
                  ),
                ].join(". ") || "The reversal has a negative projected balance"}
                . Confirm the requested balance changes by selecting the
                reversal button again.
              </p>
            ) : null}
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

function cardUtilization(account: AccountRecord): string | null {
  if (!account.creditLimitMinor) return null;
  const limit = BigInt(account.creditLimitMinor);
  const debt = BigInt(account.balanceMinor);
  if (limit <= 0n) return null;
  const boundedDebt = debt > 0n ? debt : 0n;
  const basisPoints = (boundedDebt * 10000n) / limit;
  return `${basisPoints / 100n}.${(basisPoints % 100n)
    .toString()
    .padStart(2, "0")}%`;
}

type AccountCreatePayload = {
  type: AccountRecord["type"];
  name: string;
  openingBalanceMinor: string;
  institution?: string;
  creditLimitMinor?: string;
};

function buildAccountCreatePayload(
  type: AccountRecord["type"],
  name: string,
  institution: string,
  openingBalance: string,
  creditLimit: string,
): AccountCreatePayload {
  if (!name.trim()) throw new Error("Give the account a name.");
  let openingBalanceMinor: string;
  try {
    openingBalanceMinor = parsePhpMinor(openingBalance || "0").toString();
    if (BigInt(openingBalanceMinor) < 0n) throw new Error("negative");
  } catch {
    throw new Error("Enter a valid non-negative PHP opening balance.");
  }
  let creditLimitMinor: string | undefined;
  if (type === "CREDIT_CARD" && creditLimit.trim()) {
    try {
      creditLimitMinor = parsePhpMinor(creditLimit).toString();
      if (BigInt(creditLimitMinor) <= 0n) throw new Error("positive");
    } catch {
      throw new Error("Enter a positive PHP credit limit.");
    }
  }
  return {
    type,
    name: name.trim(),
    openingBalanceMinor,
    ...(institution.trim() ? { institution: institution.trim() } : {}),
    ...(creditLimitMinor ? { creditLimitMinor } : {}),
  };
}

function AccountsPage() {
  const {
    profile,
    loading: authLoading,
    csrfToken,
    refreshProfile,
  } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [type, setType] = useState<AccountRecord["type"]>("BANK");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retrySubmissionId, setRetrySubmissionId] = useState<string | null>(
    null,
  );
  const accountActionId = useRef<string>(crypto.randomUUID());
  const accountSubmissionInFlight = useRef(false);
  const accountPayload = useMemo(() => {
    try {
      return buildAccountCreatePayload(
        type,
        name,
        institution,
        openingBalance,
        creditLimit,
      );
    } catch {
      return null;
    }
  }, [type, name, institution, openingBalance, creditLimit]);
  const accountPayloadSnapshot = accountPayload
    ? JSON.stringify(accountPayload)
    : null;
  const {
    entries: accountSubmissionMatches,
    payloadMatches: accountPayloadMatches,
    refresh: refreshAccountSubmissions,
  } = usePendingSubmissionMatches(
    profile?.user.id,
    "account:create",
    accountPayload,
  );
  const previousAccountPayload = useRef(accountPayloadSnapshot);
  useEffect(() => {
    if (previousAccountPayload.current !== accountPayloadSnapshot) {
      previousAccountPayload.current = accountPayloadSnapshot;
      setRetrySubmissionId(null);
      accountActionId.current = crypto.randomUUID();
    }
  }, [accountPayloadSnapshot]);
  useEffect(() => {
    if (retrySubmissionId && !accountPayloadMatches.has(retrySubmissionId))
      setRetrySubmissionId(null);
  }, [accountPayloadMatches, retrySubmissionId]);

  const fetchAccounts = useCallback(
    () =>
      apiRequest<{ accounts: AccountRecord[] }>(
        "/accounts?includeArchived=true",
      ),
    [],
  );
  const accountsResource = useLatestResource(
    `accounts:${profile?.user.id ?? "signed-out"}`,
    fetchAccounts,
    Boolean(profile),
  );
  const accounts = accountsResource.data?.accounts ?? [];

  useEffect(() => {
    if (accountsResource.errorStatus === 401) void refreshProfile();
  }, [accountsResource.errorStatus, refreshProfile]);

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accountSubmissionInFlight.current) return;
    setError("");
    setSuccess("");
    if (!csrfToken) {
      setError("Your session needs to be refreshed.");
      return;
    }
    if (!profile) {
      setError("Your session must be verified before creating an account.");
      return;
    }
    let body: AccountCreatePayload;
    try {
      body = buildAccountCreatePayload(
        type,
        name,
        institution,
        openingBalance,
        creditLimit,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Check the account details.",
      );
      return;
    }
    accountSubmissionInFlight.current = true;
    setPending(true);
    let idempotencyKey: string | null = null;
    let requestAttempted = false;
    try {
      const submission = await beginPendingSubmission(
        profile.user.id,
        "account:create",
        retrySubmissionId ?? accountActionId.current,
        body,
        Boolean(retrySubmissionId),
      );
      accountActionId.current = submission.id;
      idempotencyKey = submission.key;
      requestAttempted = true;
      await apiRequest("/accounts", {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": submission.key,
        },
        body: JSON.stringify(body),
      });
      clearPendingSubmission(profile.user.id, "account:create", submission.key);
      refreshAccountSubmissions();
      accountActionId.current = crypto.randomUUID();
      setRetrySubmissionId(null);
      setName("");
      setInstitution("");
      setOpeningBalance("");
      setCreditLimit("");
      setShowCreate(false);
      setSuccess("Account created with a ledger-backed opening balance.");
      await accountsResource.reload();
    } catch (caught) {
      const terminal =
        caught instanceof ApiRequestError &&
        isTerminalClientError(caught.status);
      if (terminal && idempotencyKey) {
        clearPendingSubmission(
          profile.user.id,
          "account:create",
          idempotencyKey,
        );
        accountActionId.current = crypto.randomUUID();
        setRetrySubmissionId(null);
        refreshAccountSubmissions();
      }
      const message =
        caught instanceof Error
          ? caught.message
          : "The account could not be created.";
      const outcomeUnknown =
        requestAttempted &&
        (!(caught instanceof ApiRequestError) ||
          caught.status === 408 ||
          caught.status >= 500);
      setError(
        outcomeUnknown
          ? `The account result could not be confirmed. Retry with the same details to safely recover it. ${message}`
          : message,
      );
      if (outcomeUnknown) refreshAccountSubmissions();
    } finally {
      accountSubmissionInFlight.current = false;
      setPending(false);
    }
  }

  if (authLoading || (accountsResource.loading && !accounts.length))
    return <DashboardLoading />;
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
          <h1 id="page-heading">Accounts</h1>
          <p className="page-description">
            Balances come from posted journals. Archive inactive accounts; their
            history remains available.
          </p>
        </div>
        <div className="dashboard-heading-actions">
          <button
            className="quiet-button"
            type="button"
            onClick={() => void accountsResource.reload()}
          >
            {accountsResource.refreshing ? "Refreshing…" : "Refresh balances"}
          </button>
          <button
            className="dashboard-primary-action"
            type="button"
            disabled={pending}
            onClick={() => {
              if (showCreate) {
                accountActionId.current = crypto.randomUUID();
                setRetrySubmissionId(null);
              }
              setShowCreate((current) => !current);
            }}
          >
            <span aria-hidden="true">+</span>{" "}
            {showCreate ? "Close form" : "Add account"}
          </button>
        </div>
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
      {accountsResource.error ? (
        <div className="dashboard-error" role="alert">
          <div>
            <strong>
              {accountsResource.stale
                ? "Account balances may be out of date"
                : "Accounts unavailable"}
            </strong>
            <p>
              {accountsResource.stale
                ? `The last loaded balances remain visible, but could not be refreshed. ${accountsResource.error}`
                : accountsResource.error}
            </p>
          </div>
          <button
            className="quiet-button"
            type="button"
            onClick={() => void accountsResource.reload()}
            disabled={accountsResource.refreshing}
          >
            {accountsResource.refreshing ? "Refreshing…" : "Retry"}
          </button>
        </div>
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
                onChange={(event) => {
                  accountActionId.current = crypto.randomUUID();
                  setRetrySubmissionId(null);
                  setName(event.currentTarget.value);
                }}
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
                onChange={(event) => {
                  accountActionId.current = crypto.randomUUID();
                  setRetrySubmissionId(null);
                  setOpeningBalance(event.currentTarget.value);
                }}
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
                onChange={(event) => {
                  accountActionId.current = crypto.randomUUID();
                  setRetrySubmissionId(null);
                  setInstitution(event.currentTarget.value);
                }}
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
                onChange={(event) => {
                  accountActionId.current = crypto.randomUUID();
                  setRetrySubmissionId(null);
                  setCreditLimit(event.currentTarget.value);
                }}
                placeholder="0.00"
              />
            </label>
          ) : null}
          <PendingSubmissionRecovery
            matches={accountSubmissionMatches}
            selectedId={retrySubmissionId}
            operationLabel="account creation"
            canRetry={(id) => accountPayloadMatches.has(id)}
            onSelect={setRetrySubmissionId}
            onStartNew={() => {
              accountActionId.current = crypto.randomUUID();
              setRetrySubmissionId(null);
            }}
          />
          <button className="save-button" type="submit" disabled={pending}>
            {pending
              ? "Creating…"
              : retrySubmissionId
                ? "Retry account creation"
                : "Create account"}
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
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!profile || !accountId) {
      loadSequence.current += 1;
      setAccount(null);
      setActivity([]);
      setLoading(false);
      return;
    }
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    setAccount(null);
    setActivity([]);
    try {
      const [accountResult, activityResult] = await Promise.all([
        apiRequest<{ account: AccountRecord }>(`/accounts/${accountId}`),
        apiRequest<{ activity: DashboardActivity[] }>(
          `/accounts/${accountId}/activity?limit=50`,
        ),
      ]);
      if (sequence !== loadSequence.current) return;
      setAccount(accountResult.account);
      setActivity(activityResult.activity);
      setName(accountResult.account.name);
      setSortOrder(String(accountResult.account.sortOrder));
    } catch (caught) {
      if (sequence !== loadSequence.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "The account could not be loaded.",
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
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

  const utilization = cardUtilization(account);

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
        {account.type === "CREDIT_CARD" ? (
          <div className="card-metrics" aria-label="Credit card metrics">
            <span>
              <strong>Limit</strong>{" "}
              {account.creditLimitMinor
                ? formatPhp(moneyMinor(account.creditLimitMinor))
                : "Unavailable"}
            </span>
            <span>
              <strong>Utilization</strong> {utilization ?? "Unavailable"}
              {utilization &&
              BigInt(account.balanceMinor) >
                BigInt(account.creditLimitMinor ?? "0")
                ? " · Over limit"
                : ""}
            </span>
          </div>
        ) : null}
      </div>

      {account.type === "CREDIT_CARD" && !account.archivedAt ? (
        <div className="card-detail-actions">
          <Link
            className="dashboard-primary-action card-pay-action"
            to={`/app/accounts/${account.id}/pay`}
          >
            Pay this card
          </Link>
          <Link
            className="quiet-link"
            to={`/app/accounts/${account.id}/statements`}
          >
            View statements
          </Link>
        </div>
      ) : null}

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

function CardStatementsPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const { profile, loading: authLoading, csrfToken } = useAuth();
  const [account, setAccount] = useState<AccountRecord | null>(null);
  const [statements, setStatements] = useState<CardStatementRecord[]>([]);
  const [statementDate, setStatementDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [amountDue, setAmountDue] = useState("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!profile || !accountId) {
      loadSequence.current += 1;
      setAccount(null);
      setStatements([]);
      setLoading(false);
      return;
    }
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    setAccount(null);
    setStatements([]);
    try {
      const [accountResult, statementResult] = await Promise.all([
        apiRequest<{ account: AccountRecord }>(`/accounts/${accountId}`),
        apiRequest<{ statements: CardStatementRecord[] }>(
          `/credit-cards/${accountId}/statements`,
        ),
      ]);
      if (sequence !== loadSequence.current) return;
      setAccount(accountResult.account);
      setStatements(statementResult.statements);
    } catch (caught) {
      if (sequence !== loadSequence.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Card statements could not be loaded.",
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [accountId, profile]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetStatementForm() {
    setEditingId(null);
    setStatementDate("");
    setPeriodStart("");
    setPeriodEnd("");
    setAmountDue("");
    setPaymentDueDate("");
    setNote("");
  }

  function editStatement(statement: CardStatementRecord) {
    setEditingId(statement.id);
    setStatementDate(statement.statementDate);
    setPeriodStart(statement.periodStart ?? "");
    setPeriodEnd(statement.periodEnd ?? "");
    setAmountDue(phpInputFromMinor(statement.amountDueMinor));
    setPaymentDueDate(statement.paymentDueDate);
    setNote(statement.note ?? "");
  }

  async function saveStatement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!accountId || !csrfToken || !statementDate || !paymentDueDate) {
      setError("Choose the statement and payment dates.");
      return;
    }
    let amountDueMinor: string;
    try {
      amountDueMinor = parsePhpMinor(amountDue || "0").toString();
    } catch {
      setError("Enter a valid non-negative PHP amount due.");
      return;
    }
    setPending(true);
    const operation = `card-statement:${accountId}:${editingId ?? "create"}`;
    let idempotencyKey: string | null = null;
    try {
      const body = {
        statementDate,
        ...(periodStart ? { periodStart } : {}),
        ...(periodEnd ? { periodEnd } : {}),
        amountDueMinor,
        paymentDueDate,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      idempotencyKey = await pendingSubmissionKey(profile!.user.id, operation, {
        method: editingId ? "PATCH" : "POST",
        body,
      });
      await apiRequest(
        editingId
          ? `/credit-cards/${accountId}/statements/${editingId}`
          : `/credit-cards/${accountId}/statements`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "x-csrf-token": csrfToken,
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(body),
        },
      );
      clearPendingSubmission(profile!.user.id, operation, idempotencyKey);
      setSuccess(editingId ? "Statement corrected." : "Statement recorded.");
      resetStatementForm();
      await load();
    } catch (caught) {
      if (
        idempotencyKey &&
        caught instanceof ApiRequestError &&
        isTerminalClientError(caught.status)
      ) {
        clearPendingSubmission(profile!.user.id, operation, idempotencyKey);
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "The statement could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  if (authLoading || loading) return <DashboardLoading />;
  if (!profile) {
    return (
      <RoutePage
        eyebrow="Credit card statements"
        title="Statements"
        description="Statement snapshots and payment allocations are private to the card owner."
        icon="□"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }
  if (!account || account.type !== "CREDIT_CARD") {
    return (
      <RoutePage
        eyebrow="Credit card statements"
        title="Card unavailable."
        description={
          error || "The requested card is not available to this owner."
        }
        icon="□"
        linkTo="/app/accounts"
        linkLabel="Back to Accounts"
      />
    );
  }

  return (
    <section
      className="route-page statements-page"
      aria-labelledby="page-heading"
    >
      <div className="page-intro">
        <p className="eyebrow">Credit cards · Statements</p>
        <h1 id="page-heading">{account.name} statements.</h1>
        <p className="page-description">
          Enter the issuer snapshot manually. Statement amounts stay separate
          from overall card debt and never create ledger postings.
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="form-success" role="status">
          {success}
        </p>
      ) : null}
      <form
        className="account-edit-card statement-form"
        onSubmit={saveStatement}
      >
        <div className="form-heading">
          <div>
            <p className="form-kicker">
              {editingId ? "CORRECT STATEMENT" : "NEW STATEMENT"}
            </p>
            <h2>
              {editingId
                ? "Keep the issuer record accurate"
                : "Record an issuer snapshot"}
            </h2>
          </div>
          {editingId ? (
            <button
              className="quiet-button"
              type="button"
              onClick={resetStatementForm}
            >
              Cancel
            </button>
          ) : null}
        </div>
        <div className="reference-grid">
          <label className="field-group">
            <span className="field-label">Statement date *</span>
            <input
              className="text-input"
              type="date"
              value={statementDate}
              onChange={(event) => setStatementDate(event.currentTarget.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-label">Payment due date *</span>
            <input
              className="text-input"
              type="date"
              value={paymentDueDate}
              onChange={(event) => setPaymentDueDate(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="reference-grid">
          <label className="field-group">
            <span className="field-label">
              Period start <span className="field-optional">Optional</span>
            </span>
            <input
              className="text-input"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.currentTarget.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-label">
              Period end <span className="field-optional">Optional</span>
            </span>
            <input
              className="text-input"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.currentTarget.value)}
            />
          </label>
        </div>
        <label className="field-group">
          <span className="field-label">Amount due *</span>
          <input
            className="text-input"
            type="text"
            inputMode="decimal"
            value={amountDue}
            onChange={(event) => setAmountDue(event.currentTarget.value)}
            placeholder="0.00"
          />
        </label>
        <label className="field-group">
          <span className="field-label">
            Note <span className="field-optional">Optional</span>
          </span>
          <input
            className="text-input"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="Issuer reference"
          />
        </label>
        <button className="save-button" type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : editingId
              ? "Save statement correction"
              : "Record statement"}
        </button>
      </form>
      <section
        className="statement-list"
        aria-labelledby="statement-history-heading"
      >
        <div className="dashboard-panel-heading">
          <div>
            <p className="dashboard-label">Statement history</p>
            <h2 id="statement-history-heading">Issuer snapshots</h2>
          </div>
        </div>
        {statements.length ? (
          statements.map((statement) => (
            <article className="statement-row" key={statement.id}>
              <div className="statement-row-main">
                <strong>{statement.statementDate}</strong>
                <span>
                  Due {statement.paymentDueDate}
                  {statement.note ? ` · ${statement.note}` : ""}
                </span>
              </div>
              <div className="statement-row-amount">
                <PrivacyMask label="statement amount due">
                  {dashboardMoney(statement.amountDueMinor)}
                </PrivacyMask>
                <span>
                  {statement.remainingDueMinor === "0" ? (
                    "Paid or allocated"
                  ) : (
                    <PrivacyMask label="statement remaining due">
                      {`${formatPhp(moneyMinor(statement.remainingDueMinor))} remaining`}
                    </PrivacyMask>
                  )}
                </span>
              </div>
              <button
                className="quiet-button"
                type="button"
                onClick={() => editStatement(statement)}
              >
                Edit statement
              </button>
            </article>
          ))
        ) : (
          <div className="dashboard-empty">
            <p>No statement snapshots yet.</p>
            <p>
              Record the amount shown by your issuer to track payment allocation
              separately from card debt.
            </p>
          </div>
        )}
      </section>
      <Link className="quiet-link" to={`/app/accounts/${account.id}`}>
        Back to card
      </Link>
    </section>
  );
}

function CardPaymentPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const { profile, loading: authLoading, csrfToken } = useAuth();
  const [card, setCard] = useState<AccountRecord | null>(null);
  const [fundingAccounts, setFundingAccounts] = useState<AccountRecord[]>([]);
  const [fundingAccountId, setFundingAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(profile?.serverToday ?? "");
  const [businessToday, setBusinessToday] = useState(
    profile?.serverToday ?? "",
  );
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirmedNegative, setConfirmedNegative] = useState(false);
  const [confirmedCardCredit, setConfirmedCardCredit] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<
    "negative" | "card-credit" | null
  >(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retrySubmissionId, setRetrySubmissionId] = useState<string | null>(
    null,
  );
  const isOnline = useOnlineStatus();
  const submissionInFlight = useRef(false);
  const dateEdited = useRef(false);
  const paymentFormEdited = useRef(false);
  const loadSequence = useRef(0);
  const actionId = useRef<string>(crypto.randomUUID());
  const paymentPayload = useMemo(() => {
    if (!accountId || !fundingAccountId || !occurredOn) return null;
    try {
      const parsed = parsePhpMinor(amount);
      if (parsed <= 0n) return null;
      return {
        fundingAccountId,
        amountMinor: parsed.toString(),
        occurredOn,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(confirmedNegative ? { acknowledgeNegativeBalance: true } : {}),
        ...(confirmedCardCredit ? { acknowledgeCardCreditBalance: true } : {}),
      };
    } catch {
      return null;
    }
  }, [
    accountId,
    amount,
    fundingAccountId,
    note,
    occurredOn,
    confirmedNegative,
    confirmedCardCredit,
  ]);
  const paymentPayloadSnapshot = paymentPayload
    ? JSON.stringify(paymentPayload)
    : null;
  const paymentOperation = `card-payment:${accountId ?? "unknown"}`;
  const {
    entries: paymentMatches,
    payloadMatches: paymentPayloadMatches,
    refresh: refreshPaymentSubmissions,
  } = usePendingSubmissionMatches(
    profile?.user.id,
    paymentOperation,
    paymentPayload,
  );
  const previousPaymentPayload = useRef(paymentPayloadSnapshot);
  useEffect(() => {
    if (previousPaymentPayload.current !== paymentPayloadSnapshot) {
      previousPaymentPayload.current = paymentPayloadSnapshot;
      setRetrySubmissionId(null);
      actionId.current = crypto.randomUUID();
    }
  }, [paymentPayloadSnapshot]);
  useEffect(() => {
    if (retrySubmissionId && !paymentPayloadMatches.has(retrySubmissionId))
      setRetrySubmissionId(null);
  }, [paymentPayloadMatches, retrySubmissionId]);

  const load = useCallback(async () => {
    if (!profile || !accountId) {
      setLoading(false);
      return;
    }
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const [cardResult, accountsResult, currentProfile] = await Promise.all([
        apiRequest<{ account: AccountRecord }>(`/accounts/${accountId}`),
        apiRequest<{ accounts: AccountRecord[] }>("/accounts"),
        apiRequest<Profile>("/me"),
      ]);
      if (sequence !== loadSequence.current) return;
      setCard(cardResult.account);
      const assets = accountsResult.accounts.filter(
        (account) =>
          !account.archivedAt &&
          account.type !== "CREDIT_CARD" &&
          account.id !== accountId,
      );
      setFundingAccounts(assets);
      setFundingAccountId((current) => current || assets[0]?.id || "");
      setBusinessToday(currentProfile.serverToday);
      if (!dateEdited.current && !paymentFormEdited.current)
        setOccurredOn(currentProfile.serverToday);
    } catch (caught) {
      if (sequence !== loadSequence.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "The card could not be loaded.",
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [accountId, profile]);

  useEffect(() => {
    void load();
  }, [load]);

  function parsePaymentAmount(): string {
    try {
      const parsed = parsePhpMinor(amount);
      if (parsed <= 0n) throw new Error();
      return parsed.toString();
    } catch {
      throw new Error("Enter a positive PHP payment amount.");
    }
  }

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
    acknowledgeNegative = confirmedNegative,
    acknowledgeCardCredit = confirmedCardCredit,
  ) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    setError("");
    setSuccess("");
    if (!isOnline) {
      setError("You are offline. Reconnect before recording a payment.");
      return;
    }
    if (!profile || !accountId || !csrfToken || !fundingAccountId) {
      setError("Choose a funding account.");
      return;
    }
    let amountMinor: string;
    try {
      amountMinor = parsePaymentAmount();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Enter a valid amount.",
      );
      return;
    }
    const body = {
      fundingAccountId,
      amountMinor,
      occurredOn,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(acknowledgeNegative ? { acknowledgeNegativeBalance: true } : {}),
      ...(acknowledgeCardCredit ? { acknowledgeCardCreditBalance: true } : {}),
    };
    setConfirmedNegative(acknowledgeNegative);
    setConfirmedCardCredit(acknowledgeCardCredit);
    submissionInFlight.current = true;
    setPending(true);
    let idempotencyKey: string | null = null;
    let requestAttempted = false;
    try {
      const submission = await beginPendingSubmission(
        profile.user.id,
        paymentOperation,
        retrySubmissionId ?? actionId.current,
        body,
        Boolean(retrySubmissionId),
      );
      actionId.current = submission.id;
      idempotencyKey = submission.key;
      requestAttempted = true;
      await apiRequest(`/credit-cards/${accountId}/payments`, {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      clearPendingSubmission(profile.user.id, paymentOperation, submission.key);
      refreshPaymentSubmissions();
      actionId.current = crypto.randomUUID();
      setRetrySubmissionId(null);
      setAmount("");
      setNote("");
      setConfirmedNegative(false);
      setConfirmedCardCredit(false);
      setPendingConfirmation(null);
      dateEdited.current = false;
      paymentFormEdited.current = false;
      setSuccess("Card payment posted. It is not counted as a new expense.");
      await load();
    } catch (caught) {
      if (
        idempotencyKey &&
        caught instanceof ApiRequestError &&
        isTerminalClientError(caught.status)
      ) {
        clearPendingSubmission(
          profile.user.id,
          paymentOperation,
          idempotencyKey,
        );
        actionId.current = crypto.randomUUID();
        setRetrySubmissionId(null);
        refreshPaymentSubmissions();
      }
      const message =
        caught instanceof Error
          ? caught.message
          : "The card payment could not be saved.";
      if (message.includes("negative")) {
        if (idempotencyKey) {
          clearPendingSubmission(
            profile.user.id,
            paymentOperation,
            idempotencyKey,
          );
          actionId.current = crypto.randomUUID();
          setRetrySubmissionId(null);
          refreshPaymentSubmissions();
        }
        setConfirmedNegative(acknowledgeNegative);
        setConfirmedCardCredit(acknowledgeCardCredit);
        setPendingConfirmation("negative");
        setError("Confirm the projected funding account balance below.");
      } else if (message.includes("card credit")) {
        if (idempotencyKey) {
          clearPendingSubmission(
            profile.user.id,
            paymentOperation,
            idempotencyKey,
          );
          actionId.current = crypto.randomUUID();
          setRetrySubmissionId(null);
          refreshPaymentSubmissions();
        }

        setConfirmedNegative(acknowledgeNegative);
        setConfirmedCardCredit(acknowledgeCardCredit);
        setPendingConfirmation("card-credit");
        setError("Confirm the projected card credit below.");
      } else if (
        !requestAttempted ||
        (caught instanceof ApiRequestError &&
          caught.status !== 408 &&
          caught.status < 500)
      ) {
        setError(message);
      } else {
        setError(
          `The payment result could not be confirmed. If it reached MoniKey, retry using the same details to safely recover its result. ${message}`,
        );
        refreshPaymentSubmissions();
      }
    } finally {
      submissionInFlight.current = false;
      setPending(false);
    }
  }

  function resetPaymentConfirmations() {
    setConfirmedNegative(false);
    setConfirmedCardCredit(false);
    setPendingConfirmation(null);
  }

  if (authLoading || loading) return <DashboardLoading />;
  if (!profile) {
    return (
      <RoutePage
        eyebrow="Credit card payment"
        title="Sign in to pay a card."
        description="Card payments are private ledger actions between your card and a funding account."
        icon="◇"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }
  if (!card || card.type !== "CREDIT_CARD") {
    return (
      <RoutePage
        eyebrow="Credit card payment"
        title="Card unavailable."
        description={
          error || "The requested credit card is not available to this owner."
        }
        icon="◇"
        linkTo="/app/accounts"
        linkLabel="Back to Accounts"
      />
    );
  }

  return (
    <section className="route-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Credit card · Payment</p>
        <h1 id="page-heading">Pay {card.name}.</h1>
        <p className="page-description">
          Settle card liability from cash, bank, or e-wallet money. This payment
          does not create another expense.
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="form-success" role="status">
          {success}
        </p>
      ) : null}
      <form
        className="quick-add-card card-payment-card"
        onSubmit={(event) => void submit(event)}
        onChangeCapture={() => {
          paymentFormEdited.current = true;
        }}
      >
        <div className="account-detail-hero compact">
          <span className="dashboard-label">Outstanding debt</span>
          <PrivacyMask label={`${card.name} debt`}>
            {dashboardMoney(card.balanceMinor)}
          </PrivacyMask>
          <span className="dashboard-helper">
            {card.creditLimitMinor
              ? `Limit ${formatPhp(moneyMinor(card.creditLimitMinor))}`
              : "Limit unavailable"}
          </span>
        </div>
        <label className="field-group">
          <span className="field-label">Payment amount *</span>
          <input
            className="text-input"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              resetPaymentConfirmations();
              setAmount(event.currentTarget.value);
            }}
            placeholder="0.00"
          />
        </label>
        <label className="field-group">
          <span className="field-label">Funding account *</span>
          <select
            className="reference-select"
            value={fundingAccountId}
            onChange={(event) => {
              resetPaymentConfirmations();
              setFundingAccountId(event.currentTarget.value);
            }}
            disabled={!fundingAccounts.length}
          >
            <option value="">Choose a funding account</option>
            {fundingAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {formatPhp(moneyMinor(account.balanceMinor))}
              </option>
            ))}
          </select>
        </label>
        <div className="reference-grid quick-add-details">
          <label className="field-group">
            <span className="field-label">Date *</span>
            <input
              className="text-input"
              type="date"
              value={occurredOn}
              max={businessToday}
              onChange={(event) => {
                dateEdited.current = true;
                resetPaymentConfirmations();
                setOccurredOn(event.currentTarget.value);
              }}
            />
          </label>
          <label className="field-group">
            <span className="field-label">
              Note <span className="field-optional">Optional</span>
            </span>
            <input
              className="text-input"
              value={note}
              maxLength={500}
              onChange={(event) => {
                resetPaymentConfirmations();
                setNote(event.currentTarget.value);
              }}
              placeholder="Statement payment"
            />
          </label>
        </div>
        <PendingSubmissionRecovery
          matches={paymentMatches}
          selectedId={retrySubmissionId}
          operationLabel="card payment"
          canRetry={(id) => paymentPayloadMatches.has(id)}
          onSelect={setRetrySubmissionId}
          onStartNew={() => {
            actionId.current = crypto.randomUUID();
            setRetrySubmissionId(null);
          }}
        />
        {pendingConfirmation ? (
          <div className="confirmation-panel" role="alert">
            <p>
              {pendingConfirmation === "card-credit"
                ? `This payment will create a card credit balance of ${(() => {
                    try {
                      const paymentMinor = BigInt(parsePaymentAmount());
                      const projected =
                        BigInt(card.balanceMinor) - paymentMinor;
                      return formatPhp(moneyMinor((-projected).toString()));
                    } catch {
                      return "the projected amount";
                    }
                  })()} on ${card.name}. ${confirmedNegative ? "Your separate funding overdraft confirmation is retained." : "Confirm the card credit to continue."}`
                : `This payment will leave ${fundingAccounts.find((account) => account.id === fundingAccountId)?.name ?? "the funding account"} at ${(() => {
                    try {
                      const funding = fundingAccounts.find(
                        (account) => account.id === fundingAccountId,
                      );
                      return formatPhp(
                        moneyMinor(
                          (
                            BigInt(funding?.balanceMinor ?? "0") -
                            BigInt(parsePaymentAmount())
                          ).toString(),
                        ),
                      );
                    } catch {
                      return "the projected balance";
                    }
                  })()}. Confirm the overdraft to continue.`}
            </p>
            <button
              className="save-button"
              type="button"
              disabled={pending || !isOnline}
              onClick={(event) =>
                void submit(
                  event as unknown as React.FormEvent<HTMLFormElement>,
                  confirmedNegative || pendingConfirmation === "negative",
                  confirmedCardCredit || pendingConfirmation === "card-credit",
                )
              }
            >
              Confirm and pay
            </button>
          </div>
        ) : (
          <button
            className="save-button"
            type="submit"
            disabled={pending || !fundingAccounts.length || !isOnline}
          >
            {pending
              ? "Saving…"
              : retrySubmissionId
                ? "Retry saved payment"
                : "Record card payment"}
          </button>
        )}
      </form>
      <Link className="quiet-link" to={`/app/accounts/${card.id}`}>
        Back to card
      </Link>
    </section>
  );
}

type BillRecord = {
  id: string;
  name: string;
  categoryId: string;
  suggestedAccountId: string | null;
  amountMode: "FIXED" | "VARIABLE";
  defaultAmountMinor: string | null;
  dueDay: number;
  startOn: string;
  endOn: string | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type BillOccurrence = {
  id: string;
  billId: string;
  billName: string;
  categoryId: string;
  suggestedAccountId: string | null;
  amountMode: "FIXED" | "VARIABLE";
  expectedAmountMinor: string | null;
  actualAmountMinor: string | null;
  dueOn: string;
  status: "UPCOMING" | "OVERDUE" | "PAID" | "SKIPPED";
  paidTransactionId: string | null;
  note: string | null;
};

function billWindow(today: string) {
  const [year = 1970, month = 1] = today.split("-").slice(0, 2).map(Number);
  const end = new Date(Date.UTC(year, month - 1 + 3, 0));
  return {
    from: `${today.slice(0, 7)}-01`,
    to: `${end.getUTCFullYear().toString().padStart(4, "0")}-${(end.getUTCMonth() + 1).toString().padStart(2, "0")}-${end.getUTCDate().toString().padStart(2, "0")}`,
  };
}

function BillsPage() {
  const { profile, loading: authLoading, csrfToken } = useAuth();
  const isOnline = useOnlineStatus();
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [occurrences, setOccurrences] = useState<BillOccurrence[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [categories, setCategories] = useState<QuickAddCategory[]>([]);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [suggestedAccountId, setSuggestedAccountId] = useState("");
  const [amountMode, setAmountMode] =
    useState<BillRecord["amountMode"]>("FIXED");
  const [defaultAmount, setDefaultAmount] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [startOn, setStartOn] = useState(profile?.serverToday ?? "");
  const [endOn, setEndOn] = useState("");
  const [businessToday, setBusinessToday] = useState(
    profile?.serverToday ?? "",
  );
  const [note, setNote] = useState("");
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [showArchivedBills, setShowArchivedBills] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [confirmPayOccurrenceId, setConfirmPayOccurrenceId] = useState<
    string | null
  >(null);
  const [payAmount, setPayAmount] = useState("");
  const [payAccountId, setPayAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const startOnEdited = useRef(false);
  const billFormEdited = useRef(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!profile) {
      setLoading(false);
      return;
    }
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const currentProfile = await apiRequest<Profile>("/me");
      const window = billWindow(currentProfile.serverToday);
      const [billResult, occurrenceResult, accountResult, categoryResult] =
        await Promise.all([
          apiRequest<{ bills: BillRecord[] }>(
            `/bills${showArchivedBills ? "?includeArchived=true" : ""}`,
          ),
          apiRequest<{ occurrences: BillOccurrence[] }>(
            `/bills/occurrences?from=${window.from}&to=${window.to}`,
          ),
          apiRequest<{ accounts: AccountRecord[] }>("/accounts"),
          apiRequest<{ categories: QuickAddCategory[] }>("/categories"),
        ]);
      if (sequence !== loadSequence.current) return;
      setBusinessToday(currentProfile.serverToday);
      setBills(billResult.bills);
      setOccurrences(occurrenceResult.occurrences);
      const activeAccounts = accountResult.accounts.filter(
        (account) => !account.archivedAt && account.type !== "CREDIT_CARD",
      );
      const expenseCategories = categoryResult.categories.filter(
        (category) => !category.archivedAt && category.kind === "EXPENSE",
      );
      setAccounts(activeAccounts);
      setCategories(expenseCategories);
      setCategoryId((current) => current || expenseCategories[0]?.id || "");
      setPayAccountId((current) => current || activeAccounts[0]?.id || "");
      if (!startOnEdited.current && !billFormEdited.current)
        setStartOn(currentProfile.serverToday);
    } catch (caught) {
      if (sequence !== loadSequence.current) return;
      setError(
        caught instanceof Error ? caught.message : "Bills could not be loaded.",
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [profile, showArchivedBills]);

  useEffect(() => {
    void load();
  }, [load]);

  function billPaymentAmountMinor(occurrence: BillOccurrence): bigint {
    if (occurrence.amountMode === "VARIABLE") {
      return parsePhpMinor(payAmount);
    }
    return moneyMinor(occurrence.expectedAmountMinor ?? "0");
  }

  function projectedBillFundingBalance(occurrence: BillOccurrence) {
    const balance = accounts.find(
      (account) => account.id === payAccountId,
    )?.balanceMinor;
    return moneyMinor(
      (BigInt(balance ?? "0") - billPaymentAmountMinor(occurrence)).toString(),
    );
  }

  function resetBillForm() {
    setEditingBillId(null);
    setName("");
    setCategoryId(categories[0]?.id ?? "");
    setSuggestedAccountId("");
    setAmountMode("FIXED");
    setDefaultAmount("");
    setDueDay("1");
    setStartOn(businessToday);
    setEndOn("");
    setNote("");
  }

  function editBill(bill: BillRecord) {
    startOnEdited.current = true;
    billFormEdited.current = true;
    setEditingBillId(bill.id);
    setName(bill.name);
    setCategoryId(bill.categoryId);
    setSuggestedAccountId(bill.suggestedAccountId ?? "");
    setAmountMode(bill.amountMode);
    setDefaultAmount(
      bill.defaultAmountMinor ? phpInputFromMinor(bill.defaultAmountMinor) : "",
    );
    setDueDay(String(bill.dueDay));
    setStartOn(bill.startOn);
    setEndOn(bill.endOn ?? "");
    setNote(bill.note ?? "");
  }

  async function saveBillRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!csrfToken || !name.trim() || !categoryId || !startOn) {
      setError("Enter a bill name, expense category, and start date.");
      return;
    }
    let amountMinor: string | undefined;
    if (amountMode === "FIXED") {
      try {
        const parsed = parsePhpMinor(defaultAmount);
        if (parsed <= 0n) throw new Error();
        amountMinor = parsed.toString();
      } catch {
        setError("Fixed bills need a positive PHP amount.");
        return;
      }
    }
    setPending(true);
    const operation = `bill:${editingBillId ?? "create"}`;
    let idempotencyKey: string | null = null;
    try {
      const body = {
        name: name.trim(),
        categoryId,
        amountMode,
        ...(suggestedAccountId
          ? { suggestedAccountId }
          : editingBillId
            ? { suggestedAccountId: null }
            : {}),
        ...(amountMode === "FIXED" && amountMinor
          ? { defaultAmountMinor: amountMinor }
          : editingBillId
            ? { defaultAmountMinor: null }
            : {}),
        dueDay: Number(dueDay),
        startOn,
        ...(endOn ? { endOn } : editingBillId ? { endOn: null } : {}),
        ...(note.trim()
          ? { note: note.trim() }
          : editingBillId
            ? { note: null }
            : {}),
      };
      idempotencyKey = await pendingSubmissionKey(profile!.user.id, operation, {
        method: editingBillId ? "PATCH" : "POST",
        body,
      });
      await apiRequest(editingBillId ? `/bills/${editingBillId}` : "/bills", {
        method: editingBillId ? "PATCH" : "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      clearPendingSubmission(profile!.user.id, operation, idempotencyKey);
      setSuccess(
        editingBillId
          ? "Bill rule updated. Paid and skipped history remains available."
          : "Bill created. Its upcoming occurrences are ready to review.",
      );
      resetBillForm();
      startOnEdited.current = false;
      billFormEdited.current = false;
      await load();
    } catch (caught) {
      if (
        idempotencyKey &&
        caught instanceof ApiRequestError &&
        isTerminalClientError(caught.status)
      ) {
        clearPendingSubmission(profile!.user.id, operation, idempotencyKey);
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "The bill could not be created.",
      );
    } finally {
      setPending(false);
    }
  }

  async function changeBillStatus(
    bill: BillRecord,
    status: BillRecord["status"],
  ) {
    if (!profile || !csrfToken || !isOnline || pending) return;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const body = { status };
      const operation = `bill-status:${bill.id}`;
      const idempotencyKey = await pendingSubmissionKey(
        profile.user.id,
        operation,
        body,
      );
      await apiRequest(`/bills/${bill.id}`, {
        method: "PATCH",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      clearPendingSubmission(profile.user.id, operation, idempotencyKey);
      setSuccess(
        status === "ARCHIVED"
          ? `${bill.name} archived. Its payment history remains available.`
          : `Reminder ${status === "PAUSED" ? "paused" : "resumed"}.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Bill rule could not be updated.",
      );
    } finally {
      setPending(false);
    }
  }

  async function payOccurrence(
    occurrence: BillOccurrence,
    acknowledge = false,
  ) {
    if (!csrfToken || !payAccountId || !isOnline) return;
    let amountMinor: string | undefined;
    try {
      if (occurrence.amountMode === "VARIABLE") {
        const parsed = parsePhpMinor(payAmount);
        if (parsed <= 0n) throw new Error();
        amountMinor = parsed.toString();
      }
    } catch {
      setError("Variable bills need a positive payment amount.");
      return;
    }
    setPending(true);
    setError("");
    setConfirmPayOccurrenceId(null);
    let idempotencyKey: string | null = null;
    try {
      const body = {
        fundingAccountId: payAccountId,
        ...(amountMinor ? { amountMinor } : {}),
        ...(acknowledge ? { acknowledgeNegativeBalance: true } : {}),
      };
      idempotencyKey = await pendingSubmissionKey(
        profile!.user.id,
        `bill-payment:${occurrence.id}`,
        body,
      );
      await apiRequest(`/bills/occurrences/${occurrence.id}/pay`, {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      clearPendingSubmission(
        profile!.user.id,
        `bill-payment:${occurrence.id}`,
        idempotencyKey,
      );
      setPayingId(null);
      setConfirmPayOccurrenceId(null);
      setPayAmount("");
      setSuccess(`${occurrence.billName} marked paid and posted to Activity.`);
      await load();
    } catch (caught) {
      if (
        idempotencyKey &&
        caught instanceof ApiRequestError &&
        isTerminalClientError(caught.status)
      ) {
        clearPendingSubmission(
          profile!.user.id,
          `bill-payment:${occurrence.id}`,
          idempotencyKey,
        );
      }
      if (caught instanceof Error && caught.message.includes("negative")) {
        setConfirmPayOccurrenceId(occurrence.id);
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "The bill could not be paid.",
      );
    } finally {
      setPending(false);
    }
  }

  async function skipOccurrence(occurrence: BillOccurrence) {
    if (!csrfToken || !isOnline) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/bills/occurrences/${occurrence.id}/skip`, {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: "{}",
      });
      setSuccess(`${occurrence.billName} occurrence skipped.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The occurrence could not be skipped.",
      );
    } finally {
      setPending(false);
    }
  }

  if (authLoading || loading) return <DashboardLoading />;
  if (!profile) {
    return (
      <RoutePage
        eyebrow="Plan ahead"
        title="Bills"
        description="Recurring bills and their payment history stay private to your account."
        icon="□"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }

  return (
    <section className="route-page bills-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Plan ahead · Private</p>
        <h1 id="page-heading">Bills</h1>
        <p className="page-description">
          Track recurring reminders. Confirm payment before a bill posts one
          expense to your ledger.
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="form-success" role="status">
          {success}
        </p>
      ) : null}
      <form
        className="account-edit-card bill-form"
        onSubmit={saveBillRecord}
        onChangeCapture={() => {
          billFormEdited.current = true;
        }}
      >
        <div className="form-heading">
          <div>
            <p className="form-kicker">
              {editingBillId ? "EDIT RECURRING BILL" : "NEW RECURRING BILL"}
            </p>
            <h2>
              {editingBillId
                ? "Update reminder details"
                : "Set up a monthly reminder"}
            </h2>
          </div>
        </div>
        <div className="reference-grid">
          <label className="field-group">
            <span className="field-label">Name *</span>
            <input
              className="text-input"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Internet"
            />
          </label>
          <label className="field-group">
            <span className="field-label">Expense category *</span>
            <select
              className="reference-select"
              value={categoryId}
              onChange={(event) => setCategoryId(event.currentTarget.value)}
            >
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field-group">
          <span className="field-label">
            End date <span className="field-optional">Optional</span>
          </span>
          <input
            className="text-input"
            type="date"
            value={endOn}
            min={startOn || undefined}
            onChange={(event) => setEndOn(event.currentTarget.value)}
          />
        </label>
        <div className="reference-grid">
          <label className="field-group">
            <span className="field-label">Amount type *</span>
            <select
              className="reference-select"
              value={amountMode}
              onChange={(event) =>
                setAmountMode(
                  event.currentTarget.value as BillRecord["amountMode"],
                )
              }
            >
              <option value="FIXED">Fixed</option>
              <option value="VARIABLE">Variable</option>
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">
              Default amount{" "}
              {amountMode === "VARIABLE" ? (
                <span className="field-optional">Not used</span>
              ) : (
                "*"
              )}
            </span>
            <input
              className="text-input"
              type="text"
              inputMode="decimal"
              value={defaultAmount}
              disabled={amountMode === "VARIABLE"}
              onChange={(event) => setDefaultAmount(event.currentTarget.value)}
              placeholder="0.00"
            />
          </label>
        </div>
        <div className="reference-grid">
          <label className="field-group">
            <span className="field-label">Due day *</span>
            <input
              className="text-input"
              type="number"
              min="1"
              max="31"
              value={dueDay}
              onChange={(event) => setDueDay(event.currentTarget.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-label">Start date *</span>
            <input
              className="text-input"
              type="date"
              value={startOn}
              onChange={(event) => {
                startOnEdited.current = true;
                setStartOn(event.currentTarget.value);
              }}
            />
          </label>
        </div>
        <label className="field-group">
          <span className="field-label">
            Suggested funding account{" "}
            <span className="field-optional">Optional</span>
          </span>
          <select
            className="reference-select"
            value={suggestedAccountId}
            onChange={(event) =>
              setSuggestedAccountId(event.currentTarget.value)
            }
          >
            <option value="">Choose later</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-group">
          <span className="field-label">
            Note <span className="field-optional">Optional</span>
          </span>
          <input
            className="text-input"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="Renewal or account reference"
          />
        </label>
        <button
          className="save-button"
          type="submit"
          disabled={pending || !isOnline}
        >
          {pending
            ? "Saving…"
            : editingBillId
              ? "Save bill changes"
              : "Create bill"}
        </button>
        {editingBillId ? (
          <button
            className="quiet-button"
            type="button"
            disabled={pending}
            onClick={resetBillForm}
          >
            Cancel editing
          </button>
        ) : null}
      </form>
      <section className="bill-section" aria-labelledby="bill-list-heading">
        <div className="dashboard-panel-heading">
          <div>
            <p className="dashboard-label">Saved reminders</p>
            <h2 id="bill-list-heading">Your recurring bills</h2>
          </div>
          <label className="filter-toggle">
            <input
              type="checkbox"
              checked={showArchivedBills}
              onChange={(event) =>
                setShowArchivedBills(event.currentTarget.checked)
              }
            />
            <span>Show archived</span>
          </label>
        </div>
        {bills.length ? (
          <div className="bill-list">
            {bills.map((bill) => (
              <article className="bill-row" key={bill.id}>
                <div>
                  <strong>{bill.name}</strong>
                  <span>
                    {bill.amountMode === "FIXED" && bill.defaultAmountMinor ? (
                      <PrivacyMask label={`${bill.name} default amount`}>
                        {formatPhp(moneyMinor(bill.defaultAmountMinor))}
                      </PrivacyMask>
                    ) : (
                      "Variable amount"
                    )}{" "}
                    · Due day {bill.dueDay} · {bill.status.toLowerCase()}
                  </span>
                </div>
                <div className="bill-row-actions">
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={pending || !isOnline}
                    onClick={() => editBill(bill)}
                  >
                    Edit
                  </button>
                  {bill.status === "ARCHIVED" ? (
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={pending || !isOnline}
                      onClick={() => void changeBillStatus(bill, "ACTIVE")}
                    >
                      Restore
                    </button>
                  ) : (
                    <>
                      <button
                        className="quiet-button"
                        type="button"
                        disabled={pending || !isOnline}
                        onClick={() =>
                          void changeBillStatus(
                            bill,
                            bill.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                          )
                        }
                      >
                        {bill.status === "ACTIVE" ? "Pause" : "Resume"}
                      </button>
                      <button
                        className="quiet-button"
                        type="button"
                        disabled={pending || !isOnline}
                        onClick={() => void changeBillStatus(bill, "ARCHIVED")}
                      >
                        Archive
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty">
            <p>No recurring bills yet.</p>
          </div>
        )}
      </section>
      <section className="bill-section" aria-labelledby="occurrence-heading">
        <div className="dashboard-panel-heading">
          <div>
            <p className="dashboard-label">Next three months</p>
            <h2 id="occurrence-heading">Upcoming occurrences</h2>
          </div>
        </div>
        {occurrences.length ? (
          <div className="bill-list">
            {occurrences.map((occurrence) => (
              <article className="bill-row occurrence-row" key={occurrence.id}>
                <div>
                  <strong>{occurrence.billName}</strong>
                  <span>
                    {occurrence.dueOn} · {occurrence.status.toLowerCase()} ·{" "}
                    {occurrence.amountMode === "VARIABLE" ? (
                      "Variable amount"
                    ) : occurrence.expectedAmountMinor ? (
                      <PrivacyMask
                        label={`${occurrence.billName} expected amount`}
                      >
                        {formatPhp(moneyMinor(occurrence.expectedAmountMinor))}
                      </PrivacyMask>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
                {occurrence.status === "UPCOMING" ||
                occurrence.status === "OVERDUE" ? (
                  <div className="bill-row-actions">
                    {payingId === occurrence.id ? (
                      <>
                        <select
                          className="reference-select"
                          value={payAccountId}
                          onChange={(event) => {
                            setConfirmPayOccurrenceId(null);
                            setError("");
                            setPayAccountId(event.currentTarget.value);
                          }}
                        >
                          <option value="">Funding account</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                        {occurrence.amountMode === "VARIABLE" ? (
                          <input
                            className="text-input"
                            type="text"
                            inputMode="decimal"
                            value={payAmount}
                            onChange={(event) => {
                              setConfirmPayOccurrenceId(null);
                              setError("");
                              setPayAmount(event.currentTarget.value);
                            }}
                            placeholder="Amount"
                          />
                        ) : null}
                        <button
                          className="save-button"
                          type="button"
                          disabled={pending || !isOnline}
                          onClick={() => void payOccurrence(occurrence)}
                        >
                          Confirm pay
                        </button>
                        {confirmPayOccurrenceId === occurrence.id ? (
                          <div className="confirmation-panel" role="alert">
                            <p>
                              This bill payment will leave the funding account
                              with a projected balance of{" "}
                              {(() => {
                                try {
                                  return formatPhp(
                                    projectedBillFundingBalance(occurrence),
                                  );
                                } catch {
                                  return "the projected balance";
                                }
                              })()}
                              . Confirm to continue.
                            </p>
                            <button
                              className="save-button"
                              type="button"
                              disabled={pending || !isOnline}
                              onClick={() =>
                                void payOccurrence(occurrence, true)
                              }
                            >
                              Confirm negative balance and pay
                            </button>
                          </div>
                        ) : null}
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() => setPayingId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="quiet-button"
                          type="button"
                          disabled={pending || !isOnline}
                          onClick={() => {
                            setPayingId(occurrence.id);
                            setPayAmount(
                              occurrence.expectedAmountMinor
                                ? phpInputFromMinor(
                                    occurrence.expectedAmountMinor,
                                  )
                                : "",
                            );
                          }}
                        >
                          Pay
                        </button>
                        <button
                          className="quiet-button"
                          type="button"
                          disabled={pending || !isOnline}
                          onClick={() => void skipOccurrence(occurrence)}
                        >
                          Skip
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <span className="bill-status">
                    {occurrence.status.toLowerCase()}
                  </span>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty">
            <p>No bill occurrences in the next three months.</p>
          </div>
        )}
      </section>
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
  const { profile, loading, csrfToken, createFirstAccount } = useAuth();
  const navigate = useNavigate();
  const [type, setType] = useState<"CASH" | "BANK" | "EWALLET" | "CREDIT_CARD">(
    "CASH",
  );
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retrySubmissionId, setRetrySubmissionId] = useState<string | null>(
    null,
  );
  const actionId = useRef<string>(crypto.randomUUID());
  const submissionInFlight = useRef(false);
  const firstAccountPayload = useMemo(() => {
    try {
      return buildAccountCreatePayload(
        type,
        name,
        institution,
        openingBalance,
        "",
      );
    } catch {
      return null;
    }
  }, [type, name, institution, openingBalance]);
  const firstAccountPayloadSnapshot = firstAccountPayload
    ? JSON.stringify(firstAccountPayload)
    : null;
  const {
    entries: submissionMatches,
    payloadMatches: firstAccountPayloadMatches,
    refresh: refreshFirstAccountSubmissions,
  } = usePendingSubmissionMatches(
    profile?.user.id,
    "onboarding:first-account",
    firstAccountPayload,
  );
  const previousFirstAccountPayload = useRef(firstAccountPayloadSnapshot);
  useEffect(() => {
    if (previousFirstAccountPayload.current !== firstAccountPayloadSnapshot) {
      previousFirstAccountPayload.current = firstAccountPayloadSnapshot;
      setRetrySubmissionId(null);
      actionId.current = crypto.randomUUID();
    }
  }, [firstAccountPayloadSnapshot]);
  useEffect(() => {
    if (retrySubmissionId && !firstAccountPayloadMatches.has(retrySubmissionId))
      setRetrySubmissionId(null);
  }, [firstAccountPayloadMatches, retrySubmissionId]);

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
        description="Your account balances and history are in Accounts. Add another account there whenever you need one."
        icon="✓"
        linkTo="/app/accounts"
        linkLabel="Go to Accounts"
        emptyTitle="Your account is ready."
        emptyDescription="Account balances and history come from your saved journal. Manage your accounts whenever you need to."
      />
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    setError("");
    let body: AccountCreatePayload;
    try {
      body = buildAccountCreatePayload(
        type,
        name,
        institution,
        openingBalance,
        "",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Check the account details.",
      );
      return;
    }
    if (!profile || !csrfToken) {
      setError("Your session must be verified before creating the account.");
      return;
    }
    submissionInFlight.current = true;
    setPending(true);
    let idempotencyKey: string | null = null;
    let requestAttempted = false;
    try {
      const submission = await beginPendingSubmission(
        profile.user.id,
        "onboarding:first-account",
        retrySubmissionId ?? actionId.current,
        body,
        Boolean(retrySubmissionId),
      );
      actionId.current = submission.id;
      idempotencyKey = submission.key;
      requestAttempted = true;
      await createFirstAccount(body, submission.key);
      clearPendingSubmission(
        profile.user.id,
        "onboarding:first-account",
        submission.key,
      );
      refreshFirstAccountSubmissions();
      actionId.current = crypto.randomUUID();
      setRetrySubmissionId(null);
      navigate("/app", { replace: true });
    } catch (caught) {
      const terminal =
        caught instanceof ApiRequestError &&
        isTerminalClientError(caught.status);
      if (terminal && idempotencyKey && profile) {
        clearPendingSubmission(
          profile.user.id,
          "onboarding:first-account",
          idempotencyKey,
        );
        actionId.current = crypto.randomUUID();
        setRetrySubmissionId(null);
        refreshFirstAccountSubmissions();
      }
      const message =
        caught instanceof Error
          ? caught.message
          : "The first account could not be created.";
      const uncertain =
        requestAttempted &&
        (!(caught instanceof ApiRequestError) ||
          caught.status === 408 ||
          caught.status >= 500);
      setError(
        uncertain
          ? `The first-account result could not be confirmed. Retry with the same details to safely recover it. ${message}`
          : message,
      );
      if (uncertain) refreshFirstAccountSubmissions();
    } finally {
      submissionInFlight.current = false;
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
        <PendingSubmissionRecovery
          matches={submissionMatches}
          selectedId={retrySubmissionId}
          operationLabel="first-account creation"
          canRetry={(id) => firstAccountPayloadMatches.has(id)}
          onSelect={setRetrySubmissionId}
          onStartNew={() => {
            actionId.current = crypto.randomUUID();
            setRetrySubmissionId(null);
          }}
        />
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
          {pending
            ? "Creating account…"
            : retrySubmissionId
              ? "Retry first-account creation"
              : "Create first account"}
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

type QuickAddSubmissionFields = {
  mode: QuickAddMode;
  sourceAccountId: string;
  destinationAccountId: string;
  categoryId: string;
  feeCategoryId: string;
  amount: string;
  fee: string;
  note: string;
  occurredOn: string;
};

function parsePositiveMinor(value: string, label: string): string {
  let parsed: bigint;
  try {
    parsed = parsePhpMinor(value);
  } catch {
    throw new Error(`${label} must be PHP with up to two decimal places.`);
  }
  if (parsed <= 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed.toString();
}

function buildQuickAddPayload(
  fields: QuickAddSubmissionFields,
  acknowledgeNegativeBalance = false,
) {
  if (!fields.sourceAccountId) throw new Error("Choose an account.");
  if (!fields.occurredOn) throw new Error("Choose the transaction date.");
  const amountMinor = parsePositiveMinor(fields.amount, "Amount");
  const common = {
    occurredOn: fields.occurredOn,
    ...(fields.note.trim() ? { note: fields.note.trim() } : {}),
  };
  if (fields.mode === "TRANSFER") {
    if (!fields.destinationAccountId)
      throw new Error("Choose a destination account.");
    if (fields.destinationAccountId === fields.sourceAccountId)
      throw new Error("Choose two different accounts.");
    return {
      kind: "TRANSFER" as const,
      fromAccountId: fields.sourceAccountId,
      toAccountId: fields.destinationAccountId,
      amountMinor,
      ...(fields.fee.trim()
        ? { feeMinor: parsePositiveMinor(fields.fee, "Transfer fee") }
        : {}),
      ...(fields.feeCategoryId ? { feeCategoryId: fields.feeCategoryId } : {}),
      ...(acknowledgeNegativeBalance
        ? { acknowledgeNegativeBalance: true }
        : {}),
      ...common,
    };
  }
  if (!fields.categoryId) throw new Error("Choose a category.");
  return {
    kind: fields.mode,
    sourceAccountId: fields.sourceAccountId,
    categoryId: fields.categoryId,
    amountMinor,
    ...(acknowledgeNegativeBalance ? { acknowledgeNegativeBalance: true } : {}),
    ...common,
  };
}

function QuickAddPage() {
  const { profile, csrfToken } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
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
  const [businessToday, setBusinessToday] = useState(
    profile?.serverToday ?? "",
  );
  const [loading, setLoading] = useState(true);
  const [referencesError, setReferencesError] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retrySubmissionId, setRetrySubmissionId] = useState<string | null>(
    null,
  );
  const [negativeConfirmation, setNegativeConfirmation] = useState(false);
  const [hasEdited, setHasEdited] = useState(false);
  const hasEditedRef = useRef(false);
  const dateEditedRef = useRef(false);
  const loadSequence = useRef(0);
  const submissionInFlight = useRef(false);
  const actionId = useRef<string>(crypto.randomUUID());
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const returnTo = (location.state as { from?: string } | null)?.from ?? "/app";
  const isSheet = Boolean(
    (location.state as { from?: string } | null)?.from &&
      returnTo !== location.pathname,
  );
  const isSheetReady = isSheet && Boolean(profile);
  const quickAddFields = useMemo<QuickAddSubmissionFields>(
    () => ({
      mode,
      sourceAccountId,
      destinationAccountId,
      categoryId,
      feeCategoryId,
      amount,
      fee,
      note,
      occurredOn,
    }),
    [
      mode,
      sourceAccountId,
      destinationAccountId,
      categoryId,
      feeCategoryId,
      amount,
      fee,
      note,
      occurredOn,
    ],
  );
  const quickAddPayload = useMemo(() => {
    try {
      return buildQuickAddPayload(quickAddFields);
    } catch {
      return null;
    }
  }, [quickAddFields]);
  const quickAddPayloadSnapshot = quickAddPayload
    ? JSON.stringify(quickAddPayload)
    : null;
  const {
    entries: quickAddSubmissionMatches,
    payloadMatches: quickAddPayloadMatches,
    refresh: refreshQuickAddSubmissions,
  } = usePendingSubmissionMatches(
    profile?.user.id,
    "transaction",
    quickAddPayload,
  );
  const previousQuickAddPayload = useRef(quickAddPayloadSnapshot);
  useEffect(() => {
    if (previousQuickAddPayload.current !== quickAddPayloadSnapshot) {
      previousQuickAddPayload.current = quickAddPayloadSnapshot;
      setRetrySubmissionId(null);
      actionId.current = crypto.randomUUID();
    }
  }, [quickAddPayloadSnapshot]);
  useEffect(() => {
    if (retrySubmissionId && !quickAddPayloadMatches.has(retrySubmissionId))
      setRetrySubmissionId(null);
  }, [quickAddPayloadMatches, retrySubmissionId]);

  const closeSheet = useCallback(() => {
    if (hasEdited && !window.confirm("Discard this unfinished transaction?")) {
      return;
    }
    navigate(returnTo);
    window.requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
    });
  }, [hasEdited, navigate, returnTo]);

  useEffect(() => {
    if (!isSheetReady) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        sheetRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeSheet, isSheetReady]);

  useLayoutEffect(() => {
    if (!isSheetReady) return;
    if (document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    closeButtonRef.current?.focus();
  }, [isSheetReady]);

  useEffect(() => {
    if (!hasEdited) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasEdited]);

  const ownerId = profile?.user.id;
  const loadReferences = useCallback(async () => {
    if (!ownerId) {
      loadSequence.current += 1;
      setAccounts([]);
      setCategories([]);
      setLoading(false);
      setReferencesError("");
      return;
    }
    const sequence = ++loadSequence.current;
    setLoading(true);
    setReferencesError("");
    try {
      const [accountResult, categoryResult, currentProfile] = await Promise.all(
        [
          apiRequest<{ accounts: QuickAddAccount[] }>("/accounts"),
          apiRequest<{ categories: QuickAddCategory[] }>("/categories"),
          apiRequest<Profile>("/me"),
        ],
      );
      if (sequence !== loadSequence.current) return;
      setBusinessToday(currentProfile.serverToday);
      if (!dateEditedRef.current && !hasEditedRef.current)
        setOccurredOn(currentProfile.serverToday);
      const activeAccounts = accountResult.accounts.filter(
        (account) => !account.archivedAt,
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
    } catch (caught) {
      if (sequence !== loadSequence.current) return;
      setReferencesError(
        caught instanceof Error
          ? caught.message
          : "Saved accounts and categories could not be loaded.",
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    void loadReferences();
    return () => {
      loadSequence.current += 1;
    };
  }, [loadReferences]);

  useEffect(() => {
    if (!profile) return;
    setBusinessToday(profile.serverToday);
    if (!dateEditedRef.current && !hasEditedRef.current)
      setOccurredOn(profile.serverToday);
  }, [profile?.serverToday, ownerId]);

  const visibleCategories = categories.filter((category) =>
    mode === "TRANSFER" ? category.kind === "EXPENSE" : category.kind === mode,
  );
  const visibleAccounts = accounts.filter(
    (account) => mode !== "TRANSFER" || account.type !== "CREDIT_CARD",
  );
  const expenseCategories = categories.filter(
    (category) => category.kind === "EXPENSE",
  );

  async function saveTransaction(acknowledgeNegativeBalance = false) {
    if (submissionInFlight.current) return;
    setError("");
    if (!acknowledgeNegativeBalance) setNegativeConfirmation(false);
    if (!isOnline) {
      setError("You are offline. Reconnect before recording a transaction.");
      return;
    }
    let requestAttempted = false;
    let responseReceived = false;
    let outcomeUnknown = false;
    try {
      if (!profile || !csrfToken)
        throw new Error("Your session needs to be refreshed.");
      const body = buildQuickAddPayload(
        quickAddFields,
        acknowledgeNegativeBalance,
      );
      submissionInFlight.current = true;
      setPending(true);
      const submission = await beginPendingSubmission(
        profile.user.id,
        "transaction",
        retrySubmissionId ?? actionId.current,
        body,
        Boolean(retrySubmissionId),
      );
      actionId.current = submission.id;
      requestAttempted = true;
      const response = await fetch("/api/v1/transactions", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": submission.key,
        },
        body: JSON.stringify(body),
      });
      responseReceived = true;
      outcomeUnknown = response.status >= 500 || response.status === 408;
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        const message =
          payload?.error?.message ?? "The transaction could not be saved.";
        if (isTerminalClientError(response.status)) {
          clearPendingSubmission(
            profile.user.id,
            "transaction",
            submission.key,
          );
          actionId.current = crypto.randomUUID();
          setRetrySubmissionId(null);
          refreshQuickAddSubmissions();
        }
        if (
          response.status === 409 &&
          message.toLowerCase().includes("negative")
        ) {
          clearPendingSubmission(
            profile.user.id,
            "transaction",
            submission.key,
          );
          actionId.current = crypto.randomUUID();
          setRetrySubmissionId(null);
          setNegativeConfirmation(true);
        }
        throw new Error(message);
      }
      clearPendingSubmission(profile.user.id, "transaction", submission.key);
      refreshQuickAddSubmissions();
      actionId.current = crypto.randomUUID();
      setRetrySubmissionId(null);
      setAmount("");
      setFee("");
      setNote("");
      hasEditedRef.current = false;
      dateEditedRef.current = false;
      setHasEdited(false);
      setNegativeConfirmation(false);
      setError("Transaction saved.");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The transaction could not be saved.";
      const uncertain =
        outcomeUnknown || (requestAttempted && !responseReceived);
      if (
        message.includes("These details do not match") ||
        message.includes("saved attempt is no longer available")
      ) {
        setRetrySubmissionId(null);
      }
      setError(
        uncertain
          ? `The transaction result could not be confirmed. If it reached MoniKey, retry with the same details to recover it safely. ${message}`
          : message,
      );
      if (uncertain) refreshQuickAddSubmissions();
    } finally {
      submissionInFlight.current = false;
      setPending(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveTransaction();
  }

  async function confirmNegativeBalance() {
    await saveTransaction(true);
  }

  if (!profile) return <QuickAddPreviewPage />;

  const quickAddContent = (
    <section
      ref={sheetRef}
      className={`route-page quick-add-page${isSheet ? " quick-add-sheet" : ""}`}
      aria-labelledby="page-heading"
      {...(isSheet ? { role: "dialog" as const, "aria-modal": true } : {})}
    >
      {isSheet ? (
        <button
          ref={closeButtonRef}
          className="sheet-close-button"
          type="button"
          aria-label="Close quick add"
          onClick={closeSheet}
        >
          ×
        </button>
      ) : null}
      <div className="page-intro">
        <p className="eyebrow">Quick add · Private</p>
        <h1 id="page-heading">Record it while it is fresh.</h1>
        <p className="page-description">
          One short form for expenses, income, and transfers. Every save uses a
          balanced journal and can be safely retried.
        </p>
      </div>
      <form
        className="quick-add-card"
        onSubmit={submit}
        onChange={() => {
          hasEditedRef.current = true;
          setHasEdited(true);
        }}
      >
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
                hasEditedRef.current = true;
                setHasEdited(true);
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
          <span className="form-kind">{businessToday}</span>
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
              {visibleAccounts.map((account) => (
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
                {visibleAccounts.map((account) => (
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
              max={businessToday}
              onChange={(event) => {
                dateEditedRef.current = true;
                setOccurredOn(event.currentTarget.value);
              }}
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
        <PendingSubmissionRecovery
          matches={quickAddSubmissionMatches}
          selectedId={retrySubmissionId}
          operationLabel="transaction"
          canRetry={(id) => quickAddPayloadMatches.has(id)}
          onSelect={setRetrySubmissionId}
          onStartNew={() => {
            actionId.current = crypto.randomUUID();
            setRetrySubmissionId(null);
          }}
        />
        {referencesError ? (
          <div className="dashboard-error" role="alert">
            <div>
              <strong>Accounts and categories could not be refreshed</strong>
              <p>{referencesError}</p>
            </div>
            <button
              className="quiet-button"
              type="button"
              onClick={() => void loadReferences()}
              disabled={loading}
            >
              {loading ? "Loading…" : "Try again"}
            </button>
          </div>
        ) : null}
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
            {pending
              ? "Saving…"
              : retrySubmissionId
                ? "Retry saved transaction"
                : `Record ${mode.toLowerCase()}`}
          </button>
        )}
      </form>
    </section>
  );

  if (isSheet) {
    return (
      <div
        className="quick-add-overlay"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSheet();
        }}
      >
        {quickAddContent}
      </div>
    );
  }

  return quickAddContent;
}

function SettingsPage() {
  const { profile, csrfToken, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function toggleBalancePrivacy() {
    if (!profile || !csrfToken) return;
    setSaving(true);
    setMessage("");
    try {
      await apiRequest("/me/preferences", {
        method: "PATCH",
        headers: { "x-csrf-token": csrfToken },
        body: JSON.stringify({ hideBalances: !profile.user.hideBalances }),
      });
      await refreshProfile();
      setMessage(
        profile.user.hideBalances
          ? "Balances will be visible by default."
          : "Balances will be hidden by default.",
      );
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Your privacy preference could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

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
      {profile ? (
        <div className="settings-preference-card">
          <div>
            <p className="empty-title">Privacy default</p>
            <p className="field-hint">
              Mask financial amounts when your private session opens.
            </p>
          </div>
          <button
            className="quiet-button"
            type="button"
            onClick={() => void toggleBalancePrivacy()}
            disabled={saving}
          >
            {saving
              ? "Saving…"
              : profile.user.hideBalances
                ? "Show balances by default"
                : "Hide balances by default"}
          </button>
        </div>
      ) : null}
      <div className="settings-preference-card settings-links-card">
        <div>
          <p className="empty-title">Account controls</p>
          <p className="field-hint">
            Manage categories, sessions, and password access.
          </p>
        </div>
        <div className="card-detail-actions">
          <Link className="quiet-link" to="/app/settings/categories">
            Categories
          </Link>
          <Link className="quiet-link" to="/app/settings/security">
            Security
          </Link>
        </div>
      </div>
      {message ? (
        <p className="form-success" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function ReportsPage() {
  const { profile, loading: authLoading } = useAuth();

  if (authLoading) return <DashboardLoading />;
  if (!profile) {
    return (
      <RoutePage
        eyebrow="Understand your month"
        title="Reports"
        description="Monthly insights are generated from your private ledger and are available after sign-in."
        icon="▥"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  }

  return (
    <ReportsFeature
      initialMonth={profile.serverToday.slice(0, 7)}
      request={apiRequest}
      renderMoney={dashboardMoney}
    />
  );
}

type SessionRecord = {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  current: boolean;
};

function SecurityPage() {
  const {
    profile,
    csrfToken,
    refreshProfile,
    loading: authLoading,
  } = useAuth();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const result = await apiRequest<{ sessions: SessionRecord[] }>(
        "/auth/sessions",
      );
      setSessions(result.sessions);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Sessions could not be loaded.",
      );
    }
  }, [profile]);
  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(sessionId: string) {
    if (!csrfToken) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/auth/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      setMessage("Session revoked.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The session could not be revoked.",
      );
    } finally {
      setPending(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!csrfToken || newPassword !== confirmPassword) {
      setError("New passwords must match.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/auth/change-password", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refreshProfile();
      setMessage("Password updated. Other sessions were signed out.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The password could not be updated.",
      );
    } finally {
      setPending(false);
    }
  }

  if (authLoading) return <DashboardLoading />;
  if (!profile)
    return (
      <RoutePage
        eyebrow="Security"
        title="Sign in to manage security."
        description="Sessions and password controls are private to the account owner."
        icon="◇"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  return (
    <section
      className="route-page security-page"
      aria-labelledby="page-heading"
    >
      <div className="page-intro">
        <p className="eyebrow">Private access</p>
        <h1 id="page-heading">Security you can review.</h1>
        <p className="page-description">
          Rotate your password and revoke sessions you no longer recognize.
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="form-success" role="status">
          {message}
        </p>
      ) : null}
      <form
        className="account-edit-card security-form"
        onSubmit={changePassword}
      >
        <div className="form-heading">
          <div>
            <p className="form-kicker">PASSWORD</p>
            <h2>Change password</h2>
          </div>
        </div>
        <label className="field-group">
          <span className="field-label">Current password *</span>
          <input
            className="text-input"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
          />
        </label>
        <label className="field-group">
          <span className="field-label">New password *</span>
          <input
            className="text-input"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />
        </label>
        <label className="field-group">
          <span className="field-label">Confirm new password *</span>
          <input
            className="text-input"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.currentTarget.value)}
          />
        </label>
        <button className="save-button" type="submit" disabled={pending}>
          {pending ? "Updating…" : "Update password"}
        </button>
      </form>
      <section className="session-panel" aria-labelledby="sessions-heading">
        <div className="dashboard-panel-heading">
          <div>
            <p className="dashboard-label">Active sessions</p>
            <h2 id="sessions-heading">Where you are signed in</h2>
          </div>
        </div>
        {sessions.map((session) => (
          <div className="session-row" key={session.id}>
            <div>
              <strong>
                {session.current ? "This session" : "Other session"}
              </strong>
              <span>
                {session.userAgent ?? "Unknown device"} · Last seen{" "}
                {new Date(session.lastSeenAt).toLocaleString("en-PH")}
              </span>
            </div>
            {session.current ? (
              <span className="session-current">Current</span>
            ) : (
              <button
                className="quiet-button"
                type="button"
                disabled={pending}
                onClick={() => void revoke(session.id)}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}

function CategoriesPage() {
  const { profile, csrfToken, loading: authLoading } = useAuth();
  const [categories, setCategories] = useState<QuickAddCategory[]>([]);
  const [kind, setKind] = useState<QuickAddCategory["kind"]>("EXPENSE");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    const result = await apiRequest<{ categories: QuickAddCategory[] }>(
      "/categories?includeArchived=true",
    );
    setCategories(result.categories);
  }, [profile]);
  useEffect(() => {
    void load().catch((caught) =>
      setError(
        caught instanceof Error
          ? caught.message
          : "Categories could not be loaded.",
      ),
    );
  }, [load]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken || !name.trim()) return;
    try {
      await apiRequest("/categories", {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ kind, name: name.trim() }),
      });
      setName("");
      setMessage("Category created.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The category could not be created.",
      );
    }
  }
  async function archive(category: QuickAddCategory) {
    if (!csrfToken) return;
    try {
      await apiRequest(`/categories/${category.id}`, {
        method: "PATCH",
        headers: {
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ archived: !category.archivedAt }),
      });
      setMessage(
        category.archivedAt ? "Category restored." : "Category archived.",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The category could not be updated.",
      );
    }
  }
  if (authLoading) return <DashboardLoading />;
  if (!profile)
    return (
      <RoutePage
        eyebrow="Categories"
        title="Sign in to manage categories."
        description="Categories organize future records without changing posted history."
        icon="◇"
        linkTo="/login"
        linkLabel="Go to sign in"
      />
    );
  return (
    <section
      className="route-page categories-page"
      aria-labelledby="page-heading"
    >
      <div className="page-intro">
        <p className="eyebrow">Personalize</p>
        <h1 id="page-heading">Categories that keep context.</h1>
        <p className="page-description">
          Renaming or archiving a category never rewrites a posted journal.
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="form-success" role="status">
          {message}
        </p>
      ) : null}
      <form className="account-edit-card category-form" onSubmit={create}>
        <div className="reference-grid">
          <label className="field-group">
            <span className="field-label">Type *</span>
            <select
              className="reference-select"
              value={kind}
              onChange={(event) =>
                setKind(event.currentTarget.value as QuickAddCategory["kind"])
              }
            >
              <option value="EXPENSE">Expense</option>
              <option value="INCOME">Income</option>
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">Name *</span>
            <input
              className="text-input"
              required
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Home supplies"
            />
          </label>
        </div>
        <button className="save-button" type="submit">
          Create category
        </button>
      </form>
      <section className="category-list" aria-label="Saved categories">
        {categories.map((category) => (
          <div className="category-row" key={category.id}>
            <div>
              <strong>{category.name}</strong>
              <span>
                {category.kind === "EXPENSE" ? "Expense" : "Income"}
                {category.archivedAt ? " · Archived" : ""}
              </span>
            </div>
            <button
              className="quiet-button"
              type="button"
              onClick={() => void archive(category)}
            >
              {category.archivedAt ? "Restore" : "Archive"}
            </button>
          </div>
        ))}
      </section>
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
            path="app/accounts/:accountId/pay"
            element={<CardPaymentPage />}
          />
          <Route
            path="app/accounts/:accountId/statements"
            element={<CardStatementsPage />}
          />
          <Route path="app/bills" element={<BillsPage />} />
          <Route path="app/reports" element={<ReportsPage />} />
          <Route path="app/settings" element={<SettingsPage />} />
          <Route path="app/settings/categories" element={<CategoriesPage />} />
          <Route path="app/settings/security" element={<SecurityPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function AuthenticatedApp() {
  const { profile } = useAuth();
  return (
    <PrivacyPreferenceProvider hidden={profile?.user.hideBalances ?? false}>
      <App />
    </PrivacyPreferenceProvider>
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
      <AuthenticatedApp />
    </AuthProvider>
  </React.StrictMode>,
);
