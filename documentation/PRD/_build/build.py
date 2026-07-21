#!/usr/bin/env python3
"""Build every MCP server PRD into documentation/PRD/*.docx.

Usage:  python3 documentation/PRD/_build/build.py
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent
OUT_DIR = BUILD_DIR.parent
TEMPLATE = BUILD_DIR / "template.docx"

sys.path.insert(0, str(BUILD_DIR))

from prd_lib import PRDBuildError, render  # noqa: E402

DOCS = [
    ("index", "00-MCP-Servers-PRD-Index.docx"),
    ("brevo", "01-Brevo-MCP-PRD.docx"),
    ("cpanel", "02-cPanel-MCP-PRD.docx"),
    ("ga", "03-Google-Analytics-MCP-PRD.docx"),
    ("gsc", "04-Google-Search-Console-MCP-PRD.docx"),
    ("meta", "05-Meta-Ads-MCP-PRD.docx"),
    ("wordpress", "06-WordPress-MCP-PRD.docx"),
]


def main() -> int:
    if not TEMPLATE.exists():
        print(f"error: template not found at {TEMPLATE}", file=sys.stderr)
        return 1

    failures = 0
    for module_name, filename in DOCS:
        try:
            module = importlib.import_module(f"content.{module_name}")
            path = render(module.CONTENT, TEMPLATE, OUT_DIR / filename)
        except (ImportError, AttributeError, PRDBuildError, KeyError) as exc:
            print(f"FAIL  {filename}: {type(exc).__name__}: {exc}", file=sys.stderr)
            failures += 1
            continue
        print(f"ok    {path.name}  ({path.stat().st_size:,} bytes)")

    if failures:
        print(f"\n{failures} document(s) failed to build", file=sys.stderr)
        return 1
    print(f"\nBuilt {len(DOCS)} documents into {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
