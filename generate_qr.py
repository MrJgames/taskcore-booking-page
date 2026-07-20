"""Generate the TaskCore website QR code from config.js."""
from pathlib import Path
import re
import sys

try:
    import qrcode
except ImportError:
    sys.exit("QR library missing. Run: py -m pip install qrcode[pil]")

ROOT = Path(__file__).resolve().parent
CONFIG = (ROOT / "config.js").read_text(encoding="utf-8")
match = re.search(r'const\s+TASKCORE_WEBSITE_URL\s*=\s*["\']([^"\']*)["\']\s*;', CONFIG)

if not match or not match.group(1).strip():
    sys.exit("Add the published website address to TASKCORE_WEBSITE_URL in config.js, then run this script again.")

url = match.group(1).strip()
if not re.match(r"^https?://", url, re.IGNORECASE):
    sys.exit("TASKCORE_WEBSITE_URL must begin with https:// or http://")

output = ROOT / "assets" / "taskcore-booking-qr.png"
qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=4)
qr.add_data(url)
qr.make(fit=True)
qr.make_image(fill_color="#000000", back_color="#FFFFFF").save(output)
print(f"Created: {output}")
print(f"QR destination: {url}")
