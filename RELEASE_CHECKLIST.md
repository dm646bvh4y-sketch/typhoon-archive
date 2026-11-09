# v1.0 final setup / sharing checklist

This is intentionally a pre-publication checklist. Do not share the public URL until these checks pass.

## Mac local validation
- [ ] Unzip into a new folder (keep prior versions as backups).
- [ ] Run `python3 -m http.server 8000` from project root.
- [ ] Verify live JMA typhoon list / selected storm / timestamps.
- [ ] Verify station pin, distance, direction, closest time and route table.
- [ ] Verify graticule toggling and automatic interval.
- [ ] Verify OSM/OpenTopoMap layer toggling.
- [ ] Verify forecast circle and wind area overlays on a storm with valid data.
- [ ] Confirm current strong-wind area uses the project’s north/south average circle approximation.
- [ ] Confirm forecast storm-warning area is shown as a connected corridor from track-perpendicular outer points (project approximation).
- [ ] Confirm PDF SVG contains the storm-warning corridor and legend when warning-radius data exists.
- [ ] Verify the bulletin list and the JMA source link.
- [ ] Run `python3 scripts/archive_forecasts.py`; verify index and snapshot files are created.
- [ ] Reload; select a saved forecast; verify orange dashed track overlay.
- [ ] If two snapshots exist, verify distance history chart and table.
- [ ] Verify print/PDF export, A4 landscape.
- [ ] Test browser/JMA offline fallback with `python3 scripts/fetch_jma.py`.

## Windows / workplace
- [ ] Test using Edge or Chrome, and Safari on Mac.
- [ ] Confirm JMA, GitHub Pages, OpenStreetMap, OpenTopoMap and Leaflet CDN access under workplace network policy.
- [ ] Confirm map tile attribution remains visible.
- [ ] Confirm page is not used as official operational information.

## GitHub publication
- [ ] Review repository contents before making it public.
- [ ] Check JMA data reuse/attribution policy and workplace rules.
- [ ] Create repo and push project.
- [ ] Set Pages source to GitHub Actions.
- [ ] Run deploy workflow and test URL.
- [ ] Run archive workflow manually; confirm it commits index + snapshot.
- [ ] Confirm scheduled runs and repository storage growth.
- [ ] Add project disclaimer and source citations in public README.

- [ ] ブラウザ地図：紫色の接続領域が予報中心ごとの暴風警戒域円周をつないでいること
- [ ] ブラウザ地図：各予報中心の暴風警戒域円（紫破線）も表示されること
- [ ] PDF：接続領域と紫色の各警戒域円が描画され、地図範囲内に収まること
- [ ] PDF凡例：警戒域円周の接続近似であることが明記されていること
