"""Generate print-quality TaskCore website QR assets from config.js."""
from pathlib import Path
import re
import sys

try:
    import qrcode
    import qrcode.image.svg
except ImportError:
    sys.exit('QR library missing. Run: py -m pip install "qrcode[pil]"')

ROOT = Path(__file__).resolve().parent
CONFIG = (ROOT / "config.js").read_text(encoding="utf-8")
match = re.search(r'const\s+TASKCORE_WEBSITE_URL\s*=\s*["\']([^"\']*)["\']\s*;', CONFIG)

if not match or not match.group(1).strip():
    sys.exit("Add the published website address to TASKCORE_WEBSITE_URL in config.js, then run this script again.")

url = match.group(1).strip()
if not re.match(r"^https?://", url, re.IGNORECASE):
    sys.exit("TASKCORE_WEBSITE_URL must begin with https:// or http://")

output_dir = ROOT / "assets" / "qr"
output_dir.mkdir(parents=True, exist_ok=True)
png_output = output_dir / "taskcore-website-qr.png"
svg_output = output_dir / "taskcore-website-qr.svg"

qr = qrcode.QRCode(
    version=None,
    error_correction=qrcode.constants.ERROR_CORRECT_Q,
    box_size=24,
    border=4,
)
qr.add_data(url)
qr.make(fit=True)
qr.make_image(fill_color="#000000", back_color="#FFFFFF").save(png_output, dpi=(600, 600))

svg_image = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
svg_image.save(svg_output)

print(f"Created PNG: {png_output}")
print(f"Created SVG: {svg_output}")
print(f"QR destination: {url}")
