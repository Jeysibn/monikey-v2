import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { AmountEntry, PrivacyMask, ReferenceSelect } from "./components";
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
          <Link className="profile-chip" to="/login">
            <span className="profile-dot" aria-hidden="true" />
            <span>Private space</span>
          </Link>
        </header>

        <main className="page-content" id="main-content">
          <div className="preview-notice" role="status">
            <span className="notice-mark" aria-hidden="true">
              i
            </span>
            <span>
              Foundation preview. Sign-in and financial records are not active
              yet.
            </span>
          </div>
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
  return (
    <RoutePage
      eyebrow="Private access"
      title="Sign-in is coming with the secure account foundation."
      description="MoniKey V2 will have private owner-only access. There is no registration or demo sign-in."
      icon="⌑"
      linkLabel="Back to Home"
    />
  );
}

function QuickAddPage() {
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
          <Route
            path="onboarding"
            element={
              <RoutePage
                eyebrow="Getting started"
                title="Your first account starts with a real opening balance."
                description="Guided setup will record an opening journal entry, not a hidden balance override."
                icon="＋"
              />
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
