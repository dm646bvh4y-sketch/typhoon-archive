# Typhoon Archive v1.0 — pre-publication candidate

父島アメダスを基準に、気象庁公開台風データの実況・予報、父島への最接近、過去予報の変化を記録・比較する個人開発サイト。

**このビルドは公開直前候補です。** 機能を一式統合していますが、外部のJMA endpoint・GitHub Actions・Safari/Windowsブラウザの実動作確認は、利用者の環境で最後に行う必要があります。気象庁公式の防災情報や運用判断を代替するものではありません。

## Included functionality

- JMA current typhoon list and `specifications.json` live track/forecast (automatic fetch on startup / storm selection; refresh every 60 minutes while the browser tab is open)
- Past typhoon track from `pastTracks.json` (source data does not supply timestamp for every point)
- OSM / OpenTopoMap toggle and automatic 1°, 0.5°, 0.2° graticule
- Forecast circles where JMA source radius exists
- JMA `galeWarning` (30-kt strong-wind area) and `stormWarning` (50-kt storm area) parsing. Wind areas are now rendered as circles centered on each forecast typhoon position. `全域` uses its reported radius; direction-dependent data is simplified to the largest sector radius as an outer-envelope circle.
- Chichijima AMeDAS station 44301 distance/bearing, estimated closest approach, table, motion estimate
- JMA information bulletin history, including `全般台風情報` and `全般気象解説情報`
- Hourly GitHub Actions collector for changed JMA specifications snapshots
- Past forecast route overlay (orange dashed) from saved snapshots
- Comparison table/chart for archived forecast closest-approach distance to Chichijima
- Browser print / PDF report
- GitHub Pages deployment workflow (manual repo setup needed)

## Local run on Mac

1. Unzip this folder.
2. Open Terminal and `cd` into `typhoon-archive-starter`.
3. Start a local server:

```bash
python3 -m http.server 8000
```

4. Open Safari: `http://localhost:8000`

If JMA fetch/CORS fails, fetch snapshots locally:

```bash
python3 scripts/fetch_jma.py
```

Then reload the page. `fetch_jma.py` downloads current typhoon JSON plus a bulletin index and a capped number of recent bulletin details into `data/`. The browser falls back to those local files when the live JMA request fails.

## Forecast archive collector

Test manually first (Mac internet connection required):

```bash
python3 scripts/archive_forecasts.py
```

The collector:
- reads `targetTc.json`
- downloads each active storm's `specifications.json`
- calculates SHA-256 over forecast payload + issue time
- saves a new snapshot only when payload/issue changes
- writes archive metadata to `data/archive/index.json`

Saved data layout:

```text
data/archive/
├── index.json
└── <storm-event-id>/
    └── <capture-time>.json
```

The website displays these files only when served over HTTP (localhost or a website), not when opening `index.html` directly as `file://`.

### Data volume / caveat

The collector runs once per hour, but does not save unchanged specifications. Actual issue frequency can be every few hours, so a check is not necessarily a new forecast issuance. Both `capturedAt` and `sourceIssueTime` are recorded separately.

Archive is **prospective**: historical forecast snapshots from before collection began cannot be reconstructed from `pastTracks.json`. GitHub Actions commit history will grow over time. For a long-running public archive, periodically assess repository size and consider moving snapshots to object storage rather than keeping every revision in Git.

## GitHub publication (only after local validation)

1. Create a GitHub repository (public if you want an open URL).
2. Upload/commit this project folder to the repository root.
3. Keep `data/` ignored initially. Do not commit local caches accidentally.
4. Enable GitHub Actions and Pages in repository settings. Pages source should use GitHub Actions.
5. Push `main`; `deploy-pages.yml` deploys the static site.
6. Run `Archive JMA typhoon forecasts` manually from Actions once to test. It will commit the archive to the repository.
7. Verify the public site and archive files before sharing the URL.

Note: the hourly collector workflow uses `git add -f data/archive` because `data/` is ignored for local downloaded cache. It commits snapshots and index. GitHub scheduled workflows may be delayed by GitHub. Do not rely on exact minute execution.

## Data sources / credits

- Japan Meteorological Agency (JMA) Typhoon information JSON:
  - `https://www.jma.go.jp/bosai/typhoon/data/targetTc.json`
  - `https://www.jma.go.jp/bosai/typhoon/data/pastTracks.json`
  - `https://www.jma.go.jp/bosai/typhoon/data/<event-id>/specifications.json`
  - `https://www.jma.go.jp/bosai/typhoon/data/<event-id>/forecast.json`
- JMA disaster information list/details:
  - `https://www.jma.go.jp/bosai/information/data/r8/information.json`
  - `https://www.jma.go.jp/bosai/information/data/r8/denbun/<jsonName>.json`
- OpenStreetMap contributors / OpenTopoMap (map tiles)
- Leaflet (map library)

These JMA URLs are website JSON endpoints and are not guaranteed to be a versioned public API. Their structure may change. Please check JMA data usage/attribution terms before public or operational use.

## Important methodology and limitations

- Chichijima reference: JMA AMeDAS station 44301, 27.0916667°N, 142.1900000°E.
- Distances use Haversine great-circle distance.
- Closest-approach time/position between forecast points uses linear interpolation and is an estimate, not a JMA-issued value.
- Direction/speed from adjacent positions are estimates; past tracks without timestamps cannot yield speed or time.
- Current (実況) wind-area radii are simplified as circles for this project: full-area values are used directly; directional north/south values are averaged for the strong-wind circle. This is a visualization approximation, not the original asymmetric shape.
- Forecast “暴風警戒域” uses the storm-warning source value according to the project convention (published `range.km` interpreted as full width and divided by two), then connects left/right offset points perpendicular to the forecast track to create a corridor-like polygon. This is an approximate visualization, not an official JMA polygon. If suitable source values are missing, the overlay is omitted rather than invented.
- PDF route SVG includes the same connected storm-warning corridor when radius data is available; it is a simplified schematic and not a geographic basemap.
- Bulletin event phrase matching is heuristic. The displayed bulletin issue time is not automatically treated as genesis time.
- Forecast history is available only from the time the collector begins saving.
- PDF uses browser print dialog; choose “Save as PDF”.
- Tile providers/JMA endpoints may be inaccessible on a restricted workplace network. Confirm network rules with your organization before use.

## Privacy and security
- Do not place credentials, API keys, private files, or sensitive work data in this repository.
- A public GitHub repository is visible to everyone. Consider project attribution, workplace rules, and JMA terms before publishing.
- This is a personal tool. It is not an official JMA application.


## Automatic JMA refresh and archive (important distinction)
- When opened, the page automatically fetches the JMA typhoon list and selected typhoon data.
- While the browser tab remains open, the selected live storm refreshes every 60 minutes.
- This browser refresh stops when the page is closed/suspended. It does not create a permanent archive by itself.
- The GitHub Actions collector (`archive-forecasts.yml`) is the remote hourly process. After the project is pushed and Actions are enabled, it can run independently of your Mac/browser and save changed forecast snapshots.
- For scheduled snapshots, `workflow_dispatch` can also be manually run in the GitHub Actions tab.


### 暴風警戒域の接続表示（開発版）
各予報中心に描画する暴風警戒域円の半径を使用し、進路の左右側にある円周接点をつないだ近似領域を紫色で表示します。各予報中心の警戒域円も破線で個別表示します。PDF経路図にも接続領域と各円を描画します。これは可視化上の近似であり、気象庁の公式暴風警戒域の形状を再現するものではありません。

## Phase 2 / Phase 3 updates (2026-11)

### Municipal PDF output
- PDF report options include the map image, past track, forecast track, closest approach metrics, wind circles, and storm-warning corridor independently.
- The generated map is rendered with a dynamically calculated canvas aspect ratio and uses `object-fit: contain` in print output to avoid distortion.
- Use the browser print dialog and choose **Save as PDF**. Check/uncheck `地図画像`, `地図上の台風経路・中心位置`, and `今後の予想中心位置・予報経路` independently. The map bitmap dimensions are calculated before canvas creation to preserve the map aspect ratio.

### JMA public XML archive
- `scripts/archive_jma_xml.py` pulls the official JMA public Atom feeds (`extra`, `extra_l`, `regular`, `regular_l`), filters typhoon/tropical-cyclone-related entries, stores original XML and basic parsed metadata under `data/xml-archive/`, and updates `index.json`.
- The GitHub Actions archive workflow runs both forecast snapshot archival and XML bulletin archival, and commits `data/archive` plus `data/xml-archive`.
- The page lists recent archived XML entries and links to the original JMA XML, archived raw XML, and parsed metadata JSON. The UI distinguishes feed source from the locally archived XML file.
- JMA public XML PULL feed is best-effort; delays, maintenance, or feed changes may affect retrieval. The archive only contains entries captured after the workflow is enabled; it does not retroactively reconstruct older feed messages.
- The XML archive is a general bulletin archive (title filtering for typhoon/tropical-cyclone terms), not yet a fully normalized typhoon lifecycle database. Schema-specific structured parsing and timeline linkage can be expanded in Phase 1.

## Phase 3: JMA typhoon genesis (first bulletin only)

The XML collector (`scripts/archive_jma_xml.py`) polls the public JMA PULL Atom feeds and stores only typhoon-related **VPZJ51 / 全般気象解説情報 第1号** messages that explicitly contain a genesis date/time. Later bulletins (第2号以降) are ignored. The script does not substitute bulletin issue time for genesis time.

- Raw XML and parsed JSON are stored in `data/xml-archive/`.
- `data/xml-archive/index.json` is used by the Typhoon Archive site to show genesis date/time.
- `.github/workflows/archive-jma-genesis.yml` polls every 5 minutes (GitHub Actions schedules can be delayed).
- The hourly forecast archive is kept separate in `archive-forecasts.yml`.
- JMA PULL feeds have limited retention and can be delayed or unavailable; the collector cannot recover a first bulletin after it has disappeared from the feeds unless it was previously archived.
- The extraction targets statements such as `7日12時 ... 熱帯低気圧が台風第32号になりました`. If the XML body uses an unexpected wording/schema, the collector logs a skipped first issue rather than guessing.

Run locally from the project root:

```bash
python3 scripts/archive_jma_xml.py
```

The public site reads the committed `data/xml-archive/index.json`; local testing requires serving the project through HTTP (e.g. `python3 -m http.server 8000`), not opening `index.html` as a file.
