"""Validate the static production SEO contract with Python's standard library."""
import json
import re
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urljoin, unquote
from urllib.robotparser import RobotFileParser
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://taskcorepros.com'
homepage = (ROOT / 'index.html').read_text(encoding='utf-8')
blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', homepage, re.S)
assert len(blocks) == 1, 'Expected one JSON-LD graph'
graph = json.loads(blocks[0])['@graph']
ids = [node['@id'] for node in graph]
assert len(ids) == len(set(ids)), 'Duplicate entity IDs'
business, website, *services = graph
assert business['name'] == website['name'] == 'TaskCore'
assert business['url'] == website['url'] == ORIGIN + '/'
assert website['publisher']['@id'] == business['@id']
assert business['telephone'] == '+1-760-239-9897'
assert business['email'] == 'service@taskcorepros.com'
assert 'address' not in business and 'streetAddress' not in blocks[0]
assert '(760) 239-9897' in homepage and business['email'] in homepage
cities = ['Palm Springs', 'Cathedral City', 'Rancho Mirage', 'Palm Desert', 'Indian Wells', 'La Quinta', 'Indio', 'Coachella']
expected_service_areas = [{'@type': 'City', 'name': c + ', California'} for c in cities]
# All nine owner-confirmed communities must also appear in visible content.
expected_service_areas.append({'@type': 'Place', 'name': 'Bermuda Dunes, California'})
assert business['areaServed'][1:] == expected_service_areas
assert all(c in homepage.split('<body>')[1] for c in cities + ['Bermuda Dunes'])
assert len(services) == 5
cards = re.findall(r'<article class="service-card[^\"]*">.*?<h3>(.*?)</h3><p>(.*?)</p></article>', homepage, re.S)
assert [(s['name'], s['description']) for s in services] == [(unescape(re.sub('<[^>]+>', '', n)), unescape(d)) for n, d in cards]
assert all(s['provider']['@id'] == business['@id'] for s in services)
assert not re.search(r'"(?:aggregateRating|review|price|award)"', blocks[0])
assert len(re.findall(r'<h1\b', homepage)) == 1
assert not re.search(r'itemscope|itemtype|vocab="https?://schema.org', homepage)
# Profiles verified through official public pages and owner dashboards.
# Evidence and any remaining profile corrections are in EXTERNAL_ENTITY_STATUS.md.
# Schema-only links do not require adding new visible UI to the homepage.
verified_profiles = {
    'https://www.instagram.com/taskcorepros',
    'https://www.facebook.com/61593100634969',
    'https://www.google.com/maps/place/TaskCore/data=!4m2!3m1!1s0x0:0xe3044f6430e9427',
    'https://www.yelp.com/biz/taskcore-bermuda-dunes',
}
assert set(business['sameAs']) == verified_profiles, 'Unexpected or missing verified profile'
assert len(business['sameAs']) == len(verified_profiles), 'Duplicate profile URL'
profile_evidence = (ROOT / 'EXTERNAL_ENTITY_STATUS.md').read_text(encoding='utf-8')
assert all(url in profile_evidence for url in verified_profiles), 'Missing profile evidence'
for key in ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']:
    assert len(re.findall(r'(?:name|property)="' + key + '"', homepage)) == 1, key
assert '<title>TaskCore | Coachella Valley Handyman &amp; Home Technology</title>' in homepage
manifest = json.loads((ROOT / 'manifest.json').read_text())
assert manifest['name'] == manifest['short_name'] == 'TaskCore'
for icon in manifest['icons']:
    assert (ROOT / icon['src']).is_file()
assert (ROOT / urlsplit(business['logo']).path.lstrip('/')).is_file()
assert business['logo'] == business['image']
assert (ROOT / 'CNAME').read_text().strip() == 'taskcorepros.com'
robots = (ROOT / 'robots.txt').read_text()
assert 'Sitemap: ' + ORIGIN + '/sitemap.xml' in robots
assert not re.search(r'Disallow:\s*/\s*$', robots, re.M)
locations = [e.text for e in ET.parse(ROOT / 'sitemap.xml').iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
slugs = ['repairs-maintenance', 'installations-assembly', 'wifi-connectivity', 'tv-entertainment', 'smart-home-technology']
service_urls = [ORIGIN + '/services/' + slug + '/' for slug in slugs]
assert locations == [ORIGIN + '/', ORIGIN + '/privacy.html', ORIGIN + '/connect/'] + service_urls
assert len(locations) == len(set(locations))

class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.meta, self.canonicals, self.links, self.ids = {}, [], [], set()
        self.duplicate_ids = set()
        self.titles, self.title_text, self.h1_count = [], None, 0
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            if attrs['id'] in self.ids:
                self.duplicate_ids.add(attrs['id'])
            self.ids.add(attrs['id'])
        if tag == 'meta':
            key = attrs.get('name', attrs.get('property'))
            if key:
                self.meta.setdefault(key, []).append(attrs.get('content', ''))
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonicals.append(attrs.get('href'))
        if tag == 'a' and 'href' in attrs:
            self.links.append(attrs['href'])
        if tag == 'title':
            self.title_text = ''
        if tag == 'h1':
            self.h1_count += 1

    def handle_data(self, data):
        if self.title_text is not None:
            self.title_text += data

    def handle_endtag(self, tag):
        if tag == 'title' and self.title_text is not None:
            self.titles.append(self.title_text)
            self.title_text = None

def source_file(url):
    path = urlsplit(url).path
    return ROOT / (path.lstrip('/') + 'index.html' if path.endswith('/') else path.lstrip('/'))

# Discover public HTML independently of the sitemap; never walk the backend.
public_files = set(ROOT.glob('*.html')) | set((ROOT / 'connect').rglob('*.html')) | set((ROOT / 'services').rglob('*.html'))
assert public_files == {source_file(url) for url in locations}, 'Public HTML and sitemap differ'
parsed_pages = {url: Page(source_file(url).read_text(encoding='utf-8')) for url in locations}
seen_titles, seen_descriptions = set(), set()
robots_policy = RobotFileParser()
robots_policy.parse(robots.splitlines())
for url in locations:
    path = urlsplit(url).path
    file = ROOT / (path.lstrip('/') + 'index.html' if path.endswith('/') else path.lstrip('/'))
    page = file.read_text(encoding='utf-8')
    parsed = parsed_pages[url]
    assert parsed.canonicals == [url], f'Canonical mismatch: {url}'
    assert len(parsed.titles) == 1 and 'TaskCore' in parsed.titles[0]
    assert parsed.titles[0] not in seen_titles, 'Duplicate title'
    seen_titles.add(parsed.titles[0])
    descriptions = parsed.meta.get('description', [])
    assert len(descriptions) == 1 and descriptions[0] and 'TaskCore' in descriptions[0]
    assert descriptions[0] not in seen_descriptions, 'Duplicate description'
    seen_descriptions.add(descriptions[0])
    assert parsed.h1_count == 1, url
    assert robots_policy.can_fetch('Googlebot', url)
    page_graph = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        data = json.loads(block)
        assert data['@context'] == 'https://schema.org'
        page_graph.extend(data.get('@graph', [data]))
    # Existing privacy/connect pages need not have schema, but any present must parse.
    if url != ORIGIN + '/':
        assert all(n.get('@type') not in ('LocalBusiness', 'HomeAndConstructionBusiness', 'Organization') and n.get('@id') != business['@id'] for n in page_graph)
    assert len([n['@id'] for n in page_graph if '@id' in n]) == len(set(n['@id'] for n in page_graph if '@id' in n))
    if url in service_urls:
        assert not parsed.duplicate_ids, (url, parsed.duplicate_ids)
        expected = services[service_urls.index(url)]
        assert expected['url'] == url
        assert [n for n in page_graph if n['@type'] == 'Service'] == [expected]
        assert expected['provider'] == {'@id': ORIGIN + '/#business'}
        crumbs = [n for n in page_graph if n['@type'] == 'BreadcrumbList']
        assert len(crumbs) == 1
        assert crumbs[0]['itemListElement'] == [
            {'@type': 'ListItem', 'position': 1, 'name': 'TaskCore', 'item': ORIGIN + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': expected['name'], 'item': url}]
        assert 'aria-label="Breadcrumb"' in page and 'aria-current="page"' in page
        assert expected['name'] in unescape(re.sub('<[^>]+>', '', page))
        assert all(c in page.split('<body')[1] for c in cities + ['Bermuda Dunes'])
        assert urlsplit(url).path in parsed_pages[ORIGIN + '/'].links
        assert '/' in parsed.links and '/#request' in parsed.links
        assert any(urljoin(url, link) in service_urls and urljoin(url, link) != url for link in parsed.links)
        for key in ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']:
            assert len(parsed.meta.get(key, [])) == 1 and parsed.meta[key][0], (url, key)
        assert parsed.meta['og:url'] == [url]
        assert parsed.meta['og:site_name'] == ['TaskCore']
        assert parsed.meta['og:title'] == parsed.meta['twitter:title'] == parsed.titles
        assert parsed.meta['og:description'] == parsed.meta['twitter:description'] == descriptions
        assert parsed.meta['og:image'] == parsed.meta['twitter:image'] == [business['logo']]
        assert 'tel:+17602399897' in parsed.links and 'mailto:service@taskcorepros.com' in parsed.links
        booking = [link for link in parsed.links if link.startswith('https://calendar.google.com/')]
        assert booking and all(link in parsed_pages[ORIGIN + '/'].links for link in booking)
    for link in parsed.links:
        target_url = urljoin(url, link)
        parts = urlsplit(target_url)
        if parts.netloc != urlsplit(ORIGIN).netloc or parts.scheme not in ('http', 'https'):
            continue
        target = source_file(target_url)
        assert target.exists(), f'Broken internal link: {url} -> {link}'
        if parts.fragment and target.suffix == '.html':
            target_page = Page(target.read_text(encoding='utf-8'))
            assert unquote(parts.fragment) in target_page.ids, f'Broken anchor: {link}'
    assert re.findall(r'<link rel="canonical" href="([^"]+)"', page) == [url]
    assert 'noindex' not in page
    for src in re.findall(r'(?:src|href)="([^"]+)"', page):
        parsed = urlsplit(src)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        target = ROOT / parsed.path.lstrip('/') if parsed.path.startswith('/') else file.parent / parsed.path
        assert target.exists(), f'Missing local asset: {src}'
print('PASS: schema, service/visible-content agreement, identity assets, metadata, canonicals, robots, sitemap and public-page assets')
