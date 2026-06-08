# iDEP Desktop — Manual Test Script (sign-in & billing)

Last validated: **1.0.9**, plus the **1.0.10** offline-guard fix (FLOW 5) and the
"Sending you to Stripe…" spinner (FLOWS 2 & 7).

## Why this file exists
The desktop sign-in + Stripe billing flow has a lot of moving parts and edge cases
that are easy to forget after a few weeks. This walks the **whole user lifecycle**
as a handful of "strings of actions." Run a flow top-to-bottom; each step says what
to **DO** and what you should **SEE**. If every `✅ EXPECT` matches, that flow passes.
A `❌ FAIL` line (where present) calls out the specific wrong behavior to watch for.

---

## Read this first — the 4 things that confuse everyone

1. **Entitlement = app access.** A signed token cached in your `userData` folder,
   valid ~24h. It's what lets you *open iDEP*. Works **offline** within that window.
2. **Refresh token (`google-refresh.bin`) = billing logins only.** It mints a fresh
   Google login when you click **Manage Subscription**. Deleting it does **NOT** lock
   you out of the app — it only forces a re-login the next time you manage billing.
3. **Manage Subscription routing:** **Pro / trialing → Stripe Portal** (manage / cancel).
   **Free → Stripe Checkout** (start paying).
4. **Account rule:** you can only re-authenticate the account you're **already** signed
   in as. To switch accounts the ONLY way is **Sign Out → Sign In**.

## Setup helpers
- **Find the credential files** (PowerShell):
  ```
  Get-ChildItem $env:APPDATA -Recurse -Filter *.bin -ErrorAction SilentlyContinue | Select FullName
  ```
  You want `google-refresh.bin` and `entitlement.bin`.
- **"Delete the refresh token"** below always means: delete `google-refresh.bin`.
- **Test card** (Stripe test mode): `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.
- Use a machine signed into **two** Google accounts for the account-switch flows.

---

## FLOW 1 — An update keeps you signed in
**Why:** installing a new version must NOT log the user out.
1. DO: Install the new version over the old one.
2. DO: Open iDEP. ✅ EXPECT: opens straight to the app, **no** Google login.
3. DO: Account → Manage Subscription. ✅ EXPECT: goes to Stripe with no login prompt.

## FLOW 2 — Manage Subscription round trip (Pro user)
**Why:** the happy path, and that the browser returns to our page.
1. DO: Account → Manage Subscription. ✅ EXPECT: a small **"Sending you to Stripe…"**
   spinner appears, then the Stripe billing **Portal** opens in your browser.
2. DO: In the browser, click Back / finish. ✅ EXPECT: lands on the
   **orditus.com/idep-return** page.

## FLOW 3 — Silent login is gone, you pick the RIGHT account
**Why:** if the refresh token is missing, we re-login the *current* account with a
pinned popup — and the app itself is never locked.
- SETUP: Close iDEP. Delete the refresh token.
1. DO: Open iDEP. ✅ EXPECT: app opens normally (no login — entitlement cache still valid).
2. DO: Manage Subscription. ✅ EXPECT: Google popup, already showing your signed-in account.
3. DO: Pick that account. ✅ EXPECT: continues to Stripe and works.

## FLOW 4 — The WRONG account is refused (the important guard)
**Why:** you must NOT be able to switch accounts mid-session — that could open billing
for the wrong person. Switching is only allowed via Sign Out → Sign In.
- SETUP: With iDEP open, delete the refresh token.
1. DO: Manage Subscription. ✅ EXPECT: Google popup.
2. DO: Pick a **different** account (e.g. a secondary). ✅ EXPECT: a **"Wrong Account"**
   message telling you to Sign Out then Sign In. **Nothing opens.**
3. DO: Account → Sign Out. ✅ EXPECT: app restarts to login.
4. DO: Sign in with that other account, then Manage Subscription. ✅ EXPECT: works for it.

## FLOW 5 — Offline (the 1.0.10 fix lives here)
**Why:** (a) using the app shouldn't need internet within the 24h cache window;
(b) clicking Manage Subscription offline must fail fast, not freeze the button.
- SETUP: Delete the refresh token. Turn **OFF** internet.
1. DO: Open iDEP. ✅ EXPECT: app opens and works (cached entitlement — this is the
   normal cache path, not "grace").
2. DO: Manage Subscription. ✅ EXPECT (1.0.10): an instant **"Connection Problem"**
   message, and the button still works afterward.
   ❌ FAIL (this was the 1.0.9 bug): the button does nothing / stays dead for ~5 min.
3. DO: Turn internet back ON, click Manage Subscription. ✅ EXPECT: works again immediately.

## FLOW 6 — Cancel while still in trial
**Why:** canceling shouldn't flip your routing as long as Stripe still shows you Pro/trialing.
1. DO: In Stripe, cancel your subscription while the trial is still active. Keep iDEP open.
2. DO: Manage Subscription. ✅ EXPECT: Stripe **Portal** (still Pro tier this session).

## FLOW 7 — Free user pays and becomes Pro (the full money path)
**Why:** the free → Checkout → pay → Pro → Portal lifecycle.
- SETUP: Make sure your Stripe subscription is fully canceled/ended so you are **Free**.
1. DO: Restart iDEP. ✅ EXPECT: you can still log in (free tier is allowed; build is
   above the minimum gating version).
2. DO: Manage Subscription. ✅ EXPECT: the **"Sending you to Stripe…"** spinner, then
   Stripe **Checkout** (NOT Portal — you're free).
3. DO: Enter the test card, submit. ✅ EXPECT: approved, browser redirects to **idep-return**.
4. DO: Back in iDEP, Manage Subscription again. ✅ EXPECT: now Stripe **Portal** (Pro again).

## FLOW 8 — Small stuff that should "just work"
1. DO: Click Manage Subscription **twice, fast**. ✅ EXPECT: only ONE browser window/popup.
2. DO: Launch iDEP normally. ✅ EXPECT: **no** "Load Error" dialog.
3. DO: Start any app that grabs **port 7777**, then launch iDEP. ✅ EXPECT: iDEP still loads
   fine (it auto-picks another free port).
   - NOTE: if 7777 is already held by a leftover iDEP/R process from a previous crash,
     kill that first — otherwise you're testing the wrong thing.

## FLOW 9 — Sign Out can't be faked when a credential file is locked
**Why:** if a credential file can't be deleted (locked / in use), iDEP must NOT pretend
sign-out worked and relaunch you straight back into the same account. It must say it failed.
- SETUP: With iDEP open and signed in, lock **one** credential file so it can't be deleted.
  Most reliable way (PowerShell — leave the window OPEN so the lock holds):
  ```
  $f = [System.IO.File]::Open("<path to entitlement.bin>", 'Open', 'Read', 'None')
  ```
  Simpler alternative: `attrib +R "<path to entitlement.bin>"` (read-only also blocks delete).
1. DO: Account → Sign Out → confirm. ✅ EXPECT: a **"Sign Out Failed"** dialog that mentions
   a locked credential file and points to **info@orditus.com**. The app does **NOT** relaunch.
   ❌ FAIL: the app relaunches and silently signs you back in as if sign-out worked.
2. DO: Release the lock — `$f.Close()` in PowerShell (or `attrib -R "<path>"`).
3. DO: Account → Sign Out → confirm again. ✅ EXPECT: normal sign-out — app relaunches
   to the login screen.
