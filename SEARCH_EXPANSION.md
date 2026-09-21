# TaskCore local service search expansion

Baseline: remote main `5d81ec1`. Commit `39fa123` was absent from this checkout
and the requested expansion branch did not exist on the remote. Recreated on
`seo/taskcore-search-expansion` with owner authorization to push, merge and deploy.

## Published scope

- Two service pages: `/services/property-maintenance/` and
  `/services/pool-controls-diagnostics/`.
- One substantial area hub: `/service-areas/coachella-valley/`, with distinct
  visit-preparation sections for all nine approved communities. No city doorway pages.
- Expanded handyman repairs, furniture assembly/household installation and TV
  mounting/entertainment content. Existing Wi-Fi and smart-home content retained
  and interlinked. All seven service pages link to the area hub.
- Seven homepage cards and matching service-request choices. The service-area
  section links to the hub. Existing black, metallic-gold and silver styles retained.
- Unique metadata, self-canonicals, social metadata, visible breadcrumbs and
  WebPage/BreadcrumbList data on the new pages and existing service pages.
  Service data on all seven detail pages matches the homepage and references
  the established `https://taskcorepros.com/#business` entity. The hub describes
  the area and references that entity without defining a second business.
- Sitemap expanded to 11 public URLs. Service-worker cache version incremented
  and all new routes included. Existing contact, calendar and consent flow retained.

Pool service explicitly excludes pool cleaning, chemical balancing, gas work,
internal pump/heater repairs and licensed electrical work. No prices, credentials,
reviews, guarantees or new business locations are claimed.

## Validation and deployment

`python scripts/validate_seo.py` checks all 11 public pages, sitemap completeness,
metadata uniqueness, canonical URLs, structured data, visible service/schema
agreement, seven request options, internal links and anchors, local assets,
service-area sections, pool exclusions and the service-worker route list.

Browser verification covers service-card navigation, the new pages, the hub,
mobile overflow and the prepared-request flow without sending a message.

GitHub Pages publishes the root of `main`. After the pull request merges and its
Pages deployment succeeds, run `python scripts/verify_deployment.py`. This compares
the live HTML of every sitemap URL and key SEO assets with the checked-out merged
revision, so a successful Git push alone cannot be mistaken for deployment.

Search-engine crawling, indexing and rankings are separate from deployment and
are not asserted by these checks.
