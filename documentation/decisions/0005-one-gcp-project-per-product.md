# ADR 0005 — One GCP project per product

**Status:** Accepted · **Date:** 2026-05

## Context

Orditus has multiple products (iDEP, ShinyGo, more later). Each needs Google
Cloud resources — an OAuth client, Secret Manager, a Cloud Function. GCP
resources can be organized as one shared project for everything, or one project
per product, all under the `orditus.com` organization.

## Decision

**One GCP project per product.** A product's web and desktop versions **share**
that product's project — they split at the **OAuth Client ID** level, not the
project level.

## Consequences

- Clean separation: each product has its own bill, its own keys, its own
  settings. No cross-product blast radius if something is misconfigured.
- Web + desktop of the same product share one login identity, one bill, and one
  `/entitlement` function — which is what you want; they're the same product.
- A new product means a new project (and the setup recipe in
  [`../guides/gcp-auth-setup.md`](../guides/gcp-auth-setup.md) is written to be
  reusable for exactly that).

## Notes

iDEP's project is `idep-496415` under org `orditus.com`. The same one-Stripe-
account-per-product principle applies on the billing side.
