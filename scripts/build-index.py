#!/usr/bin/env python3
"""Build the full-text search index for the RTI response PDFs.

Run offline with `just index`; the output is committed. CI only runs `zola
build`, so it must never need the network or an OCR toolchain.

Pipeline, per PDF listed in the `response` column of data/tracker.csv:

  download (cached)  ->  pdftotext per page
                     ->  page looks blank? render + tesseract that page
                     ->  redact emails/phones  ->  one JSON record per page

Per-page records are what let a search result deep-link to `<pdf>#page=N`.
The OCR fallback is per page, not per document, because some replies mix a
digital covering letter with scanned annexures.

Requires: pdftotext, pdfinfo, pdftoppm (poppler), tesseract. See shell.nix.
"""

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRACKER = ROOT / "data" / "tracker.csv"
SCHEMA = ROOT / "data" / "tracker.schema.json"
OUT = ROOT / "static" / "rti-index.json"
CACHE = ROOT / ".cache" / "rti"
TEXT_CACHE = ROOT / ".cache" / "text"

# Bump when the extraction rules change, so stale .cache/text entries are
# rebuilt instead of silently reused.
EXTRACT_VERSION = 2

# A page yielding less than this many non-space characters is treated as a
# scan and sent to OCR. Real text pages in this corpus run 1300-1700.
MIN_CHARS = 100
OCR_DPI = 300
# A raster image covering more than this share of the page means the page is a
# scan, whatever text layer it may also carry. See scanned_pages().
SCAN_COVERAGE = 0.5
# Guard rail: past this, the browser download starts to hurt on mobile and we
# should shard the index or move to a chunked engine. See the plan.
MAX_BYTES = 3_000_000

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

# Phone matching has to be conservative, and the reason is specific: these are
# financial documents, and OCR renders Indian digit grouping with spaces rather
# than commas, so a balance sheet line reads "99 76 79 309". A permissive
# "10-or-more digits with optional separators" pattern eats those — i.e. it
# redacts the software spending this project exists to publish. So a number
# only counts as a phone when it is a *contiguous* run in a phone-shaped form,
# or carries an explicit label. Money survives; contact details do not.
PHONE_LABEL_RE = re.compile(
    r"(?:\b(?:ph|phone|mob(?:ile)?|tel(?:ephone)?|contact|fax)\b\s*[.:\-]?\s*)"
    r"\+?\d[\d\s\-()]{7,}\d",
    re.I,
)
PHONE_RE = re.compile(
    r"""(?<![\d/,.\-])(?:
          (?:\+?91[\s\-]?)?[6-9]\d{9}     # 10-digit mobile, contiguous
        | \+91[\s\-]?\d{2,4}[\s\-]?\d{6,8}  # +91 with an STD split
        | 0\d{2,4}[\s\-]?\d{6,8}           # STD landline, leading 0
        )(?![\d/,.\-])""",
    re.X,
)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, check=False, **kw)


def ocr_langs():
    """`eng+hin` when Hindi data is installed, else plain `eng`."""
    out = run(["tesseract", "--list-langs"]).stdout
    return "eng+hin" if re.search(r"^hin$", out, re.M) else "eng"


def refs_from_tracker():
    """Every response reference, in tracker order.

    Mirrors templates/macros/table.html: split on commas, and append `.pdf`
    only when the final path segment has no extension. Both forms exist in the
    CSV today (`response_NITDL_...` and `IIMs/response_IIMRP_....pdf`).
    """
    rows = []
    with TRACKER.open(newline="") as fh:
        for row in csv.DictReader(fh):
            cell = (row.get("response") or "").strip()
            if not cell or cell == "—":
                continue
            for raw in cell.split(","):
                name = raw.strip()
                if not name:
                    continue
                if not re.search(r"\.[A-Za-z0-9]+$", name.split("/")[-1]):
                    name += ".pdf"
                rows.append((name, row))
    return rows


def base_url():
    """Read the host prefix from the schema so there is one source of truth."""
    schema = json.loads(SCHEMA.read_text())
    return schema["properties"]["response"]["x-display"]["base"]


def fetch(name, url):
    dest = CACHE / name
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    res = run(["curl", "-sfL", "-m", "300", "-o", str(dest), url])
    if res.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"download failed: {url}")
    return dest


def page_count(pdf):
    out = run(["pdfinfo", str(pdf)]).stdout
    m = re.search(r"^Pages:\s+(\d+)", out, re.M)
    return int(m.group(1)) if m else 0


def page_size(pdf):
    out = run(["pdfinfo", str(pdf)]).stdout
    m = re.search(r"^Page size:\s+([\d.]+) x ([\d.]+)", out, re.M)
    return (float(m.group(1)), float(m.group(2))) if m else (595.0, 842.0)


def scanned_pages(pdf):
    """Pages that are photographs of paper, whatever text layer they carry.

    This matters because several institutes replied from an office MFP that
    runs its own OCR and bakes the result into the PDF — one Canon produced
    "NATIONAL INSTITUTE OF TECHNOLOGY DE'LID" and "Turn1tm" for Turnitin.
    Trusting a text layer merely because it exists means inheriting an unknown
    scanner's OCR, typically done at 150 dpi. Our own tesseract pass at 300 dpi
    reads those same pages correctly, so on scanned pages we ignore the
    embedded text and OCR the image ourselves.

    A page counts as scanned when one raster image covers most of it, which
    distinguishes a full-page scan from a born-digital page carrying a logo.
    """
    pw, ph = page_size(pdf)
    pages = set()
    for line in run(["pdfimages", "-list", str(pdf)]).stdout.splitlines()[2:]:
        f = line.split()
        if len(f) < 14 or f[2] != "image":
            continue
        try:
            page, w, h = int(f[0]), int(f[3]), int(f[4])
            xppi, yppi = float(f[12]), float(f[13])
        except ValueError:
            continue
        if xppi <= 0 or yppi <= 0:
            continue
        if (w / xppi * 72) * (h / yppi * 72) / (pw * ph) > SCAN_COVERAGE:
            pages.add(page)
    return pages


def native_text(pdf, page):
    return run(
        ["pdftotext", "-layout", "-q", "-f", str(page), "-l", str(page), str(pdf), "-"]
    ).stdout


def ocr_text(pdf, page, langs):
    """Render one page and OCR it. Used only when the text layer is empty."""
    with tempfile.TemporaryDirectory() as tmp:
        stem = os.path.join(tmp, "pg")
        run(["pdftoppm", "-r", str(OCR_DPI), "-png", "-f", str(page), "-l", str(page),
             str(pdf), stem])
        pngs = sorted(Path(tmp).glob("pg*.png"))
        if not pngs:
            return ""
        return run(["tesseract", str(pngs[0]), "-", "-l", langs]).stdout


def clean(text):
    """Redact contact details, then collapse whitespace.

    The PDFs themselves are untouched and still linked; this only keeps
    emails and phone numbers out of the *searchable* text, so the index
    cannot be used to look people up by contact detail.
    """
    text = EMAIL_RE.sub("[email]", text)
    text = PHONE_LABEL_RE.sub("[phone]", text)
    text = PHONE_RE.sub("[phone]", text)
    return re.sub(r"\s+", " ", text).strip()


def raw_pages(name, base, langs, quiet):
    """Per-page text straight out of the PDF, cached before redaction.

    OCR costs ~3.4 s/page and ~40% of this corpus needs it, so caching the raw
    text means changing the redaction rules or the record shape is a
    second-long rebuild instead of a six-minute one. Cached under .cache/
    (gitignored) and unredacted — the redaction happens on the way into the
    committed index, which is the artefact that actually ships.
    """
    cached = TEXT_CACHE / (name.replace("/", "__") + ".json")
    if cached.exists():
        data = json.loads(cached.read_text())
        if data.get("v") == EXTRACT_VERSION:
            return data

    pdf = fetch(name, base + name)
    total = page_count(pdf)
    scans = scanned_pages(pdf)
    pages, ocr_pages = [], 0
    for page in range(1, total + 1):
        text = "" if page in scans else native_text(pdf, page)
        if len(re.sub(r"\s", "", text)) < MIN_CHARS:
            text = ocr_text(pdf, page, langs)
            ocr_pages += 1
        pages.append(text)

    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(
        json.dumps({"v": EXTRACT_VERSION, "pages": pages, "ocr": ocr_pages}, ensure_ascii=False)
    )
    if not quiet:
        note = f" ({ocr_pages} OCR'd)" if ocr_pages else ""
        print(f"  {name}: {total} pages extracted{note}", flush=True)
    return {"pages": pages, "ocr": ocr_pages}


def extract(name, row, base, langs, quiet):
    data = raw_pages(name, base, langs, quiet)
    total = len(data["pages"])
    records = []
    for page, text in enumerate(data["pages"], start=1):
        text = clean(text)
        if not text:
            continue
        records.append({
            "ref": name,
            "url": base + name,
            "institute": row["institute"],
            "type": row["type"],
            "city": row["city"],
            "page": page,
            "pages": total,
            "text": text,
        })
    return records


def build(jobs, quiet):
    base, langs = base_url(), ocr_langs()
    rows = refs_from_tracker()
    if not quiet:
        print(f"{len(rows)} documents, OCR languages: {langs}", flush=True)

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        results = list(pool.map(
            lambda r: extract(r[0], r[1], base, langs, quiet), rows
        ))

    records = [r for group in results for r in group]
    for i, rec in enumerate(records):
        rec["id"] = i

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")))
    size = OUT.stat().st_size
    print(f"wrote {OUT.relative_to(ROOT)}: {len(records)} pages, {size / 1e6:.2f} MB")
    return check(quiet=True)


def check(quiet=False):
    """Assert the committed index is present, fresh, and not too large."""
    problems = []
    if not OUT.exists():
        print(f"error: {OUT.relative_to(ROOT)} missing — run `just index`", file=sys.stderr)
        return 1

    records = json.loads(OUT.read_text())
    indexed = {r["ref"] for r in records}
    expected = {name for name, _ in refs_from_tracker()}

    missing = sorted(expected - indexed)
    if missing:
        problems.append(
            "not in the index (run `just index`): " + ", ".join(missing)
        )
    stale = sorted(indexed - expected)
    if stale:
        problems.append(
            "in the index but no longer in tracker.csv: " + ", ".join(stale)
        )

    size = OUT.stat().st_size
    if size > MAX_BYTES:
        problems.append(
            f"index is {size / 1e6:.2f} MB, over the {MAX_BYTES / 1e6:.0f} MB budget. "
            "Shard it by institute type or move to a chunked engine before growing further."
        )

    for p in problems:
        print(f"error: {p}", file=sys.stderr)
    if not problems and not quiet:
        print(f"index ok: {len(records)} pages, {len(indexed)} documents, {size / 1e6:.2f} MB")
    return 1 if problems else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="validate the committed index instead of rebuilding it")
    ap.add_argument("-j", "--jobs", type=int, default=4, help="parallel documents")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()
    return check() if args.check else build(args.jobs, args.quiet)


if __name__ == "__main__":
    sys.exit(main())
