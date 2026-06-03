# iDEP Desktop — Electron Architecture (ASCII)

```
  ┌──────────────────────────────┐
  │   NodeJS Package Community    │
  │     Stripe     Firebase       │
  └──────────────┬───────────────┘
                 │ npm install …
                 ▼
╔═══════════════════════════════════════════════════════════════════════════╗
║ ELECTRON                                       Node + Chromium + glue (C++) ║
║                                                                             ║
║   ┌─────────────────────────┐          ┌╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴┐          ║
║   │ SYSTEM ACCESS           │          ╎ SANDBOX                ╎          ║
║   │ Backend (Node)          │◄───IPC───►╎ Frontend (JS)          ╎          ║
║   └────┬────────┬─────────┬─┘          └╴╴╴╴╴╴╴╴╴╴╴╴╴▲╴╴╴╴╴╴╴╴╴╴╴┘          ║
║        │        │         │                          │                     ║
╚════════╪════════╪═════════╪══════════════════════════╪═════════════════════╝
         │        │         │                          │
   r/w   │  call  │  spin   │                          │  serves web UI
  files  ▼        ▼   up    ▼                          │  (must be browser)
     ┌───────┐┌───────┐┌─────────┐                     │
     │   C:  ││  API  ││ R/Shiny │─────────────────────┘
     └───────┘└───────┘└─────────┘
```

## Legend

- **Solid box = full system access** (privileged); **dashed box = sandbox** (restricted).
- **Electron is the outer container** — both the Node backend (main process) and the
  sandboxed JS frontend (renderer) live inside it. Electron *is* Node + Chromium + C++ glue.
- **Backend capabilities** (arrows out of the backend): spin up an `R/Shiny` shell,
  `read/write` the filesystem (`C:`), `call` APIs, and `npm install` arbitrary community
  packages (Stripe, Firebase).
- **`IPC`** is the backend↔frontend control bridge.
- **`R/Shiny → Frontend` ("serves web UI")** is the *why Electron* point: a Shiny app only
  renders in a browser, and Chromium (inside the sandboxed frontend) is that browser.
