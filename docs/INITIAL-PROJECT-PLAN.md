# Taskcore Billing and Website

This project is the working home for improving the Taskcore website, adding billing, and connecting approved Google Workspace services.

## Goals

- Build and improve the public Taskcore website.
- Add secure subscription billing and a customer billing portal.
- Connect the required Google Workspace services with least-privilege access.
- Keep credentials and production secrets out of source control.

## Project areas

- `website/` - website pages, components, styles, and assets.
- `billing/` - billing plans, checkout, webhooks, and portal implementation.
- `google-workspace/` - Google Workspace integration notes and implementation.
- `docs/` - product decisions, content, launch, and testing documentation.

## Recommended implementation order

1. Define the Taskcore audience, offer, brand direction, and required pages.
2. Choose the website framework and hosting platform.
3. Define billing plans, currencies, trials, taxes, coupons, and cancellation rules.
4. Add billing in test mode and verify every webhook and customer lifecycle path.
5. Connect only the Google Workspace services Taskcore actually needs.
6. Complete accessibility, mobile, security, privacy, analytics, and launch checks.

## Security rules

- Never commit API keys, OAuth client secrets, service-account JSON, webhook secrets, or customer data.
- Start all billing work in test/sandbox mode.
- Use OAuth with the smallest possible Google scopes.
- Store production secrets in the hosting provider's encrypted environment settings.
- Verify billing webhook signatures and make webhook processing idempotent.

## Decisions needed next

See `docs/PROJECT-BRIEF.md` and fill in the items marked `TBD`. Once those choices are made, the website and billing implementation can begin without guesswork.
