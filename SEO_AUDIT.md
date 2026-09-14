# TaskCore entity SEO audit — 2026-09-14

Production repository: MrJgames/taskcore-booking-page. Baseline: main at
e8db95c. The downloaded live homepage matched this revision after newline
normalization. Work is isolated on seo/taskcore-entity-clarity; not deployed.

## Audit and exact changes

| File | Change and reason |
| --- | --- |
| index.html | Strengthen the existing business graph rather than duplicate it. Keep TaskCore, #business, #website, canonical, title, phone, email and actual logo. Add five Service entities using the visible card names/descriptions and the existing business as provider. Explicitly identify Coachella Valley and retain the eight displayed cities. Remove the undisplayed Indio postal address, Bermuda Dunes entry and property-inspections claim. Remove the metadata-only insured claim pending confirmation. Add explicit Twitter title/description/image/alt and OG locale/image alt. Body remains identical. |
| manifest.json | Set full application name to TaskCore; preserve existing icons, launch URL and behavior. |
| service-worker.js | Increment cache version so existing installations refresh the changed homepage and manifest. Fetch logic and assets unchanged. |
| sitemap.xml | Update only homepage lastmod to the actual modification date; preserve public privacy and connect pages. |
| scripts/validate_seo.py | Reproducible standard-library validation of graph integrity, identity, services, assets, canonical metadata and indexable sitemap pages. |
| SEO_AUDIT.md | Record evidence, limits, profile TODOs, release validation and owner actions. |

Already valid and retained: one primary H1 (accessible visually-hidden heading
alongside the visible TaskCore logo), strong local title, single homepage
canonical, business and WebSite entities, correct phone/email, real brand assets,
Open Graph basics, Twitter summary card, robots.txt and sitemap.xml. No CSS,
form JavaScript, customer contact links, calendar booking flow or backend changed.

## Canonicals and crawlability

Live requests on the audit date returned 200 at the final canonical homepage
after following HTTP, www and mrjgames.github.io/taskcore-booking-page redirects.
The root with or without its slash represents the same URL. /index.html returns
200 with the homepage canonical; query variants share that canonical too.
GitHub Pages does not provide repository-level arbitrary HTTP redirect rules.
Do not add ineffective _redirects or .htaccess files. If an edge proxy is adopted
later, a permanent /index.html -> / redirect can further consolidate aliases.

Live robots.txt and sitemap.xml both returned 200. robots allows crawling and
references the correct sitemap. Sitemap contains only /, /privacy.html and
/connect/. No separate service pages currently exist; services are homepage
sections. No admin/API/private routes are listed. Authentication remains the
backend's responsibility; robots rules are not access controls.

## Entity links and profile TODOs

Preserved the two existing sameAs URLs because TaskCore explicitly links them
as its profiles in the homepage footer, privacy page and connect page:

- https://www.instagram.com/taskcorepros
- https://www.facebook.com/61593100634969

These are first-party repository/live-site confirmations. Direct social-network
fetches were unavailable, so current account ownership and profile contents were
not independently checked. Owner should confirm both in signed-in profile settings.
No new profile URL was invented. No Google, Yelp, Bing, Apple or Nextdoor listing
URL was found in the repository. Keep these TODOs in documentation, not as empty
strings or fake URLs in JSON-LD:

- TODO Google Business Profile: record verified public listing URL.
- TODO Yelp: record verified TaskCore listing URL.
- TODO Bing Places: record verified public business listing URL.
- TODO Apple Business Connect: record public Apple Maps place URL, not dashboard.
- TODO Nextdoor: record verified business page URL if one exists.

After confirming each listing matches TaskCore's phone, website and service area,
add its public URL to the existing business.sameAs array. Never link taskcore.app.

## Validation and limits

- Python scripts/validate_seo.py: passed.
- git diff --check: passed.
- Homepage body compared with baseline: identical after newline normalization.
- Existing backend npm run build: passed on Node 22.16.0.
- Existing backend npm test: all 12 tests in three files passed.
- No root build or lint script exists: production frontend is static HTML/CSS/JS.
- Browser checks at 390px and 1440px: no horizontal overflow; brand assets render.
- Local service request preparation with synthetic data succeeded and generated
  the correct service@taskcorepros.com mailto. Nothing sent or booked.
- npm ci reported five existing backend dependency vulnerabilities (four moderate,
  one high). Lockfile unchanged; dependency remediation is separate work.

Schema syntax and consistency are validated locally. This is not a Google Rich
Results Test certification. HomeAndConstructionBusiness is a LocalBusiness subtype
and inherits Organization; a second business object is unnecessary. Google Local
Business rich results require an address. This service-area implementation omits
an unconfirmed physical address and may not qualify for that rich result. Do not
publish a private address to satisfy it. Service markup describes real services;
it does not promise a Google service rich result or improved ranking.

References: https://schema.org/HomeAndConstructionBusiness and
https://developers.google.com/search/docs/appearance/structured-data/local-business

## Owner checklist after release

- [ ] Verify the taskcorepros.com Domain property in Google Search Console via DNS.
  Submit /sitemap.xml, inspect the homepage live URL, request indexing, and monitor
  Google's selected canonical and branded search impressions.
- [ ] Finish/verify Google Business Profile. Use TaskCore as the business name,
  (760) 239-9897, https://taskcorepros.com/ and the actual service area. Use accurate
  categories and hours; hide the private address for a service-area business.
- [ ] Claim/update Yelp with the same name, phone, website and service descriptions.
- [ ] Claim/update Bing Places and verify the business details.
- [ ] Set up/verify Apple Business Connect and the associated Maps listing.
- [ ] Confirm Facebook/Instagram ownership; ensure each links to taskcorepros.com
  and carries matching business/contact details. Add verified new sameAs URLs.
- [ ] Ask actual customers for honest reviews consistently; no incentives,
  fabricated reviews or filtering requests to only satisfied customers.
- [ ] Build accurate local citations through relevant Coachella Valley directories,
  chambers and business associations; correct duplicate/inconsistent listings.
- [ ] Earn legitimate mentions and links from local partners, property managers
  and community organizations through real relationships and useful work.
- [ ] Run Google's Rich Results Test and URL Inspection after release, recognizing
  the intentional service-area address limitation above.

## Future page readiness

Start with useful standalone service pages for the five existing categories if
the owner can supply original job examples, photos used with permission, scope,
common questions and a clear contact path. Link them from existing service cards
and assign self-canonicals before adding to the sitemap. City/service pages should
follow only when each has substantial, distinct local evidence; do not generate
eight near-identical pages or service/city permutations. Keep the existing
homepage as the principal TaskCore entity page.
