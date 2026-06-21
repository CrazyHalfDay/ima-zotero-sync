#!/usr/bin/env python3
"""根据 manifest.json 生成 Zotero 的 update.json。

用法:
    GITHUB_REPOSITORY=owner/repo python3 scripts/gen-update-json.py [输出路径]

输出路径默认 build/update.json。
update.json 里的 update_link 指向对应版本 Release 里的 .xpi。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
    manifest = json.load(f)

repo = os.environ.get("GITHUB_REPOSITORY", "CrazyHalfDay/ima-zotero-sync")
version = manifest["version"]
zot = manifest["applications"]["zotero"]
addon_id = zot["id"]
xpi_name = os.environ.get("XPI_NAME", "ima-zotero-sync.xpi")

update_link = (
    f"https://github.com/{repo}/releases/download/v{version}/{xpi_name}"
)

update = {
    "addons": {
        addon_id: {
            "updates": [
                {
                    "version": version,
                    "update_link": update_link,
                    "applications": {
                        "zotero": {
                            "strict_min_version": zot.get(
                                "strict_min_version", "6.999"
                            ),
                        }
                    },
                }
            ]
        }
    }
}

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build", "update.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    json.dump(update, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Wrote {out} (version {version} -> {update_link})")
