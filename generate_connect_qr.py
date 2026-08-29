"""Generate permanent print-quality QR artwork for the TaskCore connect page."""
from pathlib import Path

import qrcode


DESTINATION = "https://taskcorepros.com/connect/"
PRINT_DPI = 600
PRINT_INCHES = 1.5
OUTPUT_DIR = Path(__file__).resolve().parent / "assets" / "qr"


def main() -> None:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=1,
        border=4,
    )
    qr.add_data(DESTINATION)
    qr.make(fit=True)

    matrix = qr.get_matrix()
    module_count = len(matrix)
    box_size = max(1, round((PRINT_DPI * PRINT_INCHES) / module_count))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUTPUT_DIR / "taskcore-connect-qr.png"
    svg_path = OUTPUT_DIR / "taskcore-connect-qr.svg"

    qr.box_size = box_size
    qr.make_image(fill_color="#000000", back_color="#FFFFFF").save(
        png_path,
        dpi=(PRINT_DPI, PRINT_DPI),
    )

    geometry = []
    for y, row in enumerate(matrix):
        for x, dark in enumerate(row):
            if dark:
                geometry.append(f"M{x} {y}h1v1h-1z")

    svg = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        f"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{PRINT_INCHES}in\" "
        f"height=\"{PRINT_INCHES}in\" viewBox=\"0 0 {module_count} {module_count}\" "
        "shape-rendering=\"crispEdges\">\n"
        f"  <rect width=\"{module_count}\" height=\"{module_count}\" fill=\"#fff\"/>\n"
        f"  <path d=\"{' '.join(geometry)}\" fill=\"#000\"/>\n"
        "</svg>\n"
    )
    svg_path.write_text(svg, encoding="utf-8", newline="\n")

    pixels = module_count * box_size
    print(f"Destination: {DESTINATION}")
    print(f"Error correction: H")
    print(f"Quiet zone: 4 modules")
    print(f"PNG: {png_path} ({pixels} x {pixels}px at {PRINT_DPI} DPI)")
    print(f"SVG: {svg_path} (true vector geometry, {PRINT_INCHES} x {PRINT_INCHES}in)")


if __name__ == "__main__":
    main()
