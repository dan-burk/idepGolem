# iDEP Desktop — Authentication & Startup Flow (ASCII)

```
  ┌─────────────────────────── DESKTOP (Electron) ───────────────────────────┐

        Start
          │
          ▼
    ┌─────────────────────────┐
    │ Check disk for E-token  │
    └─────────────────────────┘
          │
          ├──── valid ─────────────────────────────────────┐
          │                                                 │
       missing / expired                                    │
          │                                                 │
          ▼                                                 │
    Login w/ Google  (system browser)                       │
          │                                                 │
          │  Google ID token                                │
          ▼                                                 │
    ╔════════════════════ CLOUD ═══════════════════╗        │
    ║  Entitlement function:                        ║        │
    ║   verify Google JWT → look up tier in Stripe  ║        │
    ║   → mint E-token ⟨email, tier, ES256⟩         ║        │
    ╚═══════════════════════════════════════════════╝        │
          │  E-token ⟨email, tier⟩                           │
          ▼                                                 │
    Cache E-token on disk                                   │
          │                                                 │
          ▼                                                 ▼
    ┌──────────────────────────────────────────────────────────┐
    │ Create HMAC key   (per install · stays on this machine)   │
    └──────────────────────────────────────────────────────────┘
          │
          ▼
    Spawn R  ═══ HMAC key (env var) ═══▶  ┌───────────┐
                                          │ R / Shiny │
                                          └───────────┘
  └───────────────────────────────────────────────────────────────────────────┘

  LIVE SESSION
  ────────────────────────────────────────────────────────────────
    per request │ attach Session JWT ⟨HS256⟩  →  R checks w/ same HMAC key
    every 4 min │ refresh Session JWT  (5-min TTL)
  ────────────────────────────────────────────────────────────────
    HMAC key never leaves the machine — only signatures (inside JWTs) travel.

  also before spawn: data dir + sanity check  ·  30s WebSocket heartbeat (not auth)

  ── Anatomy of a JWT (the token that travels) ────────────────────
    JWT
     ├─ header     { "alg": "HS256" }
     ├─ payload    { "email":…, "tier":"pro", "exp":… }      ← readable, not secret
     └─ signature  ← HMAC( key, header + payload )           ← proves it's authentic

  ── Legend ───────────────────────────────────────────────────────
    Token : a string               Key  : makes & checks a signature
    JWT   : a signed token         HMAC : algorithm — key → signature
    E-token  ⟨ES256, asymmetric — minted in cloud, verified locally⟩
    Session  ⟨HS256, symmetric — minted & verified locally, shared key⟩
```
