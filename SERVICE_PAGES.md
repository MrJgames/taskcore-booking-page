# TaskCore service-page expansion

Baseline: production main at 65b3815 (merged PR #2). This change is proposed on
seo/taskcore-service-pages. Do not merge or deploy until the owner authorizes it;
GitHub Pages publishes automatically from main.

## New public pages

| File | Canonical URL | Purpose |
| --- | --- | --- |
| services/repairs-maintenance/index.html | https://taskcorepros.com/services/repairs-maintenance/ | Explain household repairs, adjustments, replacements and upkeep; help customers describe the affected items. |
| services/installations-assembly/index.html | https://taskcorepros.com/services/installations-assembly/ | Explain household installation, mounting, assembly and setup; distinguish assembly from placement and mounting. |
| services/wifi-connectivity/index.html | https://taskcorepros.com/services/wifi-connectivity/ | Explain coverage, router/network setup and device connection problems; identify useful troubleshooting details. |
| services/tv-entertainment/index.html | https://taskcorepros.com/services/tv-entertainment/ | Explain TV, streaming-device, soundbar and mounting support; distinguish picture/sound problems from network issues. |
| services/smart-home-technology/index.html | https://taskcorepros.com/services/smart-home-technology/ | Explain connected-device setup and troubleshooting for the existing smart-device, camera, doorbell and thermostat scope. |

Each page contains original service-specific guidance, supported job examples,
preparation details, relevant related-service links, all nine service communities,
visible breadcrumbs, homepage/request links and the existing call/text/email and
Google Calendar booking destinations. Examples describe types of work, not claims
about completed customer jobs. No new licenses, insurance, certifications,
warranties, prices, reviews, customer counts or unsupported services were added.

Each has a unique title and description, a self-canonical, OG/Twitter metadata,
the actual logo, one H1, Service and BreadcrumbList JSON-LD. Existing Service IDs
are retained across the homepage and detail pages; their url properties now point
to the detail pages. Providers reference https://taskcorepros.com/#business.
There is still only one fully defined business, on the homepage. No physical
address is published.

## Other changed files

- index.html: links all five existing cards to their service pages without changing
  the card content or geometry; adds Bermuda Dunes to the visible community list;
  updates the existing service URLs and documents the Search Console insertion point.
- services/services.css: small scoped addition for whole-card links and keyboard
  focus, service-page headings/breadcrumbs/CTAs, and a readable desktop community
  list. The existing stylesheet and homepage branding are preserved. The nine-item
  list remains visible on mobile and is now also visible under the desktop map.
- sitemap.xml: adds exactly the five service URLs, for eight public pages total.
  No private, admin, API or test routes are included. robots.txt remains valid.
- service-worker.js: increments the static cache version and includes the new
  pages and stylesheet for existing PWA users. Network/fallback behavior unchanged.
- scripts/validate_seo.py: independently discovers public HTML in the root,
  connect and services directories and checks sitemap coverage. Validates unique
  titles/descriptions, identity, one H1, self-canonicals, crawl permission, JSON-LD,
  consistent Service/provider identity, breadcrumbs, related/home/request links,
  local assets and fragment destinations. Existing privacy/connect pages have no
  JSON-LD requirement; any schema present is parsed and checked.
- SEO_AUDIT.md: labels the original audit as baseline history and points here for
  the expanded page inventory.
- SERVICE_PAGES.md: this implementation, validation and owner handoff.

## Google Search Console verification

No verification token was found in the repository, and no token was invented.

Preferred: verify the taskcorepros.com Domain property using the exact DNS TXT
record supplied by Search Console. This requires access to the domain's DNS and
does not require an HTML meta tag.

If using the https://taskcorepros.com/ URL-prefix property with HTML-tag verification:

1. In Search Console, select that exact property and the HTML tag method.
2. Copy the complete owner-issued meta tag with name="google-site-verification".
3. In the root index.html head, find the comment beginning "Search Console URL-prefix
   verification" directly after the theme-color meta tag. Replace that comment
   with the exact issued tag, including its unchanged content value. Keep it inside
   head, outside scripts; do not put a placeholder token into production.
4. Review/deploy that change, confirm the tag is present in the live homepage HTML,
   then click Verify in Search Console. Keep the tag after verification.

Service pages do not each need a separate verification tag. After this PR is
authorized and live, submit https://taskcorepros.com/sitemap.xml, inspect each new
canonical URL and request indexing where appropriate. Check Google's selected
canonical after crawling. No Search Console operation was performed in this PR.

## Validation

- Production/backend TypeScript build passed on Node 22.16.0.
- All 12 existing tests in three files passed.
- SEO validator passed for all eight public pages.
- Syntax checks passed for script.js, consent.js, public-stats.js, config.js and
  service-worker.js. The new pages add no application JavaScript.
- git diff --check passed.
- Browser smoke checks: all five pages at 390px and 1440px, one H1 and correct
  canonical per page, no horizontal overflow; brand assets rendered.
- Card navigation to Wi-Fi & Connectivity and its return link to the homepage
  request form worked. Synthetic request preparation produced the correct SMS and
  email destinations. No message was sent and no calendar appointment was booked.
- Mobile menu opened/closed correctly, and the TV & Entertainment card navigated
  to its service page. The nine-community list is visible on desktop and mobile.
- Automated link checks confirm new booking URLs exactly match the homepage's
  existing Google Calendar URL and preserve call/email contact destinations.

The public frontend is static HTML/CSS/JS with no separate frontend build command.
Existing backend dependency findings from the baseline remain outside this change.
Schema syntax/consistency checks are local, not a Google Rich Results certification.
References: https://schema.org/Service and
https://developers.google.com/search/docs/appearance/structured-data/breadcrumb

## Owner actions and future content

- Authorize merge/release when satisfied with the proposed content. A PR alone
  does not make the new URLs live.
- Supply the exact Search Console verification tag or complete DNS verification;
  submit the updated sitemap and inspect/request indexing after release.
- Continue the existing profile-consistency, verified sameAs, legitimate reviews,
  citations and local backlink checklist in SEO_AUDIT.md.
- Add original job photographs and specific completed-job examples only when
  accurate and permission is available. They are not fabricated for this PR.
- City pages remain a future option only after TaskCore has unique local evidence,
  job examples, photos and substantial useful content for each community. Do not
  create near-identical city or city/service permutations. None are included here.
