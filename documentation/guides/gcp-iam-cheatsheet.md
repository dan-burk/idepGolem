# Guide: GCP IAM Cheat Sheet

For when you're in the weeds and IAM is confusing again. Open this first.

## The mental model

IAM answers one question: **"Can [identity] do [role] on [resource]?"**

| Term | What it is | Example |
|------|-----------|---------|
| **Identity** | A "who" — human or robot account | You, or a Cloud Function's service account |
| **Role** | A bundle of permissions | `Secret Manager Secret Accessor` = can read secrets |
| **Resource** | The thing being acted on | A specific secret, a project, a bucket |

A **permission grant** is the triple *(Identity, Role, Resource)*. Many roles can
stack on one identity.

## Identity types you'll see

| Type | Format | When |
|------|--------|------|
| User | `you@orditus.com` | Humans in the console |
| Service account (custom) | `<name>@<project-id>.iam.gserviceaccount.com` | Made for a specific task |
| Service account (default Compute) | `<project-number>-compute@developer.gserviceaccount.com` | Auto-created. **Cloud Functions Gen 2 runs as this by default.** |
| Service account (default App Engine) | `<project-id>@appspot.gserviceaccount.com` | Auto-created. Older Gen 1 functions used this. |
| Group | `team@orditus.com` | Grant a role to everyone in a Google Group |

`<project-number>` = numeric ID *(iDEP: `997360372911`)*.
`<project-id>` = human-readable ID *(iDEP: `idep-496415`)*.

## Roles you'll grant repeatedly

| Role | Lets the identity… |
|------|-------------------|
| `roles/secretmanager.secretAccessor` | Read a secret's value (not modify) |
| `roles/cloudbuild.builds.builder` | Run Cloud Build jobs (Cloud Functions v2 needs this) |
| `roles/run.invoker` | Invoke a Cloud Run service / Cloud Function v2 |
| `roles/datastore.user` | Read/write Firestore |
| `roles/iam.serviceAccountUser` | Impersonate a service account |

Grant at the **smallest scope possible** — resource-level (a specific secret or
bucket) over project-level, when the UI allows it. Smaller blast radius if a
credential leaks. Use project-level for build/runtime roles that need broad
access.

## First-deploy gotchas — Cloud Functions v2

A fresh GCP project fails its first `firebase deploy` for **two** stacked
reasons. Fix in this order.

**Gotcha 1 — build SA missing the Cloud Build role.** Cloud Functions v2 builds
as the default Compute SA, which has *no roles* on a new project:

> Build failed… missing permission on the build service account

Fix: IAM & Admin → IAM → **Grant Access** → paste
`<project-number>-compute@developer.gserviceaccount.com` → add role **Cloud
Build Service Account** → Save.

*Why "Grant Access" and not the search list:* the IAM page hides principals with
zero role bindings. The SA exists but won't appear until it has a role.

**Gotcha 2 — Domain Restricted Sharing blocks `allUsers` invoker.** After the
build succeeds, the deploy fails granting public invoker access:

> Failed to set the IAM Policy… Unable to set the invoker for the IAM policy

Firebase's `invoker: "public"` grants `allUsers` the `run.invoker` role; the
org-default **Domain Restricted Sharing** policy blocks it.

Fix **at project scope only** (do *not* disable org-wide): Org Policies →
Domain restricted sharing → Edit → **Override parent's policy** → enforcement
**Merge with parent** → add rule → Policy values **Allow all** → Save.

*Why "Merge + Allow All":* it shows in audit logs as a deliberate override
("yes, this project allows public access"), rather than looking like nothing
changed.

**Order of operations:**
```
1. Grant Cloud Build Service Account role to default Compute SA → fixes build
2. Override Domain Restricted Sharing at project scope          → fixes invoker
3. firebase deploy                                              → succeeds
```

## Debugging "permission denied"

1. **What's the identity?** For a Cloud Function, check which service account it
   runs as.
2. **What permission is missing?** The error usually names it (e.g.
   `secretmanager.versions.access`).
3. **Which role contains it?** Search the role catalog at
   `cloud.google.com/iam/docs/understanding-roles`.
4. **Grant at the smallest scope that solves it.**

Most "permission denied" errors are one of: the default Compute SA missing a
role newer GCP defaults don't auto-grant; a service account reaching across
projects (needs an explicit grant); or an org policy blocking the grant.
