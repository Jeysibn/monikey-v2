const dayMilliseconds = 24 * 60 * 60 * 1000;

/** Format a timestamp as the application's Manila business calendar date. */
export function manilaBusinessDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function scheduleManilaMidnightRefresh(
  refresh: () => void,
  now: () => Date = () => new Date(),
  scheduleTimeout: (callback: () => void, delay: number) => number = (
    callback,
    delay,
  ) => window.setTimeout(callback, delay),
  clearTimeoutFn: (timer: number) => void = (timer) =>
    window.clearTimeout(timer),
): () => void {
  let timer = 0;
  let disposed = false;
  const schedule = () => {
    timer = scheduleTimeout(() => {
      if (disposed) return;
      refresh();
      schedule();
    }, millisecondsUntilNextManilaMidnight(now()));
  };
  schedule();
  return () => {
    disposed = true;
    clearTimeoutFn(timer);
  };
}

/** Calendar-date boundary delay based on Asia/Manila, independent of browser TZ. */
export function millisecondsUntilNextManilaMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, Number(value)]),
  );
  const elapsed =
    ((values.hour ?? 0) * 60 * 60 +
      (values.minute ?? 0) * 60 +
      (values.second ?? 0)) *
      1000 +
    now.getUTCMilliseconds();
  return elapsed === 0 ? dayMilliseconds : dayMilliseconds - elapsed;
}
