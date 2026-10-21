const MIN_MINOR = -(2n ** 63n);
const MAX_MINOR = 2n ** 63n - 1n;

export type MoneyMinor = bigint & { readonly __brand: "MoneyMinor" };

export function moneyMinor(value: bigint | string): MoneyMinor {
  const parsed = typeof value === "string" ? BigInt(value) : value;
  if (parsed < MIN_MINOR || parsed > MAX_MINOR)
    throw new RangeError("Amount exceeds PostgreSQL BIGINT range");
  return parsed as MoneyMinor;
}

export function parsePhpMinor(input: string): MoneyMinor {
  const normalized = input.trim();
  const match = /^(-?)(\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(
    normalized,
  );
  if (!match)
    throw new TypeError(
      "Enter a valid PHP amount with no more than two decimal places",
    );
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]!.replaceAll(",", ""));
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  return moneyMinor(sign * (whole * 100n + fraction));
}

export function serializeMoneyMinor(amount: MoneyMinor): string {
  return amount.toString(10);
}

export function formatPhp(amount: MoneyMinor): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, "0");
  const grouped = new Intl.NumberFormat("en-PH", {
    maximumFractionDigits: 0,
  }).format(whole);
  const currencyParts = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(negative ? -1 : 1);
  return currencyParts
    .map((part) => {
      if (part.type === "integer") return grouped;
      if (part.type === "group") return "";
      if (part.type === "decimal") return part.value;
      if (part.type === "fraction") return cents;
      return part.value;
    })
    .join("");
}
