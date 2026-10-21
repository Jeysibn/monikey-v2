# ADR-004: Private database-backed authentication

- Status: Accepted
- Date: 2026-10-22
- Owners: MoniKey project owner
- Related plan items: P2-01, P2-02

## Context

MoniKey V2 is owner-private, uses a same-origin Fastify API, and must keep financial data behind revocable sessions. The approved plan excludes public registration and browser-stored JWTs.

## Decision

- Create the initial owner only through a one-time CLI command. It requires explicit email, password, and database URL environment values; it refuses to run once any user exists.
- Hash credentials with Argon2id (19 MiB memory, two iterations, one lane).
- Use random opaque 256-bit `__Host-mk_session` cookies with `Secure`, `HttpOnly`, `Path=/`, and `SameSite=Lax`; persist only their SHA-256 hashes and expire sessions after 14 days.
- Persist a hash of a separate random CSRF token per session. Keep the browser copy in a `Secure`, same-site, host-only cookie and require the token in `X-CSRF-Token` for authenticated mutations.
- Require the configured exact `Origin` on mutations. Reject cross-site Fetch Metadata when supplied. Login attempts are limited to five per 15 minutes per source IP and normalized email key.
- Revoke sessions on logout, explicit session deletion, and password change. Password change rotates the current opaque token and revokes the other sessions in one transaction.
- Disable caching for identity and session responses. Never log submitted passwords, cookies, or CSRF tokens.

## Consequences

- Production must set `APP_ORIGIN` to the exact HTTPS application origin. Local Compose sets it to the local Vite origin.
- The login UI and user-facing session management remain future vertical slices; the API does not create public accounts.
- The in-process rate limiter is suitable for the current single API instance. If launch topology changes to multiple API replicas, rate-limit storage must be revisited without adding Redis speculatively to V2.
- `__Host-` cookies require HTTPS. Local browser development uses loopback, where browsers permit Secure cookies; non-browser clients must preserve secure-cookie semantics.

## Alternatives considered

- JWT in local storage: rejected because revocation and XSS exposure are harder to manage.
- Public self-registration: rejected by the approved private-owner scope.
- Signed/stateless cookie sessions: rejected because database-backed revocation and session listing are required.
- CSRF package-generated double-submit state: a session-bound random token stored as a hash is used to keep validation explicit and tied to the revocable DB session.
