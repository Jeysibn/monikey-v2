import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main className="shell">
      <header className="brand">
        <span className="mark" aria-hidden="true">
          M
        </span>
        <span>MoniKey</span>
        <span className="version">V2 · private alpha</span>
      </header>
      <section className="status" aria-labelledby="title">
        <p className="eyebrow">Foundation milestone</p>
        <h1 id="title">Your money deserves a ledger you can trust.</h1>
        <p className="lede">
          MoniKey V2 is being built from a clean foundation. Financial records
          will appear here only after the real account and journal flows are
          ready.
        </p>
        <div className="boundary">
          <span className="signal" aria-hidden="true" />
          <div>
            <strong>No financial data yet</strong>
            <p>
              This workspace is intentionally empty. No demo balances or sample
              transactions are shown.
            </p>
          </div>
        </div>
      </section>
      <footer>
        Private by design <span>·</span> PHP <span>·</span> Asia/Manila
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
