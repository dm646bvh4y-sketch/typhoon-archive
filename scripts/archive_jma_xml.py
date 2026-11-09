#!/usr/bin/env python3
"""Archive only first-issue JMA typhoon genesis bulletins (VPZJ51).

Polls the public JMA XML PULL Atom feeds, fetches candidate XML entries,
keeps only typhoon-related VPZJ51 reports whose issue number is 1, and extracts
an explicitly stated genesis date/time. Never substitutes report publication
 time for genesis time. The PULL feed is short-retention; frequent polling is
recommended, and completeness cannot be guaranteed.
"""
from __future__ import annotations

import hashlib
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "xml-archive"
INDEX = OUT / "index.json"
FEEDS = {
    "extra": "https://www.data.jma.go.jp/developer/xml/feed/extra.xml",
    "extra_l": "https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml",
    "regular": "https://www.data.jma.go.jp/developer/xml/feed/regular.xml",
    "regular_l": "https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml",
}
ATOM = "http://www.w3.org/2005/Atom"
NS = {"a": ATOM}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "TyphoonArchive/1.0 (personal project; JMA XML PULL)"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def atom_text(element: ET.Element, path: str) -> str:
    node = element.find(path, NS)
    return (node.text or "").strip() if node is not None else ""


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def xml_text(root: ET.Element) -> str:
    return "\n".join((node.text or "").strip() for node in root.iter() if (node.text or "").strip())


def first_tag_text(root: ET.Element, name: str) -> str:
    for node in root.iter():
        if local_name(node.tag) == name and (node.text or "").strip():
            return (node.text or "").strip()
    return ""


def serial_number(serial_text: str, combined_text: str) -> int | None:
    # JMA may represent serial as 1/01 or Japanese 第1号 in a title.
    m = re.search(r"(?:第\s*)?(\d{1,3})\s*(?:号)?", serial_text)
    if m:
        return int(m.group(1))
    matches = re.findall(r"第\s*(\d{1,3})\s*号", combined_text)
    # Titles often contain both 台風第32号 and 第1号; the final number is
    # normally the bulletin serial, so prefer the last explicit 第N号 token.
    return int(matches[-1]) if matches else None


def is_typhoon_vpzj51(title: str, summary: str, source_url: str, entry_id: str, root: ET.Element) -> bool:
    combined = " ".join([title, summary, source_url, entry_id, xml_text(root)])
    # Product name in Head/Title or entry text, and an explicit typhoon reference.
    has_vpzj = "VPZJ51" in combined or "全般気象解説情報" in (title + " " + summary + " " + xml_text(root))
    has_typhoon = bool(re.search(r"台風第?\s*\d{1,2}号|台風", combined))
    return has_vpzj and has_typhoon


def parse_datetime(value: str) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def extract_typhoon_number(text: str) -> int | None:
    match = re.search(r"台風第?\s*(\d{1,2})号", text)
    return int(match.group(1)) if match else None


def extract_genesis_datetime(text: str, issue_datetime: datetime | None) -> str | None:
    """Extract explicitly written Japanese day/hour from genesis sentence.

    Example: 7日12時、...熱帯低気圧が台風第32号になりました。
    The month/year are inferred from the bulletin issue date (nearest month).
    """
    patterns = [
        r"(?P<day>\d{1,2})日\s*(?P<hour>\d{1,2})時(?:\s*(?P<minute>\d{1,2})分)?[^。\n]{0,220}?(?:台風第?\s*\d{1,2}号\s*になりました|台風第?\s*\d{1,2}号\s*が発生しました|台風に発達しました|台風となりました)",
        r"(?P<day>\d{1,2})日\s*(?P<hour>\d{1,2})時(?:\s*(?P<minute>\d{1,2})分)?[^。\n]{0,220}?(?:台風が発生しました|台風が発生)",
    ]
    match = next((m for pattern in patterns for m in re.finditer(pattern, text)), None)
    if not match or not issue_datetime:
        return None
    day, hour = int(match.group("day")), int(match.group("hour"))
    minute = int(match.group("minute") or 0)
    if day < 1 or day > 31 or hour > 23 or minute > 59:
        return None
    issue_jst = issue_datetime.astimezone(timezone(timedelta(hours=9)))
    # Try adjacent months, then choose the closest valid timestamp to issuance.
    candidates = []
    for offset in (-1, 0, 1):
        year, month = issue_jst.year, issue_jst.month + offset
        if month < 1:
            year -= 1; month += 12
        elif month > 12:
            year += 1; month -= 12
        try:
            candidates.append(datetime(year, month, day, hour, minute, tzinfo=issue_jst.tzinfo))
        except ValueError:
            continue
    if not candidates:
        return None
    chosen = min(candidates, key=lambda dt: abs((dt - issue_jst).total_seconds()))
    # Genesis event should not be an implausibly distant date relative to the report.
    if abs((chosen - issue_jst).total_seconds()) > 20 * 86400:
        return None
    return chosen.isoformat(timespec="minutes")


def extract_xml_fields(xml_bytes: bytes) -> dict:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return {"parseError": "XML parse error"}
    wanted = {"Title", "DateTime", "TargetDateTime", "ReportDateTime", "InfoKind", "InfoType",
              "InfoKindVersion", "Serial", "PublishingOffice", "Headline", "Text", "EventID", "InfoCode", "Status"}
    fields: dict[str, list[str]] = {}
    for element in root.iter():
        tag = local_name(element.tag)
        value = (element.text or "").strip()
        if value and tag in wanted:
            fields.setdefault(tag, []).append(value[:4000])
    return fields


def load_index() -> dict:
    if INDEX.exists():
        try:
            old = json.loads(INDEX.read_text(encoding="utf-8"))
            if isinstance(old, dict) and isinstance(old.get("entries"), list):
                old.setdefault("schemaVersion", 2)
                return old
        except (OSError, json.JSONDecodeError):
            print("Existing XML index is invalid; rebuilding index from scratch.")
    return {"schemaVersion": 2, "updatedAt": None, "entries": []}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = load_index()
    known = {e.get("id") for e in index.get("entries", []) if e.get("id")}
    known_events = {e.get("eventKey") for e in index.get("entries", []) if e.get("eventKey")}
    added = skipped_non_first = skipped_not_genesis = 0
    feed_errors = 0

    for feed_name, feed_url in FEEDS.items():
        try:
            feed = ET.fromstring(fetch(feed_url))
        except Exception as error:
            feed_errors += 1
            print(f"Feed {feed_name} failed: {error}")
            continue

        for entry in feed.findall("a:entry", NS):
            title = atom_text(entry, "a:title")
            summary = atom_text(entry, "a:summary")
            link_nodes = entry.findall("a:link", NS)
            preferred_links = [n.attrib.get("href", "") for n in link_nodes
                               if n.attrib.get("href") and (n.attrib.get("type", "").endswith("xml")
                               or n.attrib.get("rel", "alternate") == "alternate")]
            source_url = next((url for url in preferred_links if url),
                              next((n.attrib.get("href", "") for n in link_nodes if n.attrib.get("href")), ""))
            updated = atom_text(entry, "a:updated")
            entry_id = atom_text(entry, "a:id") or source_url
            if not entry_id or entry_id in known or not source_url:
                continue
            # Keep the candidate set narrow enough to avoid downloading unrelated XML.
            candidate = bool(re.search(r"全般気象解説情報|VPZJ51|台風第?\s*\d{1,2}号", title + " " + summary + " " + entry_id + " " + source_url))
            if not candidate:
                continue

            try:
                raw_xml = fetch(source_url)
                root = ET.fromstring(raw_xml)
            except Exception as error:
                print(f"XML fetch/parse failed ({title}): {error}")
                continue

            if not is_typhoon_vpzj51(title, summary, source_url, entry_id, root):
                continue
            full_text = " ".join([title, summary, xml_text(root)])
            serial_raw = first_tag_text(root, "Serial")
            serial = serial_number(serial_raw, full_text)
            if serial != 1:
                skipped_non_first += 1
                print(f"Skipped non-first issue (serial={serial}): {title}")
                continue

            issue_raw = first_tag_text(root, "ReportDateTime") or first_tag_text(root, "DateTime") or updated
            issue_dt = parse_datetime(issue_raw)
            if issue_dt is None:
                issue_dt = parse_datetime(updated)
            genesis_dt = extract_genesis_datetime(full_text, issue_dt)
            typhoon_number = extract_typhoon_number(full_text)
            if not genesis_dt:
                skipped_not_genesis += 1
                print(f"Skipped first issue without explicit genesis time: {title}")
                continue

            event_key = f"{issue_dt.year if issue_dt else 'unknown'}-{typhoon_number}-{genesis_dt}"
            if event_key in known_events:
                print(f"Skipped duplicate genesis event: {event_key}")
                known.add(entry_id)
                continue

            digest = hashlib.sha256(raw_xml).hexdigest()
            stem = digest[:24]
            xml_file, json_file = f"{stem}.xml", f"{stem}.json"
            (OUT / xml_file).write_bytes(raw_xml)
            payload = {
                "schemaVersion": 2,
                "productCode": "VPZJ51",
                "feed": feed_name,
                "id": entry_id,
                "title": title,
                "summary": summary,
                "serial": serial,
                "typhoonNumber": typhoon_number,
                "eventKey": event_key,
                "issueDateTime": issue_dt.isoformat() if issue_dt else updated,
                "genesisDateTime": genesis_dt,
                "sourceUrl": source_url,
                "sha256": digest,
                "archivedAt": now_iso(),
                "xmlFile": xml_file,
                "parsed": extract_xml_fields(raw_xml),
            }
            (OUT / json_file).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            entry_record = {
                "id": entry_id, "title": title, "summary": summary, "feed": feed_name, "feedUpdatedAt": updated,
                "file": json_file, "xmlFile": xml_file, "sourceUrl": source_url,
                "sha256": digest, "productCode": "VPZJ51", "serial": 1,
                "typhoonNumber": typhoon_number, "eventKey": event_key,
                "issueDateTime": payload["issueDateTime"], "genesisDateTime": genesis_dt,
            }
            index.setdefault("entries", []).append(entry_record)
            known.add(entry_id)
            known_events.add(event_key)
            added += 1
            print(f"Archived first issue: {title} | genesis={genesis_dt}")

    index["schemaVersion"] = 2
    index["updatedAt"] = now_iso()
    index["lastRun"] = {"added": added, "feedErrors": feed_errors,
                         "skippedNonFirstIssue": skipped_non_first,
                         "skippedFirstIssueWithoutGenesis": skipped_not_genesis}
    index["entries"] = sorted(index.get("entries", []), key=lambda e: e.get("genesisDateTime", ""), reverse=True)
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Genesis archive updated: +{added}, total={len(index['entries'])}, feed errors={feed_errors}")


if __name__ == "__main__":
    main()
