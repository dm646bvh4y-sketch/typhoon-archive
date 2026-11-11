#!/usr/bin/env python3
"""Archive timestamped JMA typhoon analysis (observed) positions.

The JMA specifications JSON is sampled for active storms. Only the analysis
record (advancedHours == 0 / part == Analysis) is stored; forecast points are
not mixed into this archive. Existing forecast snapshots are also scanned to
backfill analysis points already captured by the forecast collector.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE = "https://www.jma.go.jp/bosai/typhoon/data"
ROOT = Path(__file__).resolve().parents[1]
FORECAST_ARCHIVE = ROOT / "data" / "archive"
OUT = ROOT / "data" / "track-archive"
INDEX = OUT / "index.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_json(url: str) -> Any:
    req = urllib.request.Request(
        url, headers={"User-Agent": "TyphoonArchive/1.0 personal research"}
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def is_analysis(item: dict) -> bool:
    part = item.get("part")
    part_text = " ".join(str(v) for v in part.values()) if isinstance(part, dict) else str(part or "")
    return item.get("advancedHours") == 0 or "Analysis" in part_text or "実況" in part_text


def numeric(value: Any) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_records(specifications: Any, code: str, typhoon_number: Any = None,
                    name: Any = None, source_issue_time: str | None = None,
                    source_file: str | None = None, captured_at: str | None = None) -> list[dict]:
    if not isinstance(specifications, list):
        return []
    records = []
    for item in specifications:
        if not isinstance(item, dict) or not is_analysis(item):
            continue
        valid = item.get("validtime") or {}
        observed_at = valid.get("JST") or valid.get("UTC")
        position = item.get("position") or {}
        deg = position.get("deg") or []
        if not observed_at or len(deg) < 2:
            continue
        lat, lon = numeric(deg[0]), numeric(deg[1])
        if lat is None or lon is None:
            continue
        wind = item.get("maximumWind") or {}
        sustained = wind.get("sustained") or {}
        gust = wind.get("gust") or {}
        records.append({
            "observationDateTime": observed_at,
            "latitude": lat,
            "longitude": lon,
            "centralPressureHpa": numeric(item.get("pressure")),
            "maximumWindMs": numeric(sustained.get("m/s")),
            "maximumGustMs": numeric(gust.get("m/s")),
            "course": item.get("course"),
            "speedKmh": numeric((item.get("speed") or {}).get("km/h")),
            "typhoonCode": code,
            "typhoonNumber": typhoon_number,
            "name": name,
            "sourceIssueTime": source_issue_time,
            "sourceFile": source_file,
            "firstCapturedAt": captured_at or now_iso(),
            "lastCapturedAt": captured_at or now_iso(),
        })
    return records


def merge_record(existing: dict | None, incoming: dict) -> dict:
    if existing is None:
        return incoming
    # Preserve a revision trail if JMA later revises the same observation time.
    comparable = ("latitude", "longitude", "centralPressureHpa", "maximumWindMs",
                  "maximumGustMs", "course", "speedKmh")
    old_values = {key: existing.get(key) for key in comparable}
    new_values = {key: incoming.get(key) for key in comparable}
    merged = dict(existing)
    if old_values != new_values:
        revisions = list(merged.get("revisions", []))
        revisions.append({
            "recordedAt": incoming.get("lastCapturedAt"),
            "previous": old_values,
            "updated": new_values,
            "sourceIssueTime": incoming.get("sourceIssueTime"),
        })
        merged["revisions"] = revisions
        for key in comparable:
            merged[key] = incoming.get(key)
    merged["lastCapturedAt"] = incoming.get("lastCapturedAt") or merged.get("lastCapturedAt")
    merged["sourceIssueTime"] = incoming.get("sourceIssueTime") or merged.get("sourceIssueTime")
    merged["sourceFile"] = incoming.get("sourceFile") or merged.get("sourceFile")
    return merged


def load_storm(path: Path, code: str, meta: dict) -> dict:
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(old, dict) and isinstance(old.get("records"), list):
                old.setdefault("schemaVersion", 1)
                old.setdefault("typhoonCode", code)
                old.setdefault("records", [])
                return old
        except (OSError, json.JSONDecodeError):
            print(f"Warning: could not read {path}; rebuilding from available sources")
    return {
        "schemaVersion": 1, "typhoonCode": code,
        "typhoonNumber": meta.get("typhoonNumber"), "name": meta.get("name"),
        "firstArchivedAt": now_iso(), "records": []
    }


def merge_into_storm(storm: dict, incoming_records: list[dict]) -> int:
    by_time = {r.get("observationDateTime"): r for r in storm.get("records", [])
               if r.get("observationDateTime")}
    added = 0
    for incoming in incoming_records:
        key = incoming["observationDateTime"]
        if key not in by_time:
            by_time[key] = incoming
            added += 1
        else:
            by_time[key] = merge_record(by_time[key], incoming)
    storm["records"] = sorted(by_time.values(), key=lambda r: r.get("observationDateTime", ""))
    return added


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = {"schemaVersion": 1, "updatedAt": None, "storms": {}}
    if INDEX.exists():
        try:
            old = json.loads(INDEX.read_text(encoding="utf-8"))
            if isinstance(old, dict) and isinstance(old.get("storms"), dict):
                index = old
        except (OSError, json.JSONDecodeError):
            print("Warning: invalid track archive index; rebuilding index")

    storms: dict[str, dict] = {}
    # Backfill analysis records contained in forecast snapshots already stored.
    if FORECAST_ARCHIVE.exists():
        for file in FORECAST_ARCHIVE.glob("*/*.json"):
            try:
                payload = json.loads(file.read_text(encoding="utf-8"))
                code = payload.get("typhoonCode") or file.parent.name
                if not code:
                    continue
                meta = {"typhoonNumber": payload.get("typhoonNumber"), "name": payload.get("name")}
                storm = storms.setdefault(code, load_storm(OUT / f"{code}.json", code, meta))
                if meta.get("typhoonNumber") is not None:
                    storm["typhoonNumber"] = meta["typhoonNumber"]
                if meta.get("name"):
                    storm["name"] = meta["name"]
                records = extract_records(
                    payload.get("specifications"), code, meta["typhoonNumber"], meta["name"],
                    payload.get("sourceIssueTime"), str(file.relative_to(ROOT)),
                    payload.get("capturedAt")
                )
                merge_into_storm(storm, records)
            except Exception as exc:
                print(f"Skip backfill {file}: {exc}")

    targets = fetch_json(f"{BASE}/targetTc.json")
    active_codes = []
    for tc in targets if isinstance(targets, list) else []:
        code = tc.get("tropicalCyclone")
        if not code:
            continue
        active_codes.append(code)
        try:
            specs = fetch_json(f"{BASE}/{code}/specifications.json")
        except Exception as exc:
            print(f"Skip active storm {code}: {exc}")
            continue
        issue = None
        if isinstance(specs, list) and specs:
            issue = (specs[0].get("issue") or {}).get("JST") or (specs[0].get("issue") or {}).get("UTC")
        meta = {"typhoonNumber": tc.get("typhoonNumber"), "name": tc.get("name")}
        storm = storms.setdefault(code, load_storm(OUT / f"{code}.json", code, meta))
        storm["typhoonNumber"] = meta["typhoonNumber"] or storm.get("typhoonNumber")
        storm["name"] = meta["name"] or storm.get("name")
        records = extract_records(specs, code, meta["typhoonNumber"], meta["name"], issue,
                                  f"live:{code}/specifications.json", now_iso())
        added = merge_into_storm(storm, records)
        print(f"{code}: {added} new observation point(s), {len(storm['records'])} total")

    # Retain previously archived storms even after they disappear from targetTc.
    for path in OUT.glob("*.json"):
        if path.name == "index.json":
            continue
        code = path.stem
        if code not in storms:
            try:
                storms[code] = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                print(f"Warning: could not retain existing archive {path}")

    new_index = {"schemaVersion": 1, "updatedAt": now_iso(), "storms": {}}
    for code, storm in sorted(storms.items()):
        safe_code = "".join(c for c in code if c.isalnum() or c in "-_")
        if not safe_code:
            continue
        storm["records"] = sorted(storm.get("records", []),
                                  key=lambda r: r.get("observationDateTime", ""))
        (OUT / f"{safe_code}.json").write_text(
            json.dumps(storm, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        new_index["storms"][code] = {
            "typhoonNumber": storm.get("typhoonNumber"),
            "name": storm.get("name"),
            "file": f"{safe_code}.json",
            "recordCount": len(storm["records"]),
            "firstObservation": storm["records"][0]["observationDateTime"] if storm["records"] else None,
            "lastObservation": storm["records"][-1]["observationDateTime"] if storm["records"] else None,
        }
    INDEX.write_text(json.dumps(new_index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Track archive updated. Active storms: {len(active_codes)}; archived storms: {len(storms)}")


if __name__ == "__main__":
    main()
