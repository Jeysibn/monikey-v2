const configuredWebUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

export const webOrigin = new URL(configuredWebUrl).origin;
export const apiBaseUrl =
  (process.env.PLAYWRIGHT_API_BASE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  ) + "/api/v1";

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
