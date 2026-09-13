import unittest
from pathlib import Path
from xml.etree import ElementTree

from main import robots, sitemap


SITEMAP_URL = "https://image-compressor-hzjj.onrender.com/sitemap.xml"
CANONICAL_URL = "https://image-compressor-hzjj.onrender.com/"


class SeoEndpointTests(unittest.TestCase):
    def test_sitemap_response_contract(self):
        response = sitemap()
        self.assertEqual(response.media_type, "application/xml")
        self.assertEqual(response.headers["cache-control"], "public, max-age=3600")

        body = Path(response.path).read_bytes()
        root = ElementTree.fromstring(body)
        namespace = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        locations = [node.text for node in root.findall(f"{namespace}url/{namespace}loc")]

        self.assertEqual(root.tag, f"{namespace}urlset")
        self.assertEqual(locations, [CANONICAL_URL])
        self.assertTrue(all(location.startswith("https://") for location in locations))

    def test_robots_response_contract(self):
        response = robots()
        self.assertEqual(response.media_type, "text/plain")
        self.assertEqual(response.headers["cache-control"], "public, max-age=3600")

        body = Path(response.path).read_text(encoding="utf-8")
        self.assertIn("User-agent: *", body)
        self.assertIn("Allow: /", body)
        self.assertIn(f"Sitemap: {SITEMAP_URL}", body)