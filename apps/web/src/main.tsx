import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
} from "react-router";
import { AmountEntry, PrivacyMask, ReferenceSelect } from "./components";
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
              disabled={pending}
            >
              Confirm and record
            </button>
          </div>
        ) : (
          <button
            className="save-button"
            type="submit"
            disabled={pending || loading || !accounts.length}
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
          <Route
            path="app/activity"
            element={
              <RoutePage
                eyebrow="Your timeline"
                title="Activity"
                description="Find and review the financial actions you record."
                icon="◷"
              />
            }
          />
          <Route path="app/transactions/new" element={<QuickAddPage />} />
          <Route
            path="app/transactions/:transactionId"
            element={
              <RoutePage
                eyebrow="Activity"
                title="Transaction details"
                description="A transaction view will show its account, category and complete change history."
                icon="↗"
              />
            }
          />
          <Route
            path="app/accounts"
            element={
              <RoutePage
                eyebrow="Your money"
                title="Accounts"
                description="Cash, banks, wallets and card balances will be calculated from your journal."
                icon="▤"
              />
            }
          />
          <Route
            path="app/accounts/:accountId"
            element={
              <RoutePage
                eyebrow="Account overview"
                title="Account details"
                description="See a saved account, its balance and its chronological activity."
                icon="▤"
              />
            }
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
