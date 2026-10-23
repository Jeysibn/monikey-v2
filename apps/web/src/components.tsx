import { createContext, useContext, useState, type ReactNode } from "react";
import { formatPhp, parsePhpMinor, type MoneyMinor } from "@monikey/money";

const PrivacyPreferenceContext = createContext(false);

export function PrivacyPreferenceProvider({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  return (
    <PrivacyPreferenceContext.Provider value={hidden}>
      {children}
    </PrivacyPreferenceContext.Provider>
  );
}

export function MoneyValue({
  amount,
  label,
}: {
  amount: MoneyMinor;
  label?: string;
}) {
  return (
    <span className="money-value" aria-label={label ?? formatPhp(amount)}>
      {formatPhp(amount)}
    </span>
  );
}

export function PrivacyMask({
  children,
  label = "Amount",
}: {
  children: ReactNode;
  label?: string;
}) {
  const defaultHidden = useContext(PrivacyPreferenceContext);
  const [locallyHidden, setLocallyHidden] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hidden = defaultHidden ? !revealed : locallyHidden;

  return (
    <span className="privacy-value">
      <span aria-live="polite" aria-atomic="true">
        {hidden ? <span className="masked-value">••••••</span> : children}
      </span>
      <button
        className="privacy-toggle"
        type="button"
        aria-label={`${hidden ? "Reveal" : "Hide"} ${label.toLowerCase()}`}
        aria-pressed={hidden}
        onClick={() => {
          if (defaultHidden) setRevealed((current) => !current);
          else setLocallyHidden((current) => !current);
        }}
      >
        <span aria-hidden="true">{hidden ? "◉" : "◎"}</span>
      </button>
    </span>
  );
}

export function AmountEntry({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState("");
  const [valid, setValid] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  function validate() {
    if (!value.trim()) {
      setError("Enter an amount.");
      setValid(false);
      return;
    }

    try {
      if (parsePhpMinor(value) <= 0n) {
        setError("Amount must be greater than zero.");
        setValid(false);
        return;
      }
      setError("");
      setValid(true);
    } catch {
      setError("Enter PHP with up to two decimal places.");
      setValid(false);
    }
  }

  return (
    <div
      className={`field-group${error ? " has-error" : ""}${valid ? " is-valid" : ""}`}
    >
      <label className="field-label" htmlFor={id}>
        Amount <span aria-hidden="true">*</span>
      </label>
      <div className="amount-control">
        <span className="currency-prefix" aria-hidden="true">
          ₱
        </span>
        <input
          id={id}
          className="amount-input"
          type="text"
          required
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.00"
          value={value}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
          {...(error ? { "aria-invalid": true } : {})}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            setError("");
            setValid(false);
          }}
          onBlur={validate}
        />
        {valid ? (
          <span
            className="field-valid-mark"
            aria-label="Amount format is valid"
          >
            ✓
          </span>
        ) : null}
      </div>
      <p className="field-hint" id={hintId}>
        PHP · up to 2 decimal places
      </p>
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReferenceSelect({
  id,
  label,
  unavailableText,
}: {
  id: string;
  label: string;
  unavailableText: string;
}) {
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label} <span aria-hidden="true">*</span>
      </label>
      <select id={id} className="reference-select" disabled value="">
        <option value="">{unavailableText}</option>
      </select>
      <p className="field-hint">
        This becomes available when real records can be saved.
      </p>
    </div>
  );
}
