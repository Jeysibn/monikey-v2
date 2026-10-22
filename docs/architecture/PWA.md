# Private PWA shell and connection state

MoniKey V2 is installable where the browser supports standalone web apps. The web client publishes a manifest, a small brand icon, and a service worker that caches only the static shell. The service worker never intercepts `/api/` requests and never stores financial responses, session data, exports, personal data, or authorization errors.

## Offline behavior

The browser connection state is visible in the application shell. When the browser reports that it is offline, the shell shows a connection alert and the Quick Add transaction submit and negative-balance confirmation controls are disabled. The form also checks the connection immediately before a write so a transition to offline cannot enqueue or partially save a mutation.

There is no offline ledger cache, IndexedDB mirror, or mutation queue. Read failures continue to use the page loading/error states, and all financial reads and writes remain network requests with the API's no-store policy.

## Trusted HTTPS strategy

Local development uses `http://localhost`, which browsers treat as a secure context for service workers and cookie testing. A real device should use a trusted HTTPS origin provided by the approved private DNS/private-CA rollout. The repository does not generate or install a self-signed certificate, and it does not enable HSTS until the production hostname and trust chain are confirmed. The deployment work in the later platform phase owns the reverse proxy, CSP, HSTS, and private CA rollout.

## Browser verification

Use the local Compose stack and Playwright to verify the manifest, shell registration, online/offline message, and disabled transaction submission. Verify installation and trusted HTTPS on an actual test device after the private origin is available; this is a Phase 1/P6 device gate and is not represented by a local self-signed certificate.
