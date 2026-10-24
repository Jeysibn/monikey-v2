import { useEffect, useState, type ReactNode } from "react";
import { PrivacyMask } from "../../components";

type MonthlyReportView = {
  month: string;
  incomeMinor: string;
  netExpensesMinor: string;
  netCashFlowMinor: string;
  categories: {
    categoryId: string | null;
    categoryName: string;
    amountMinor: string;
  }[];
};

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export function ReportsFeature({
  initialMonth,
  request,
  renderMoney,
}: {
  initialMonth: string;
  request: ApiRequest;
  renderMoney: (value: string) => ReactNode;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [selectedMonthManually, setSelectedMonthManually] = useState(false);
  const [reportResult, setReportResult] = useState<{
    month: string;
    report: MonthlyReportView;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const report =
    reportResult?.month === month && reportResult.report.month === month
      ? reportResult.report
      : null;

  useEffect(() => {
    if (!selectedMonthManually) setMonth(initialMonth);
  }, [initialMonth, selectedMonthManually]);

  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    const requestedMonth = month;
    setLoading(true);
    setError("");
    setReportResult((current) =>
      current?.month === requestedMonth ? current : null,
    );
    void request<{ report: MonthlyReportView }>(
      `/reports/monthly?month=${encodeURIComponent(requestedMonth)}`,
      { signal: controller.signal },
    )
      .then(({ report: response }) => {
        if (controller.signal.aborted) return;
        if (response.month !== requestedMonth)
          throw new Error(
            "The report response did not match the selected month. Please retry.",
          );
        setReportResult({ month: requestedMonth, report: response });
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setReportResult(null);
        setError(
          caught instanceof Error
            ? caught.message
            : "Reports could not be loaded.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month, request, retryVersion]);

  const maxCategory =
    report?.categories.reduce((max, category) => {
      const amount = BigInt(category.amountMinor);
      const absolute = amount < 0n ? -amount : amount;
      return absolute > max ? absolute : max;
    }, 0n) ?? 0n;
  const [year, monthNumber] = month.split("-").map(Number);
  const exportTo =
    year && monthNumber
      ? new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
      : "";

  return (
    <section className="route-page reports-page" aria-labelledby="page-heading">
      <div className="page-intro">
        <p className="eyebrow">Understand your month · Private</p>
        <h1 id="page-heading">Reports</h1>
      </div>
      <div className="report-toolbar">
        <label className="field-group">
          <span className="field-label">Month</span>
          <input
            className="text-input"
            type="month"
            value={month}
            onChange={(event) => {
              const selectedMonth = event.currentTarget.value;
              if (selectedMonth) {
                setSelectedMonthManually(true);
                setMonth(selectedMonth);
              }
            }}
          />
        </label>
        <div className="report-export-actions">
          <a
            className="quiet-button"
            href={`/api/v1/exports/transactions.csv?from=${month}-01&to=${exportTo}`}
          >
            Download CSV
          </a>
          <a className="quiet-button" href="/api/v1/exports/data.json">
            Download JSON
          </a>
        </div>
      </div>
      {loading ? (
        <div
          className="dashboard-skeleton report-loading"
          role="status"
          aria-label={`Loading report for ${month}`}
        >
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-line-wide" />
        </div>
      ) : null}
      {error ? (
        <div className="dashboard-error" role="alert">
          <div>
            <strong>Report unavailable for {month}</strong>
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
      {report ? (
        <>
          <div
            className="report-stat-grid"
            aria-label="Monthly totals"
            data-report-month={report.month}
          >
            <div className="dashboard-stat">
              <p className="dashboard-label">Income</p>
              <PrivacyMask label="monthly income">
                {renderMoney(report.incomeMinor)}
              </PrivacyMask>
            </div>
            <div className="dashboard-stat">
              <p className="dashboard-label">Net expenses</p>
              <PrivacyMask label="net monthly expenses">
                {renderMoney(report.netExpensesMinor)}
              </PrivacyMask>
            </div>
            <div className="dashboard-stat">
              <p className="dashboard-label">Net cash flow</p>
              <PrivacyMask label="net cash flow">
                {renderMoney(report.netCashFlowMinor)}
              </PrivacyMask>
            </div>
          </div>
          <section
            className="report-category-panel"
            aria-labelledby="category-report-heading"
          >
            <div className="dashboard-panel-heading">
              <div>
                <p className="dashboard-label">Expense categories</p>
                <h2 id="category-report-heading">Where the month moved</h2>
              </div>
            </div>
            {report.categories.length ? (
              <div
                className="report-category-table"
                role="table"
                aria-label="Monthly expense categories"
              >
                <div
                  className="report-category-row report-category-header"
                  role="row"
                >
                  <span role="columnheader">Category</span>
                  <span role="columnheader">Net amount</span>
                </div>
                {report.categories.map((category) => (
                  <div
                    className="report-category-row"
                    role="row"
                    key={category.categoryId ?? "uncategorized"}
                  >
                    <span role="cell">
                      <strong>{category.categoryName}</strong>
                      <span
                        className="report-bar"
                        style={{
                          width: `${(() => {
                            const amount = BigInt(category.amountMinor);
                            const absolute = amount < 0n ? -amount : amount;
                            if (maxCategory === 0n) return "4";
                            const width = (absolute * 100n) / maxCategory;
                            return (width < 4n ? 4n : width).toString();
                          })()}%`,
                        }}
                      />
                    </span>
                    <span role="cell">
                      <PrivacyMask
                        label={`${category.categoryName} monthly amount`}
                      >
                        {renderMoney(category.amountMinor)}
                      </PrivacyMask>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">
                <p>No categorized expenses in this month.</p>
              </div>
            )}
          </section>
        </>
      ) : null}
      {!loading && !error && report ? (
        <p className="page-description report-explanation">
          Income, net expenses, cash flow, and categories come from posted
          journals. Transfers and card payments are excluded from spending.
        </p>
      ) : null}
    </section>
  );
}
