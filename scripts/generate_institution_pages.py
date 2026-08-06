#!/usr/bin/env python3
"""Seed data/institutes.csv and generate one content page per institute.

Run by hand whenever a new institute shows up in data/tracker.csv. Safe to
re-run: existing institutes.csv rows (and any hand-filled state/website) are
left alone, and existing content/data/<slug>.md files are never overwritten.

  python3 scripts/generate_institution_pages.py
"""

import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRACKER = ROOT / "data" / "tracker.csv"
INSTITUTES = ROOT / "data" / "institutes.csv"
CONTENT_DIR = ROOT / "content" / "data"

FIELDS = ["slug", "name", "type", "city", "state", "website"]


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower())
    return s.strip("-")


def read_rows(path):
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_rows(path, rows):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in FIELDS})


def seed_institutes():
    existing = read_rows(INSTITUTES)
    by_name = {row["name"]: row for row in existing}

    added = 0
    for row in read_rows(TRACKER):
        name = row["institute"].strip()
        if name in by_name:
            continue
        by_name[name] = {
            "slug": slugify(name),
            "name": name,
            "type": row["type"].strip(),
            "city": row["city"].strip(),
            "state": "",
            "website": "",
        }
        added += 1

    # Sorted by (type, name) rather than tracker.csv's arrival order — this
    # is what the per-type hub pages (institution_type.html) list in, so
    # sorting the source once means every consumer gets it for free.
    ordered = sorted(by_name.values(), key=lambda r: (r["type"], r["name"]))

    write_rows(INSTITUTES, ordered)
    print(f"data/institutes.csv: {len(ordered)} institutes ({added} new)")
    return ordered


def generate_pages(institutes):
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    created = 0
    for row in institutes:
        path = CONTENT_DIR / f"{row['slug']}.md"
        if path.exists():
            continue
        path.write_text(
            f'+++\ntitle = "{row["name"]}"\n+++\n',
            encoding="utf-8",
        )
        created += 1
    print(f"content/data/: {created} new institute pages")


if __name__ == "__main__":
    institutes = seed_institutes()
    generate_pages(institutes)
