"""Check that production serves this checkout's public pages and SEO assets.

Run after the GitHub Pages build for the merged commit succeeds.
Uses only Python's standard library; never sends forms or modifies production.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://taskcorepros.com'
urls = [e.text for e in ET.parse(ROOT / 'sitemap.xml').iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
urls += [ORIGIN + '/' + p for p in ['sitemap.xml', 'robots.txt', 'service-worker.js', 'styles.css', 'services/services.css', 'script.js']]

def verify(url):
    assert url.startswith(ORIGIN + '/'), 'Unexpected production origin'
    path = urlsplit(url).path.lstrip('/')
    if not path or path.endswith('/'):
        path += 'index.html'
    expected = (ROOT / path).read_text(encoding='utf-8').replace('\r\n', '\n')
    request = Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'TaskCore-Deployment-Check/1.0'})
    with urlopen(request, timeout=30) as response:
        assert response.status == 200, (url, response.status)
        assert response.url == url, ('Unexpected redirect', url, response.url)
        actual = response.read().decode('utf-8').replace('\r\n', '\n')
    assert actual == expected, 'Production differs from checkout: ' + url
    return 'PASS 200 and content match: ' + url

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(verify, urls):
            print(result)
    print(f'PASS: production matches checkout for all {len(urls)} public pages and SEO assets')
