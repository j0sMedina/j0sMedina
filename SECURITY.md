# Security

## Audit (2026-07-05)

Ran a security audit against the live API and web app (`mh-datapedia-api.fly.dev`), covering 20 attack scenarios:

- Brute force / rate-limiter bypass
- JWT `alg:none` bypass
- CSRF
- Token replay
- IDOR / role escalation
- SQL injection
- ReDoS
- Mass assignment
- XSS
- Header & CORS misconfiguration
- Business-logic edge cases

**Result:** 16 held, 3 accepted as stateless-JWT tradeoffs (mitigated afterward via session revocation, see below), 0 broken.

One issue — email addresses leaking for `HELPER`-role users in `listUsers` — was found and fixed *before* the audit ran, so it tested as already patched.

## Hardening (Phase 2)

Follow-up work addressing the audit's "partial" findings — giving users and admins a way to kill a live session directly, rather than relying on short JWT expiry alone:

- Login lockout after 5 failed attempts + refresh-token reuse detection
- Email verification on registration
- Forgot / reset password flow
- Session tracking (IP + user agent captured on login), with endpoints to list and revoke active sessions
- Change-password endpoint with rate limiting and automatic session revocation
- TOTP-based 2FA

## Open items (low priority)

- [ ] `alg:none` JWT requests return `400` instead of `401` (`authenticate.ts`)
- [ ] `CORS_ORIGIN` still set to a local dev URL in the production environment

These are hygiene findings, not exploitable in isolation, and are tracked for a future pass.
