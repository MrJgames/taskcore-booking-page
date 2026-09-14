"""Validate the static production SEO contract with Python's standard library."""
import json
import re
from html import unescape
from pathlib import Path
from urllib.parse import urlsplit
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
# Bermuda Dunes coverage is explicitly owner-confirmed; the visible list shows
# primary communities, not every community served.
expected_service_areas.append({'@type': 'Place', 'name': 'Bermuda Dunes, California'})
assert business['areaServed'][1:] == expected_service_areas
assert all(c in homepage.split('<body>')[1] for c in cities)
assert len(services) == 5
cards = re.findall(r'<article class="service-card[^\"]*">.*?<h3>(.*?)</h3><p>(.*?)</p></article>', homepage, re.S)
assert [(s['name'], s['description']) for s in services] == [(unescape(n), unescape(d)) for n, d in cards]
assert all(s['provider']['@id'] == business['@id'] for s in services)
assert not re.search(r'"(?:aggregateRating|review|price|award)"', blocks[0])
assert len(re.findall(r'<h1\b', homepage)) == 1
assert not re.search(r'itemscope|itemtype|vocab="https?://schema.org', homepage)
assert all(f'href="{url}"' in homepage for url in business['sameAs'])
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
assert locations == [ORIGIN + '/', ORIGIN + '/privacy.html', ORIGIN + '/connect/']
for url in locations:
    path = urlsplit(url).path
    file = ROOT / (path.lstrip('/') + 'index.html' if path.endswith('/') else path.lstrip('/'))
    page = file.read_text(encoding='utf-8')
    assert re.findall(r'<link rel="canonical" href="([^"]+)"', page) == [url]
    assert 'noindex' not in page
    for src in re.findall(r'(?:src|href)="([^"]+)"', page):
        parsed = urlsplit(src)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        target = ROOT / parsed.path.lstrip('/') if parsed.path.startswith('/') else file.parent / parsed.path
        assert target.exists(), f'Missing local asset: {src}'
print('PASS: schema, service/visible-content agreement, identity assets, metadata, canonicals, robots, sitemap and public-page assets')
