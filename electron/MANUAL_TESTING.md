# iDEP Desktop — Manual Test Script (sign-in & billing)

Last validated: **1.0.9**, plus the **1.0.10** offline-guard fix (FLOW 5) and the
"Sending you to Stripe…" spinner (FLOWS 2 & 7).

## Why this file exists
The desktop sign-in + Stripe billing flow has a lot of moving parts and edge cases
that are easy to forget after a few weeks. This walks the **whole user lifecycle**
as a handful of "strings of actions." Run a flow top-to-bottom; each step says what
to **DO** and what you should **SEE**. If every `✅ EXPECT` matches, that flow passes. A `❌ FAIL` line (where present) calls out the specific wrong behavior to watch for.

---

## Read this first — the 4 things that confuse everyone

1. **Entitlement = app access.** A signed token cached in your `userData` folder, valid ~24h. It's what lets you *open iDEP*. Works **offline** within that window.
2. **Refresh token (`google-refresh.bin`) = billing logins only.** It mints a fresh Google login when you click **Manage Subscription**. Deleting it does **NOT** lock you out of the app — it only forces a re-login the next time you manage billing.
3. **Manage Subscription routing:** **Pro / trialing → Stripe Portal** (manage / cancel).
   **Free → Stripe Checkout** (start paying).
4. **Account rule:** you can only re-authenticate the account you're **already** signed in as. To switch accounts the ONLY way is **Sign Out → Sign In**.

## Setup helpers
- **Find the credential files:**
  - Windows: `C:\Users\<user>\AppData\Roaming\idepGolem`
  - Linux: `~/.config/idepGolem`
  You want `google-refresh.bin` and `entitlement.bin`.
- **"Delete the refresh token"** below always means: delete `google-refresh.bin`.
- **Test card** (Stripe test mode): `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.
- Use a machine signed into **two** Google accounts for the account-switch flows.

---

## FLOW 1 — An update keeps you signed in — ✅ Verified 1.0.9
**Why:** installing a new version must NOT log the user out.
1. DO: Install the new version over the old one.
2. DO: Open iDEP. ✅ EXPECT: opens straight to the app, **no** Google login.
3. DO: Account → Manage Subscription. ✅ EXPECT: goes to Stripe with no login prompt.

## FLOW 2 — Manage Subscription round trip (Pro user) — ✅ Verified 1.0.10
**Why:** the happy path, and that the browser returns to our page.
1. DO: Account → Manage Subscription. ✅ EXPECT: a small **"Sending you to Stripe…"** spinner appears, then the Stripe billing **Portal** opens in your browser.
2. DO: In the browser, click Back / finish. ✅ EXPECT: lands on the **orditus.com/idep-return** page.

## FLOW 3 — Silent login is gone, you pick the RIGHT account — ✅ Verified 1.0.9
**Why:** if the refresh token is missing, we re-login the *current* account with a
pinned popup — and the app itself is never locked.
- SETUP: Close iDEP. Delete the refresh token `google-refresh.bin`.
1. DO: Open iDEP. ✅ EXPECT: app opens normally (no login — entitlement cache still valid).
2. DO: Manage Subscription. ✅ EXPECT: Google popup, already showing your signed-in account.
3. DO: Pick that account. ✅ EXPECT: continues to Stripe and works.

## FLOW 4 — The WRONG account is refused (the important guard) — ✅ Verified 1.0.9
**Why:** you must NOT be able to switch accounts mid-session — that could open billing for the wrong person. Switching is only allowed via Sign Out → Sign In.
- SETUP: With iDEP open, delete the refresh token `google-refresh.bin`.
1. DO: Manage Subscription. ✅ EXPECT: Google popup.
2. DO: Pick a **different** account (e.g. a secondary). ✅ EXPECT: a **"Wrong Account"** message telling you to Sign Out then Sign In. **Nothing opens.**
3. DO: Account → Sign Out. ✅ EXPECT: app restarts to login.
4. DO: Sign in with that other account, then Manage Subscription. ✅ EXPECT: works for it.

## FLOW 5 — Offline (the 1.0.10 fix lives here) — ✅ Verified 1.0.10
**Why:** (a) using the app shouldn't need internet within the 24h cache window (unless they want to pull down Annotation Data);
(b) clicking Manage Subscription offline must fail fast, not freeze the button.
- SETUP: Delete the refresh token `google-refresh.bin`. Turn **OFF** internet.
1. DO: Open iDEP. ✅ EXPECT: app opens and works (cached entitlement — this is the
   normal cache path, not "grace" period which only fires when both cache has expired AND can't reach GCP servers).
2. DO: Manage Subscription. ✅ EXPECT (1.0.10): an instant **"Connection Problem"** message, and the button still works afterward. ❌ FAIL (this was the 1.0.9 bug): the button does nothing / stays dead for ~5 min.
3. DO: Turn internet back ON, click Manage Subscription. ✅ EXPECT: works again immediately.

## FLOW 6 — End-of-term cancel keeps you Pro; immediate cancel drops you to Free — ✅ Step 1 Verified 1.0.9 · ⬜ Step 2 NOT verified
**Why:** 
A cancel **at period end** leaves Stripe reporting `trialing` until the trial-end date, so you stay on the Portal until the term actually ends — NOT dropped to Checkout early. An **immediate** cancel flips the status to `canceled` (not a Pro status) → Free → Checkout.
- SETUP: cancel **at end of period** (the default) so status stays `trialing`. Keep iDEP open.
1. DO: Manage Subscription. ✅ EXPECT: Stripe **Portal** (still `trialing` = Pro). ❌ FAIL: it sends you to Checkout (would mean the scheduled cancel dropped you early).
2. ⬜ **NOT VERIFIED** (inferred from the live tier re-fetch; you only confirmed Checkout via *restart* in FLOW 7, never same-session). DO: In the Stripe **Dashboard**, cancel **immediately** (status → `canceled`), then click Manage Subscription again (no restart — tier is re-fetched live each click). ✅ EXPECT: Stripe **Checkout** (Free now — same as once the trial ends naturally).

## FLOW 7 — Free user pays and becomes Pro (the full money path) — ✅ Verified 1.0.10
**Why:** the free → Checkout → pay → Pro → Portal lifecycle.
- SETUP: Make sure your Stripe subscription is fully canceled/ended so you are **Free**.
1. DO: Restart iDEP. ✅ EXPECT: you can still log in (free tier is allowed; build is above the minimum gating version).
2. DO: Manage Subscription. ✅ EXPECT: the **"Sending you to Stripe…"** spinner, then Stripe **Checkout** (NOT Portal — you're free).
3. DO: Enter the test card, submit. ✅ EXPECT: approved, browser redirects to **idep-return**.
4. DO: Back in iDEP, Manage Subscription again. ✅ EXPECT: now Stripe **Portal** (Pro again).

## FLOW 8 — Small stuff that should "just work" — ✅ Verified 1.0.9
1. DO: Click Manage Subscription **twice, fast**. ✅ EXPECT: only ONE browser window/popup.
2. DO: Launch iDEP normally. ✅ EXPECT: **no** "Load Error" dialog.
3. DO: Start any app that grabs **port 7777**, then launch iDEP. ✅ EXPECT: iDEP still loads
   fine (it auto-picks another free port).
   - NOTE: if 7777 is already held by a leftover iDEP/R process from a previous crash,
     kill that first — otherwise you're testing the wrong thing.

## FLOW 9 — Sign Out can't be faked when a credential file is locked — ✅ Verified 1.0.10
**Why:** if a credential file can't be deleted (locked / in use), iDEP must NOT pretend
sign-out worked and relaunch you straight back into the same account. It must say it failed.
- SETUP: iDEP open, signed in. lock **one** credential file (entitlement.bin or google-refresh.bin) so it can't be deleted (locking one is enough — `clearCredentials` fails if *either* file can't be removed).

  **Windows** — most reliable (PowerShell; leave  OPEN):
  ```
  $f = [System.IO.File]::Open("<path to entitlement.bin>", 'Open', 'Read', 'None')
  ```

  **Linux** — ⚠️ a read-only *file* can still be deleted on Linux Use the immutable
  flag instead (needs `sudo`):
  ```
  sudo chattr +i "<path to entitlement.bin>"
  ```
1. DO: Account → Sign Out → confirm. ✅ EXPECT: a **"Sign Out Failed"** dialog that mentions
   a locked credential file and points to **info@orditus.com**. The app does **NOT** relaunch.
   ❌ FAIL: the app relaunches and silently signs you back in as if sign-out worked.
2. DO: Release the lock —
   - Windows: `$f.Close()` in PowerShell.
   - Linux: `sudo chattr -i "<path>"`.
3. DO: Account → Sign Out → confirm again. ✅ EXPECT: normal sign-out — app relaunches
   to the login screen.

## FLOW 10 — Force-upgrade gate for Free tier — ✅ Verified 1.0.10
**Why:** with `FREE_TIER_POLICY=update`, a **Free** user on a build older than the gated minimum
must hit the "Update Required" dialog at startup — not silently get in, not go to Checkout. This
is the `update_required` path.
- WHICH VARIABLE: it's **not** a policy swap. Keep `FREE_TIER_POLICY=update` and **raise
  `FREE_GATING_MIN_VERSION` above your installed build** (e.g. `99.0.0`) in
  `idep-functions/functions/.env.idep-496415`, then **redeploy** the function. You must be on the
  **Free** tier (sub canceled/ended) — Pro/trialing users are never gated.
- ⚠️ This edits **live prod config**. Change it, test fast, then **REVERT** `FREE_GATING_MIN_VERSION`
  to the real value (`0.0.8`) and redeploy.
1. DO: Restart iDEP (Free tier, build < the new min). ✅ EXPECT: at startup, an **"Update Required"**
   dialog with three buttons — **Update / Upgrade to Pro / Quit**. iDEP does NOT launch.
   ❌ FAIL: the app opens normally, or sends you straight to Checkout.
2. DO: Click **Update**. ✅ EXPECT: the releases/download page opens in your browser, then iDEP closes.
3. DO: Reopen, click **Upgrade to Pro**. ✅ EXPECT: Stripe **Checkout** opens, then iDEP closes.
4. DO: Reopen, click **Quit**. ✅ EXPECT: iDEP just closes.
- CLEANUP: set `FREE_GATING_MIN_VERSION` back to `0.0.8`, redeploy, and confirm a normal Free launch works again.
