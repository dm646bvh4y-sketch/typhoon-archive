# Release checklist — Phase 2 + Phase 3

- [ ] Open local server and verify PDF options are visible.
- [ ] Export PDF with map checkbox enabled; confirm map is included without distortion.
- [ ] Export PDF with map checkbox disabled; confirm map is omitted.
- [ ] Export PDF with forecast-track checkbox disabled; confirm forecast table is omitted independently.
- [ ] Export PDF with map-track checkbox disabled; confirm the map image remains but the storm track/center markers are omitted.
- [ ] Verify other PDF checkboxes continue to control their corresponding information.
- [ ] Run `python3 scripts/archive_jma_xml.py` (requires network) and inspect `data/xml-archive/index.json`.
- [ ] Run GitHub Actions workflow manually; confirm original XML and metadata JSON are committed to `data/xml-archive/`.
- [ ] Publish to GitHub Pages only after local checks.

Notes:
- Local environment network restrictions can cause XML fetch to fail; this is not a parser test.
- The XML feed archive only stores messages captured after the collector is enabled.
