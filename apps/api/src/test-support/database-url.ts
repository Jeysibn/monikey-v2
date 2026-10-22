export function requireDatabaseUrl(value = process.env.DATABASE_URL): string {
  if (!value || value.trim().length === 0) {
    throw new Error("DATABASE_URL is required for PostgreSQL-backed tests.");
  }
  return value;
}
