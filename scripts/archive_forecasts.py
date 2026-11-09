#!/usr/bin/env python3
"""Hourly JMA typhoon forecast snapshot collector for Typhoon Archive.

Snapshots are saved only when the specifications JSON changes for a storm.
The JMA Bosai JSON endpoints are website data, not a guaranteed stable API.
"""
from __future__ import annotations
import hashlib, json, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.jma.go.jp/bosai/typhoon/data"
ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data" / "archive"
INDEX_PATH = ARCHIVE / "index.json"

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent":"TyphoonArchive/1.0 personal research"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))

def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",",":"))

def main():
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).astimezone()
    stamp = now.strftime("%Y%m%dT%H%M%S%z")
    try:
        targets = fetch_json(f"{BASE}/targetTc.json")
    except Exception as e:
        print(f"JMA target list fetch failed: {e}")
        raise

    index = {"schemaVersion":1,"updatedAt":now.isoformat(),"storms":{}}
    if INDEX_PATH.exists():
        try:
            previous=json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            if isinstance(previous,dict) and isinstance(previous.get("storms"),dict):
                index=previous
        except Exception:
            pass
    index["schemaVersion"]=1
    index["updatedAt"]=now.isoformat()

    active_codes=set()
    for tc in targets if isinstance(targets,list) else []:
        code=tc.get("tropicalCyclone")
        if not code: continue
        active_codes.add(code)
        try:
            specs=fetch_json(f"{BASE}/{code}/specifications.json")
        except Exception as e:
            print(f"Skip {code}: {e}")
            continue
        specs_issue = None
        if isinstance(specs, list) and specs:
            specs_issue = (specs[0].get("issue") or {}).get("JST") or (specs[0].get("issue") or {}).get("UTC")
        source_issue = tc.get("issue") or specs_issue
        digest=hashlib.sha256(canonical({"issue":source_issue,"specifications":specs}).encode("utf-8")).hexdigest()
        storm=index["storms"].setdefault(code,{"typhoonNumber":tc.get("typhoonNumber"),"name":tc.get("name"),"snapshots":[]})
        storm["typhoonNumber"]=tc.get("typhoonNumber",storm.get("typhoonNumber"))
        storm["name"]=tc.get("name",storm.get("name"))
        previous=storm["snapshots"][-1] if storm.get("snapshots") else None
        if previous and previous.get("sha256")==digest:
            previous["lastSeenAt"]=now.isoformat()
            previous["checks"] = int(previous.get("checks",1))+1
            print(f"{code}: unchanged; no duplicate snapshot")
            continue
        safe_code="".join(c for c in code if c.isalnum() or c in "-_")
        rel=f"{safe_code}/{stamp}.json"
        dest=ARCHIVE/rel
        dest.parent.mkdir(parents=True,exist_ok=True)
        payload={
            "schemaVersion":1,
            "capturedAt":now.isoformat(),
            "sourceIssueTime":source_issue,
            "typhoonCode":code,
            "typhoonNumber":tc.get("typhoonNumber"),
            "name":tc.get("name"),
            "sha256":digest,
            "specifications":specs
        }
        dest.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
        storm["snapshots"].append({
            "capturedAt":now.isoformat(),
            "sourceIssueTime":source_issue,
            "file":rel,
            "sha256":digest,
            "checks":1,
            "lastSeenAt":now.isoformat()
        })
        print(f"{code}: archived {rel}")
    # Keep archive index ordered, but do not remove historical storm records.
    for code,storm in index["storms"].items():
        storm["snapshots"]=sorted(storm.get("snapshots",[]),key=lambda x:x.get("capturedAt",""))
    INDEX_PATH.write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Archive index updated. Active storms: {len(active_codes)}")

if __name__=="__main__":
    main()
