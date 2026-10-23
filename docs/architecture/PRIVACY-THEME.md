# Theme, privacy defaults, and reduced motion

Theme and privacy defaults are owner preferences, loaded with the authenticated profile and saved through `PATCH /api/v1/me/preferences`.

- The light/dark control applies the theme immediately and persists the selected `theme` value for the owner. Signed-out visitors retain a local browser preference only.
- `hideBalances` becomes the default for every authenticated `PrivacyMask`. Each amount can still be revealed temporarily in the current view; the API response remains unchanged.
- Settings exposes the privacy default through the owner-scoped preference mutation. It does not copy financial data into local storage.
- The CSS `prefers-reduced-motion: reduce` rule removes scrolling, transition, and animation movement while keeping focus and state changes visible.

All preference requests use the authenticated session, CSRF token, and the API's no-store response policy.
