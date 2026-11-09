// Typhoon Archive v1.0 development — local-first consolidation
// JMA's Bosai JSON endpoints are public website data, not a versioned API.
// Schema may change; errors are surfaced in the UI.
// Chichijima AMeDAS (JMA station 44301): 27°05.5'N, 142°11.4'E
const STATION = { name: "父島アメダス", id: "44301", lat: 27 + 5.5 / 60, lon: 142 + 11.4 / 60 };
const JMA = "https://www.jma.go.jp/bosai/typhoon/data";

const map = L.map("map").setView([STATION.lat, STATION.lon], 5);
const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Optional topographic base map (external OpenTopoMap tiles).
const topoLayer = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 17,
  attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
});
const baseMapCheckbox = document.getElementById("baseMapTopo");
baseMapCheckbox?.addEventListener("change", () => {
  if (baseMapCheckbox.checked) {
    if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
    topoLayer.addTo(map);
  } else {
    if (map.hasLayer(topoLayer)) map.removeLayer(topoLayer);
    osmLayer.addTo(map);
  }
});
// Keep a named reference to the default OSM layer for base-map switching.

const stationIcon = L.divIcon({
  className: "station-marker",
  html: '<div style="background:#49b5ff;border:2px solid white;border-radius:50%;width:15px;height:15px;box-shadow:0 0 0 5px #49b5ff33"></div>',
  iconSize: [15,15], iconAnchor: [7,7]
});
L.marker([STATION.lat, STATION.lon], {icon:stationIcon}).addTo(map)
  .bindPopup(`<b>${STATION.name}</b><br>観測所番号 ${STATION.id}`);
L.circle([STATION.lat, STATION.lon], {radius:100000, color:"#49b5ff", weight:1, fillOpacity:.04}).addTo(map);

// Geographic graticule: 0.2° at local scale, 0.5° medium, 1° at broad scale.
const graticuleLayer = L.layerGroup().addTo(map);
const graticuleLabels = L.layerGroup().addTo(map);
let graticuleStep = null;
function niceGridStep(bounds) {
  const span = Math.max(bounds.getNorth()-bounds.getSouth(), bounds.getEast()-bounds.getWest());
  if (span <= 2.5) return 0.2;
  if (span <= 7) return 0.5;
  return 1.0;
}
function drawGraticule() {
  if (!document.getElementById("showGraticule")?.checked) {
    graticuleLayer.clearLayers(); graticuleLabels.clearLayers(); return;
  }
  const b=map.getBounds(), step=niceGridStep(b);
  graticuleLayer.clearLayers(); graticuleLabels.clearLayers();
  graticuleStep=step;
  const south=Math.floor(b.getSouth()/step)*step, north=Math.ceil(b.getNorth()/step)*step;
  const west=Math.floor(b.getWest()/step)*step, east=Math.ceil(b.getEast()/step)*step;
  for(let lat=south;lat<=north+step/2;lat+=step){
    L.polyline([[lat,west],[lat,east]],{color:"#6d8799",weight:1,opacity:.38,dashArray:"3 5",interactive:false}).addTo(graticuleLayer);
    if(lat>=-90&&lat<=90){
      const label=`北緯${Math.abs(lat).toFixed(step===0.2?1:step===0.5?1:0)}°${lat<0?"S":""}`;
      L.marker([lat,b.getWest()],{interactive:false,icon:L.divIcon({className:"grid-label",html:label,iconSize:[72,16],iconAnchor:[0,8]})}).addTo(graticuleLabels);
    }
  }
  for(let lon=west;lon<=east+step/2;lon+=step){
    L.polyline([[south,lon],[north,lon]],{color:"#6d8799",weight:1,opacity:.38,dashArray:"3 5",interactive:false}).addTo(graticuleLayer);
    if(lon>=-180&&lon<=180){
      const label=`${lon<0?"西経":"東経"}${Math.abs(lon).toFixed(step===0.2?1:step===0.5?1:0)}°`;
      L.marker([b.getSouth(),lon],{interactive:false,icon:L.divIcon({className:"grid-label",html:label,iconSize:[72,16],iconAnchor:[36,0]})}).addTo(graticuleLabels);
    }
  }
}
map.on("moveend zoomend",drawGraticule);
document.getElementById("showGraticule")?.addEventListener("change",drawGraticule);
drawGraticule();

const $ = id => document.getElementById(id);
const typhoonSelect = $("typhoonSelect");
const trackTypeSelect = $("trackType");
let activeTcs = [];
let currentStorm = null;
let liveTrack = [];
let historical = false;
let routeLayer = null, pointsLayer = null, nearestMarker = null;
let currentTrackParts = [];
let renderedTrack = [];
let renderedHasTime = true;
let renderedNearest = null;
const layerForecast=L.layerGroup().addTo(map), layerStorm=L.layerGroup().addTo(map), layerStrong=L.layerGroup().addTo(map), layerWarning=L.layerGroup().addTo(map);
const historicalForecastLayer=L.layerGroup().addTo(map);
const layerCheckboxes={forecast:$("layerForecastCircle"),storm:$("layerStormWind"),strong:$("layerStrongWind"),warning:$("layerStormWarning")};
function syncOverlayLayers(){[[layerForecast,layerCheckboxes.forecast],[layerStorm,layerCheckboxes.storm],[layerStrong,layerCheckboxes.strong],[layerWarning,layerCheckboxes.warning]].forEach(([l,c])=>{if(c?.checked){if(!map.hasLayer(l))l.addTo(map)}else if(map.hasLayer(l))map.removeLayer(l)});}
Object.values(layerCheckboxes).forEach(c=>c?.addEventListener("change",syncOverlayLayers));
function getRadius(o,keys){
  for(const k of keys){
    const v=o?.[k];
    const candidates=[v?.km,v?.radius?.km,v?.radiusKm,v?.range?.km,v?.value,v];
    for(const candidate of candidates){
      const n=Number(candidate);
      if(Number.isFinite(n)&&n>0)return n;
    }
  }
  return null;
}
// JMA typhoon specifications commonly encode wind areas as arrays like
// [{area:"北東", range:{km:...}}, ...] rather than a simple radius field.
function parseJmaWindArea(value){
  if(!value)return null;
  const list=Array.isArray(value)?value:[value];
  const result={};
  for(const item of list){
    if(!item || typeof item!=="object")continue;
    const area=String(item.area||item.direction||"").trim();
    const km=Number(item.range?.km??item.km??item.radius?.km);
    if(!Number.isFinite(km)||km<=0)continue;
    if(["全域","全方向","全周"].includes(area)){result.all=km;continue;}
    const dirMap={"北":"N","北東":"NE","東":"E","南東":"SE","南":"S","南西":"SW","西":"W","北西":"NW",
      "北北東":"NNE","東北東":"ENE","東南東":"ESE","南南東":"SSE","南南西":"SSW","西南西":"WSW","西北西":"WNW","北北西":"NNW"};
    const d=dirMap[area]||area.toUpperCase();
    if(d)result[d]=km;
  }
  return Object.keys(result).length?result:null;
}
// Simplified circle radius from JMA area data. "全域" uses its exact radius;
// directional entries use the largest published sector radius as an envelope.
function getJmaWindAreaMaxRadius(value){
  if(!value)return null;
  const parsed=parseJmaWindArea(value);
  if(!parsed)return null;
  const values=Object.values(parsed).filter(v=>Number.isFinite(v)&&v>0);
  return values.length?Math.max(...values):null;
}
function windAreaPolygon(lat,lon,area){
  if(!area)return null;
  if(Number.isFinite(area.all))return null; // Render a true radius circle instead.
  const directions=["N","NE","E","SE","S","SW","W","NW"];
  const vals=directions.map(d=>area[d]??area[({N:"north",NE:"northeast",E:"east",SE:"southeast",S:"south",SW:"southwest",W:"west",NW:"northwest"})[d]]);
  if(vals.every(v=>!Number.isFinite(v)))return null;
  // Missing sectors are not fabricated: interpolate only between adjacent
  // observed sectors for a smooth illustrative perimeter; mark this in legend.
  const known=vals.map((v,i)=>Number.isFinite(v)?i:null).filter(i=>i!==null);
  if(known.length<2)return null;
  const full=[];
  for(let i=0;i<8;i++){
    if(Number.isFinite(vals[i])){full.push(vals[i]);continue;}
    let prev=known.filter(k=>k<i).pop(); if(prev===undefined)prev=known[known.length-1]-8;
    let next=known.find(k=>k>i); if(next===undefined)next=known[0]+8;
    const pv=vals[(prev+8)%8], nv=vals[next%8], t=(i-prev)/(next-prev);
    full.push(pv+(nv-pv)*t);
  }
  const points=[], rad=Math.PI/180, kmLat=111.32, kmLon=111.32*Math.cos(lat*rad);
  for(let j=0;j<32;j++){
    const deg=j*11.25, sector=deg/45, i=Math.floor(sector)%8, t=sector-Math.floor(sector);
    const r=full[i]*(1-t)+full[(i+1)%8]*t, a=deg*rad;
    points.push([lat+(r*Math.cos(a))/kmLat,lon+(r*Math.sin(a))/kmLon]);
  }
  return points;
}
// Connect the circumferences of forecast storm-warning circles.
// At every forecast center, keep the warning circle radius and connect the
// left/right tangent-side points of adjacent circles along the track.
// This is a geometric visualization approximation, not an official JMA polygon.
function warningCorridor(points, radiusKey="stormWindRadiusKm"){
  const valid=(points||[]).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p[radiusKey])&&p[radiusKey]>0);
  if(valid.length<2)return null;
  const meanLat=valid.reduce((a,p)=>a+p.lat,0)/valid.length;
  const cos=Math.cos(meanLat*Math.PI/180), kmLat=111.32, kmLon=111.32*cos;
  const xy=valid.map(p=>({x:p.lon*kmLon,y:p.lat*kmLat,r:p[radiusKey]}));
  const normals=[];
  for(let i=0;i<xy.length;i++){
    const prev=xy[Math.max(0,i-1)], next=xy[Math.min(xy.length-1,i+1)];
    let dx=next.x-prev.x,dy=next.y-prev.y,len=Math.hypot(dx,dy);
    if(len<1e-6){dx=1;dy=0;len=1;}
    // Unit normal to the forecast-track tangent.
    normals.push({x:-dy/len,y:dx/len});
  }
  const left=xy.map((c,i)=>({x:c.x+normals[i].x*c.r,y:c.y+normals[i].y*c.r}));
  const right=xy.map((c,i)=>({x:c.x-normals[i].x*c.r,y:c.y-normals[i].y*c.r}));
  // Add semicircular end caps around the first and last forecast circles.
  const cap=(center,normal,startSign)=>{
    const tangent={x:normal.y,y:-normal.x};
    const out=[];
    for(let j=0;j<=16;j++){
      const a=Math.PI*j/16;
      const sign=startSign;
      out.push({x:center.x+center.r*(normal.x*Math.cos(a)*sign+tangent.x*Math.sin(a)),
                y:center.y+center.r*(normal.y*Math.cos(a)*sign+tangent.y*Math.sin(a))});
    }
    return out;
  };
  const firstCap=cap(xy[0],normals[0],-1), lastCap=cap(xy[xy.length-1],normals[normals.length-1],1);
  const boundary=[...left,...lastCap.slice(1,-1),...right.slice().reverse(),...firstCap.slice(1,-1)];
  return boundary.map(q=>[q.y/kmLat,q.x/kmLon]);
}
function warningRadiusFromSpec(x){
  // Direct explicit radius fields are treated as radii.
  const direct=getRadius(x,["stormWarningRadius","warningRadiusKm"]);
  if(direct)return direct;
  // JMA specifications' stormWarning.range.km is displayed here as a full
  // warning-area diameter per the project convention; convert to radius.
  const area=parseJmaWindArea(x?.stormWarning);
  if(!area)return null;
  const vals=Object.values(area).filter(v=>Number.isFinite(v)&&v>0);
  return vals.length?Math.max(...vals)/2:null;
}
// Directional wind radii are represented as an ellipse-like polygon when source data
// provides quadrant radii. Never fabricate missing quadrants.
function getDirectionalRadius(o,keys){
  for(const k of keys){
    const v=o?.[k];
    if(!v || typeof v!=="object") continue;
    const pick=(...names)=>{for(const name of names){const n=Number(v?.[name]?.km??v?.[name]);if(Number.isFinite(n)&&n>0)return n;}return null;};
    const north=pick("north","N","n"), east=pick("east","E","e"), south=pick("south","S","s"), west=pick("west","W","w");
    if([north,east,south,west].some(x=>x!==null)) return {north,east,south,west};
  }
  return null;
}
function radiusPolygon(lat,lon,r){
  if(!r || ![r.north,r.east,r.south,r.west].some(Number.isFinite)) return null;
  const points=[];
  const rad=Math.PI/180, kmPerDegLat=111.32, kmPerDegLon=111.32*Math.cos(lat*rad);
  const quadrants=[["N",r.north],["E",r.east],["S",r.south],["W",r.west]];
  // Smooth 4 quadrant radii into an approximate 32-point outline.
  for(let i=0;i<32;i++){
    const angle=i*360/32; // clockwise from north
    let q, t;
    if(angle<90){q="N-E";t=angle/90;}
    else if(angle<180){q="E-S";t=(angle-90)/90;}
    else if(angle<270){q="S-W";t=(angle-180)/90;}
    else {q="W-N";t=(angle-270)/90;}
    const pair=q==="N-E"?[r.north,r.east]:q==="E-S"?[r.east,r.south]:q==="S-W"?[r.south,r.west]:[r.west,r.north];
    if(!pair.every(Number.isFinite)) return null;
    const radius=pair[0]*(1-t)+pair[1]*t;
    const a=angle*rad;
    points.push([lat+(radius*Math.cos(a))/kmPerDegLat,lon+(radius*Math.sin(a))/kmPerDegLon]);
  }
  return points;
}


function setStatus(text, isError=false) {
  $("statusText").textContent = text;
  $("statusBox").classList.toggle("error", isError);
}
function haversineKm(lat1,lon1,lat2,lon2) {
  const R=6371, rad=Math.PI/180;
  const dLat=(lat2-lat1)*rad, dLon=(lon2-lon1)*rad;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(Math.min(1,a)));
}
function bearingDeg(lat1,lon1,lat2,lon2) {
  const rad=Math.PI/180, p1=lat1*rad, p2=lat2*rad, dl=(lon2-lon1)*rad;
  const y=Math.sin(dl)*Math.cos(p2);
  const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
function compass(deg) {
  return ["北","北北東","北東","東北東","東","東南東","南東","南南東","南","南南西","南西","西南西","西","西北西","北西","北北西"][Math.round(deg/22.5)%16];
}
function fmtTime(iso) {
  if (!iso) return "時刻情報なし";
  return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso));
}
function safeNum(v) { const n=Number(v); return Number.isFinite(n)?n:null; }
function typhoonLabel(tc) {
  const n=String(tc.typhoonNumber ?? "");
  if (/^\d{4}$/.test(n)) return `台風${Number(n.slice(-2))}号`;
  if (n) return `熱帯低気圧 ${n}`;
  return "熱帯低気圧";
}
async function getJSON(url) {
  // Try the live JMA endpoint first. If browser CORS/network policy blocks it,
  // fall back to a local snapshot downloaded by scripts/fetch_jma.py.
  try {
    const response=await fetch(url,{cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (remoteError) {
    const typhoonMarker="/bosai/typhoon/data/";
    const infoMarker="/bosai/information/data/r8/";
    const typhoonIdx=url.indexOf(typhoonMarker);
    const infoIdx=url.indexOf(infoMarker);
    let localPath;
    if(typhoonIdx>=0){
      const relative=url.slice(typhoonIdx+typhoonMarker.length);
      localPath=`data/${relative}`;
    }else if(infoIdx>=0){
      const relative=url.slice(infoIdx+infoMarker.length);
      localPath=`data/information/${relative}`;
    }else throw remoteError;
    try {
      const local=await fetch(localPath,{cache:"no-store"});
      if(!local.ok) throw new Error(`local HTTP ${local.status}`);
      setStatus("JMAへの直接接続不可：ローカル保存データを使用中",false);
      return await local.json();
    } catch(localError) {
      throw new Error(`ライブ取得失敗 (${remoteError.message})。ローカルデータ ${localPath} も読み込めません。scripts/fetch_jma.py を実行してください。`);
    }
  }
}
function clearLayers() {
  [routeLayer,pointsLayer,nearestMarker].forEach(layer=>{if(layer)map.removeLayer(layer);});
  routeLayer=pointsLayer=nearestMarker=null;
}
function calculatePoint(p) {
  return {...p,
    distance:haversineKm(STATION.lat,STATION.lon,p.lat,p.lon),
    bearing:bearingDeg(STATION.lat,STATION.lon,p.lat,p.lon)
  };
}
// Estimate closest point between two timed positions using a local equirectangular
// projection around the station; interpolate time linearly. This is an estimate.
function interpolateClosest(a,b) {
  const rad=Math.PI/180, cosLat=Math.cos(STATION.lat*rad);
  const x1=(a.lon-STATION.lon)*rad*cosLat, y1=(a.lat-STATION.lat)*rad;
  const x2=(b.lon-STATION.lon)*rad*cosLat, y2=(b.lat-STATION.lat)*rad;
  const dx=x2-x1, dy=y2-y1;
  const denom=dx*dx+dy*dy;
  const t=denom ? Math.max(0,Math.min(1,-(x1*dx+y1*dy)/denom)) : 0;
  const lat=a.lat+(b.lat-a.lat)*t, lon=a.lon+(b.lon-a.lon)*t;
  const time=new Date(new Date(a.time).getTime()+(new Date(b.time).getTime()-new Date(a.time).getTime())*t).toISOString();
  return calculatePoint({lat,lon,time,interpolated:true});
}
function nearestApproach(points) {
  if(!points.length) return null;
  let best=points.map(calculatePoint).reduce((x,y)=>y.distance<x.distance?y:x);
  for(let i=0;i<points.length-1;i++) {
    if(!points[i].time || !points[i+1].time) continue;
    const candidate=interpolateClosest(points[i],points[i+1]);
    if(candidate.distance<best.distance) best=candidate;
  }
  return best;
}
function updateMetrics(points, nearest, timeAvailable=true, currentInfo=null) {
  $("closestTime").textContent=timeAvailable && nearest?.time ? fmtTime(nearest.time) : "時刻データなし";
  $("closestDistance").textContent=nearest ? `${nearest.distance.toFixed(1)} km` : "—";
  $("closestDirection").textContent=nearest ? compass(nearest.bearing) : "—";
  $("closestBearing").textContent=nearest ? `方位角 ${nearest.bearing.toFixed(1)}°（父島から見た方向）` : "—";
  $("closestPosition").textContent=nearest ? `${nearest.lat.toFixed(2)}°N / ${nearest.lon.toFixed(2)}°E` : "—";
  $("closestPressure").textContent=currentInfo?.pressure ? `${currentInfo.pressure} hPa` : "—";
  $("closestWind").textContent=currentInfo?.wind ? `${currentInfo.wind} m/s` : "—";
}

// Calculate movement from adjacent centers. Direction is the forward bearing
// from the previous center to the current center (first row uses next center).
function movementFor(points, index, timeAvailable=true) {
  if(!points || points.length<2) return {course:null, speedKmh:null, speedKt:null};
  let a,b;
  // Associate each row with the segment leaving that position; the last row
  // falls back to the preceding segment so it still has a movement estimate.
  if(index<points.length-1) { a=points[index]; b=points[index+1]; }
  else { a=points[index-1]; b=points[index]; }
  const course=bearingDeg(a.lat,a.lon,b.lat,b.lon);
  if(!timeAvailable || !a.time || !b.time) return {course, speedKmh:null, speedKt:null};
  const hours=(new Date(b.time)-new Date(a.time))/3600000;
  if(!Number.isFinite(hours) || hours<=0) return {course, speedKmh:null, speedKt:null};
  const speedKmh=haversineKm(a.lat,a.lon,b.lat,b.lon)/hours;
  return {course, speedKmh, speedKt:speedKmh/1.852};
}
function movementText(points,index,timeAvailable=true) {
  const m=movementFor(points,index,timeAvailable);
  const direction=m.course==null?"—":`${compass(m.course)} (${m.course.toFixed(0)}°)`;
  const speed=m.speedKmh==null?"算出不可（時刻情報なし）":`${m.speedKmh.toFixed(1)} km/h · ${m.speedKt.toFixed(1)} kt`;
  return {direction,speed};
}


function renderTable(points, timeAvailable=true) {
  const rows=$("trackRows"); rows.innerHTML="";
  points.forEach((p,i)=>{
    const q=calculatePoint(p), m=movementText(points,i,timeAvailable), tr=document.createElement("tr");
    tr.innerHTML=`<td>${timeAvailable?fmtTime(p.time):"時刻情報なし"}</td>
      <td>${q.lat.toFixed(2)}°N</td><td>${q.lon.toFixed(2)}°E</td>
      <td>${q.distance.toFixed(1)} km</td><td>${compass(q.bearing)} (${q.bearing.toFixed(0)}°)</td>
      <td>${m.speed}</td><td>${m.direction}</td>`;
    rows.appendChild(tr);
  });
}
function drawTrack(points, label, timeAvailable=true, currentInfo=null) {
  renderedTrack = points.map(p=>({...p}));
  renderedHasTime = timeAvailable;
  clearLayers();
  if(!points.length) {
    renderedNearest = null;
    updateMetrics([],null,timeAvailable,currentInfo);
    $("trackRows").innerHTML='<tr><td colspan="7">位置情報がありません。</td></tr>';
    setStatus("位置データなし",true); return;
  }
  const nearest=nearestApproach(points);
  renderedNearest = nearest;
  [layerForecast,layerStorm,layerStrong,layerWarning].forEach(l=>l.clearLayers());
  points.forEach(p=>{
    if(timeAvailable&&p.radiusKm)L.circle([p.lat,p.lon],{radius:p.radiusKm*1000,color:"#f2a23a",dashArray:"5 4",fillOpacity:.04}).bindTooltip("予報円").addTo(layerForecast);
    if(timeAvailable&&p.stormWindRadiusKm)L.circle([p.lat,p.lon],{radius:p.stormWindRadiusKm*1000,color:"#e53935",weight:2,fillColor:"#e53935",fillOpacity:.08}).bindTooltip(`暴風域（円近似・半径最大 ${p.stormWindRadiusKm} km）`).addTo(layerStorm);
    if(timeAvailable&&p.strongWindRadiusKm)L.circle([p.lat,p.lon],{radius:p.strongWindRadiusKm*1000,color:"#f0c400",weight:2,fillColor:"#f0c400",fillOpacity:.08}).bindTooltip(`強風域（円近似・半径最大 ${p.strongWindRadiusKm} km）`).addTo(layerStrong);
  });
  if(timeAvailable){
    const warningArea=warningCorridor(points);
    if(warningArea&&warningArea.length>=4){
      L.polygon(warningArea,{color:"#9b59b6",weight:2,dashArray:"7 4",fillColor:"#9b59b6",fillOpacity:.08})
        .bindTooltip("暴風域円の外縁を接続した近似領域（予報円は対象外）").addTo(layerWarning);
    }
    // Purple boundary is based on the red storm-wind circles (stormWindRadiusKm), not the orange forecast circles.
    points.forEach(p=>{if(p.stormWindRadiusKm)L.circle([p.lat,p.lon],{radius:p.stormWindRadiusKm*1000,color:"#9b59b6",weight:1.5,dashArray:"6 4",fillColor:"#9b59b6",fillOpacity:.025}).bindTooltip(`暴風域円の外縁接続対象（半径 ${p.stormWindRadiusKm} km）`).addTo(layerWarning);});
  }
  syncOverlayLayers();
  routeLayer=L.polyline(points.map(p=>[p.lat,p.lon]),{color:"#ff5b5b",weight:4,opacity:.9}).addTo(map);
  const pointLayers=[];
  points.forEach(p=>{
    const q=calculatePoint(p);
    pointLayers.push(L.circleMarker([q.lat,q.lon],{radius:5,color:"#fff",weight:1,fillColor:"#ff5b5b",fillOpacity:1})
      .bindPopup(`${timeAvailable?fmtTime(p.time):"時刻情報なし"}<br>父島から ${q.distance.toFixed(1)} km`));

  });
  pointsLayer=L.layerGroup(pointLayers).addTo(map);
  if(nearest) {
    nearestMarker=L.marker([nearest.lat,nearest.lon]).addTo(map)
      .bindPopup(`<b>父島への最接近（推定）</b><br>${timeAvailable&&nearest.time?fmtTime(nearest.time):"時刻データなし"}<br>${nearest.distance.toFixed(1)} km`);
  }
  updateMetrics(points,nearest,timeAvailable,currentInfo);
  renderTable(points,timeAvailable);
  map.fitBounds(routeLayer.getBounds().extend([STATION.lat,STATION.lon]),{padding:[35,35]});
  $("disclaimer").textContent = timeAvailable
    ? "気象庁公開JSONから取得した台風中心位置です。最接近時刻・距離は経路点間の線形補間による推定値です。公式発表の予報・警報を代替しません。"
    : "過去経路の座標データを表示しています。時刻が含まれないため、最接近時刻は算出していません。公式情報の代替ではありません。";
}
function parseSpecifications(spec) {
  const title=spec.find(x=>x.part==="title")||{};
  const points=spec.filter(x=>x.position?.deg && Array.isArray(x.position.deg) && x.position.deg.length>=2)
    .map(x=>({
      lat:Number(x.position.deg[0]), lon:Number(x.position.deg[1]),
      time:x.validtime?.JST || x.validtime?.UTC || null,
      advancedHours:safeNum(x.advancedHours),
      part:typeof x.part==="object"?(x.part.jp||x.part.en||""):String(x.part||""),
      pressure:x.pressure,
      radiusKm:safeNum(x.probabilityCircleRadius?.km),
      stormWindRadiusKm:getRadius(x,["stormWindRadius","stormWindArea","windArea50kt","radius50kt"]) || getJmaWindAreaMaxRadius(x.stormWarning),
      strongWindRadiusKm:getRadius(x,["strongWindRadius","strongWindArea","windArea30kt","radius30kt"]) || getJmaWindAreaMaxRadius(x.galeWarning),
      stormWarningRadiusKm:warningRadiusFromSpec(x),
      stormWindDirectional:getDirectionalRadius(x,["stormWindRadius","stormWindArea","windArea50kt","radius50kt"]) || parseJmaWindArea(x.stormWarning),
      strongWindDirectional:getDirectionalRadius(x,["strongWindRadius","strongWindArea","windArea30kt","radius30kt"]) || parseJmaWindArea(x.galeWarning),
      wind:x.maximumWind?.sustained?.["m/s"],
      intensity:x.intensity, category:x.category?.jp||x.category?.en
    }))
    .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  return {title,points};
}
function stormInfo(specTitle, points) {
  const current=points.find(p=>p.advancedHours===0)||points[0];
  return {
    pressure:current?.pressure,
    wind:current?.wind,
    name:specTitle.name?.jp || specTitle.name?.en || "",
    nameEn:specTitle.name?.en || "",
    current
  };
}

const JMA_INFO_LIST = "https://www.jma.go.jp/bosai/information/data/r8/information.json";
const JMA_INFO_DETAIL = "https://www.jma.go.jp/bosai/information/data/r8/denbun/";
function escapeHTML(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function reportTyphoonNumber(tc){
  const raw=String(tc?.typhoonNumber??"");
  const match=raw.match(/(\d{1,2})$/);
  return match?Number(match[1]):null;
}
function eventHint(text, reportDatetime){
  const normalized=String(text||"").replace(/<br\s*\/?>/gi,"\n");
  const lines=normalized.split(/\n|(?=［|【)/).map(x=>x.trim()).filter(Boolean);
  const patterns=[
    {label:"熱帯低気圧の発生に関する記述",re:/熱帯低気圧.{0,30}(発生|形成)|熱帯低気圧が発生/},
    {label:"台風への発達に関する記述",re:/台風第?\s*\d{1,2}号.{0,35}(発生|発達|なりました)|台風に発達|台風となりました|台風になりました/},
    {label:"台風発生に関する記述",re:/台風.{0,20}(発生しました|発生)/}
  ];
  const out=[];
  for(const p of patterns){
    const found=lines.find(line=>p.re.test(line));
    if(found) out.push({label:p.label,text:found.slice(0,380)});
  }
  return out;
}
async function loadJmaBulletinHistory(tc){
  const node=$("genesisTimeline");
  if(!node) return;
  const typhoonNo=reportTyphoonNumber(tc);
  if(!typhoonNo){node.textContent="台風番号を取得できないため、情報検索をスキップしました。";return;}
  node.innerHTML="<p>気象庁の全般台風情報・全般気象解説情報一覧を検索中…</p>";
  try{
    const list=await getJSON(JMA_INFO_LIST);
    if(!Array.isArray(list)) throw new Error("情報一覧JSONの形式が配列ではありません");
    const numberText=`台風第${typhoonNo}号`;
    const candidates=list.filter(item=>{
      const title=String(item.headTitle||"");
      const ctl=String(item.controlTitle||"");
      const isTyphoonGeneral=ctl.includes("全般台風情報") || ctl.includes("全般気象解説情報");
      return isTyphoonGeneral && title.includes("台風") &&
        (title.includes(numberText) || title.includes(`台風${typhoonNo}号`));
    }).sort((a,b)=>new Date(b.reportDatetime)-new Date(a.reportDatetime));
    if(!candidates.length){
      node.innerHTML=`<p>一覧JSON内に「${escapeHTML(numberText)}」の全般気象解説情報は見つかりませんでした。</p><p><a target="_blank" rel="noopener" href="https://www.jma.go.jp/bosai/information/#format=table&area_type=japan&area_code=010000">気象庁公式情報一覧を開く</a></p>`;
      return;
    }
    const details=await Promise.all(candidates.slice(0,12).map(async item=>{
      try{
        const d=await getJSON(`${JMA_INFO_DETAIL}${encodeURIComponent(item.jsonName)}.json`);
        return {meta:item,detail:d};
      }catch(e){return {meta:item,detail:null,error:e.message};}
    }));
    const reportRows=details.map(({meta,detail,error})=>{
      const dt=meta.reportDatetime?fmtTime(meta.reportDatetime):"発表時刻不明";
      const title=meta.headTitle||"全般気象解説情報";
      const text=detail?.commentText||detail?.headlineText||"本文データを取得できませんでした。";
      const hints=eventHint(text,meta.reportDatetime);
      const hintHtml=hints.length?hints.map(h=>`<div class="genesis-hint"><b>${escapeHTML(h.label)}</b><p>${escapeHTML(h.text)}</p></div>`).join(""):"";
      return `<article class="genesis-report"><h3>${escapeHTML(title)} 第${escapeHTML(meta.serial||"—")}号</h3><small>${escapeHTML(dt)} · ${escapeHTML(meta.publishingOffice||"気象庁")} · ${escapeHTML(meta.infoType||"")}</small>
        <p>${escapeHTML(detail?.headlineText||"")}</p>${hintHtml}
        <details><summary>情報本文を表示</summary><div class="genesis-body">${String(text).replace(/<br\s*\/?>/gi,"\n").split("\n").map(escapeHTML).join("<br>")}</div></details>
        <p><a href="https://www.jma.go.jp/bosai/information/#area_type=japan&info_id=${encodeURIComponent(meta.jsonName)}&format=text&area_code=010000&japan_page=0" target="_blank" rel="noopener">気象庁で本文を確認</a></p>
        ${error?`<small>取得エラー: ${escapeHTML(error)}</small>`:""}</article>`;
    }).join("");
    node.innerHTML=`<p>気象庁情報一覧JSONから ${candidates.length} 件を検出（表示は最大12件）。発表日時は電文の発表時刻であり、台風の発生時刻とは区別しています。</p>${reportRows}
      <small>発生・発達時刻は本文に明記された記述を手掛かりとして表示します。記述が見つからない場合、発表日時を発生時刻として代用しません。</small>`;
  }catch(error){
    node.innerHTML=`<p>気象庁情報一覧JSONの取得に失敗しました：${escapeHTML(error.message)}</p><p>Safariの通信/CORS制限、または気象庁内部JSONの仕様変更の可能性があります。</p><a href="https://www.jma.go.jp/bosai/information/#format=table&area_type=japan&area_code=010000" target="_blank" rel="noopener">気象庁公式一覧を開く</a>`;
  }
}


// Forecast history archive: generated by scripts/archive_forecasts.py / GitHub Actions.
let forecastArchiveIndex = null;
let selectedArchiveSnapshot = null;
async function loadForecastArchiveOptions(code){
  const select=$("forecastHistorySelect");
  const status=$("forecastHistoryStatus");
  select.innerHTML="";
  selectedArchiveSnapshot=null;
  try{
    if(!forecastArchiveIndex){
      const response=await fetch("data/archive/index.json",{cache:"no-store"});
      if(!response.ok) throw new Error(`履歴index HTTP ${response.status}`);
      forecastArchiveIndex=await response.json();
    }
    const snapshots=forecastArchiveIndex?.storms?.[code]?.snapshots||[];
    if(!snapshots.length){
      select.innerHTML='<option value="">この台風の保存履歴はありません</option>';
      status.textContent="履歴はGitHub Actions等で収集開始した後に蓄積されます。";
      return;
    }
    snapshots.slice().reverse().forEach((s,i)=>{
      const opt=document.createElement("option");
      opt.value=String(snapshots.length-1-i);
      const captured=s.capturedAt?fmtTime(s.capturedAt):"取得時刻不明";
      const issued=s.sourceIssueTime?` / 発表 ${fmtTime(s.sourceIssueTime)}`:"";
      opt.textContent=`${captured}${issued}`;
      select.appendChild(opt);
    });
    status.textContent=`保存履歴 ${snapshots.length} 件。取得時刻と気象庁発表時刻は別表示です。`;
    select.dataset.archiveCode=code;
    select.dataset.archiveLength=String(snapshots.length);
  }catch(e){
    select.innerHTML='<option value="">保存履歴を読み込めません</option>';
    status.textContent="履歴indexが未作成、未公開、または通信エラーです。自動収集開始前は正常です。";
  }
}
async function showSelectedArchivedForecast(){
  const select=$("forecastHistorySelect");
  const code=select.dataset.archiveCode;
  if(!code||!forecastArchiveIndex){$("forecastHistoryStatus").textContent="この台風の保存履歴がありません。";return;}
  const snapshots=forecastArchiveIndex?.storms?.[code]?.snapshots||[];
  const index=Number(select.value);
  const entry=snapshots[index];
  if(!entry){$("forecastHistoryStatus").textContent="履歴スナップショットを選択してください。";return;}
  try{
    $("forecastHistoryStatus").textContent="過去予報を取得中…";
    const response=await fetch(`data/archive/${entry.file}`,{cache:"no-store"});
    if(!response.ok)throw new Error(`snapshot HTTP ${response.status}`);
    const snapshot=await response.json();
    const parsed=parseSpecifications(snapshot.specifications||[]);
    const forecast=parsed.points.filter(p=>p.time && (p.advancedHours!==null && p.advancedHours>0));
    historicalForecastLayer.clearLayers();
    if(!forecast.length){
      $("forecastHistoryStatus").textContent="この保存時点に未来の予報位置がありません。";
      return;
    }
    const coords=forecast.map(p=>[p.lat,p.lon]);
    L.polyline(coords,{color:"#f59e0b",weight:3,dashArray:"8 6",opacity:.95})
      .bindTooltip(`過去予報 · ${fmtTime(snapshot.capturedAt)}`).addTo(historicalForecastLayer);
    forecast.forEach(p=>{
      L.circleMarker([p.lat,p.lon],{radius:4,color:"#7c4300",weight:1,fillColor:"#f59e0b",fillOpacity:.95})
        .bindPopup(`過去予報位置<br>${p.time?fmtTime(p.time):"時刻不明"}<br>取得時刻 ${fmtTime(snapshot.capturedAt)}`)
        .addTo(historicalForecastLayer);
      if(p.radiusKm)L.circle([p.lat,p.lon],{radius:p.radiusKm*1000,color:"#f59e0b",dashArray:"4 5",fillOpacity:.025}).addTo(historicalForecastLayer);
    });
    $("forecastHistoryStatus").textContent=`過去予報を重ねています：取得 ${fmtTime(snapshot.capturedAt)} / 発表 ${snapshot.sourceIssueTime?fmtTime(snapshot.sourceIssueTime):"不明"}。黄破線＝過去予報。`;
  }catch(e){
    $("forecastHistoryStatus").textContent=`過去予報の読み込み失敗：${e.message}`;
  }
}
$("showForecastHistory")?.addEventListener("click",showSelectedArchivedForecast);
$("clearForecastHistory")?.addEventListener("click",()=>{
  historicalForecastLayer.clearLayers();
  $("forecastHistoryStatus").textContent="過去予報の重ね描きを解除しました。";
});


async function compareForecastSnapshots(){
  const status=$("forecastCompareStatus"), rows=$("forecastCompareRows"), chart=$("forecastDistanceChart");
  rows.innerHTML=""; chart.innerHTML="";
  const code=$("forecastHistorySelect")?.dataset.archiveCode;
  if(!code){status.textContent="台風を選択して、履歴が存在する状態で実行してください。";return;}
  try{
    if(!forecastArchiveIndex){
      const r=await fetch("data/archive/index.json",{cache:"no-store"});
      if(!r.ok)throw new Error(`index HTTP ${r.status}`);
      forecastArchiveIndex=await r.json();
    }
    const entries=(forecastArchiveIndex?.storms?.[code]?.snapshots||[]).slice(-36);
    if(entries.length<2){status.textContent=`比較できる履歴が${entries.length}件です。予報スナップショットが2件以上必要です。`;return;}
    status.textContent=`${entries.length}件の予報履歴を計算中…`;
    const records=[];
    for(const entry of entries){
      try{
        const response=await fetch(`data/archive/${entry.file}`,{cache:"no-store"});
        if(!response.ok)continue;
        const snapshot=await response.json();
        const parsed=parseSpecifications(snapshot.specifications||[]);
        const issue=snapshot.sourceIssueTime || parsed.points.find(p=>p.advancedHours===0)?.time || null;
        const forecast=parsed.points.filter(p=>p.time && (
          p.advancedHours!==null ? p.advancedHours>0 :
          issue ? new Date(p.time)>new Date(issue) : false
        ));
        if(!forecast.length)continue;
        const nearest=nearestApproach(forecast);
        if(!nearest)continue;
        records.push({capturedAt:snapshot.capturedAt,issue,nearest,forecastCount:forecast.length});
      }catch(e){console.warn("forecast snapshot comparison skipped",entry.file,e);}
    }
    if(!records.length){status.textContent="過去予報位置を抽出できませんでした。JMA specifications.json のデータ形式を確認してください。";return;}
    rows.innerHTML=records.map(r=>`<tr><td>${escapeHTML(fmtTime(r.capturedAt))}</td><td>${escapeHTML(r.issue?fmtTime(r.issue):"不明")}</td><td><strong>${r.nearest.distance.toFixed(1)} km</strong></td><td>${escapeHTML(r.nearest.time?fmtTime(r.nearest.time):"時刻不明")}</td></tr>`).join("");
    // Lightweight SVG line chart: distance by capture time (chronological).
    const W=760,H=230,L=58,R=18,T=18,B=42;
    const vals=records.map(r=>r.nearest.distance), min=Math.min(...vals), max=Math.max(...vals);
    const yMin=Math.max(0,Math.floor((min-10)/10)*10), yMax=Math.ceil((max+10)/10)*10 || 100;
    const x=i=>L+i*(W-L-R)/Math.max(1,records.length-1);
    const y=v=>H-B-(v-yMin)/(yMax-yMin||1)*(H-T-B);
    const poly=records.map((r,i)=>`${x(i)},${y(r.nearest.distance)}`).join(" ");
    const ticks=5;
    const grid=Array.from({length:ticks},(_,i)=>{
      const val=yMin+(yMax-yMin)*i/(ticks-1), yy=y(val);
      return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#d8e1e8"/><text x="${L-8}" y="${yy+4}" text-anchor="end" font-size="11" fill="#657787">${val.toFixed(0)}</text>`;
    }).join("");
    const points=records.map((r,i)=>`<circle cx="${x(i)}" cy="${y(r.nearest.distance)}" r="4" fill="#f59e0b"><title>${fmtTime(r.capturedAt)} : ${r.nearest.distance.toFixed(1)} km</title></circle>`).join("");
    const xLabels=[0,Math.floor((records.length-1)/2),records.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text x="${x(i)}" y="${H-12}" text-anchor="${i===0?"start":i===records.length-1?"end":"middle"}" font-size="11" fill="#657787">${escapeHTML(fmtTime(records[i].capturedAt))}</text>`).join("");
    chart.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="予報初期値ごとの最接近距離グラフ">${grid}<polyline points="${poly}" fill="none" stroke="#f59e0b" stroke-width="3"/>${points}${xLabels}<text x="14" y="14" font-size="12" fill="#657787">距離 km</text></svg>`;
    status.textContent=`${records.length}件の保存予報を比較しました。横軸＝取得時刻、縦軸＝予報経路から算出した父島への最接近距離。予報の当時の発表時刻と取得時刻が異なる場合があります。`;
  }catch(e){status.textContent=`履歴比較エラー：${e.message}`;}
}
$("compareForecastHistory")?.addEventListener("click",compareForecastSnapshots);

async function loadLiveList() {
  setStatus("気象庁の台風リストを取得中…");
  typhoonSelect.innerHTML="";
  try {
    activeTcs=await getJSON(`${JMA}/targetTc.json`);
    if(!Array.isArray(activeTcs)||!activeTcs.length) {
      typhoonSelect.innerHTML='<option value="">発表中の台風・熱帯低気圧はありません</option>';
      setStatus("現在、気象庁の発表中台風はありません");
      $("stormTitle").textContent="発表中の台風なし";
      drawTrack([], "", true);
      return;
    }
    activeTcs.forEach((tc,i)=>{
      const option=document.createElement("option");
      option.value=tc.tropicalCyclone;
      option.textContent=`${typhoonLabel(tc)}${tc.category==="TD"?"（熱帯低気圧）":""} · ${tc.tropicalCyclone}`;
      typhoonSelect.appendChild(option);
    });
    setStatus(`気象庁発表中 ${activeTcs.length} 件 · ${new Date().toLocaleString("ja-JP")}`);
    await loadSelectedLive();
  } catch(error) {
    setStatus(`気象庁データの取得に失敗：${error.message}。通信/CORS/JSON形式を確認してください。`,true);
    $("stormTitle").textContent="データ取得エラー";
    $("disclaimer").textContent="気象庁サイトの公開JSON取得に失敗しました。ページを再読み込みするか、気象庁公式台風情報を直接確認してください。";
  }
}
async function loadSelectedLive() {
  const code=typhoonSelect.value;
  const tc=activeTcs.find(x=>x.tropicalCyclone===code);
  if(!tc) return;
  setStatus(`${typhoonLabel(tc)} の予報データを取得中…`);
  try {
    const specs=await getJSON(`${JMA}/${encodeURIComponent(code)}/specifications.json`);
    const parsed=parseSpecifications(specs);
    const info=stormInfo(parsed.title,parsed.points);
    currentStorm={tc,info,parsed};
    await loadForecastArchiveOptions(code);
    $("stormTitle").textContent=`${typhoonLabel(tc)} ${info.name?`「${info.name}」`:""} / ${code}`;
    $("stormSubtitle").textContent=`発表時刻：${tc.issue?fmtTime(tc.issue):"不明"} · ${info.current?.category||tc.category||"台風情報"}`;
    const points=parsed.points.filter(p=>p.time);
    drawTrack(points,typhoonLabel(tc),true,info);
    await loadJmaBulletinHistory(tc);
    setStatus(`気象庁公開データを表示中 · ${tc.issue?fmtTime(tc.issue):"発表時刻不明"}`);
  } catch(error) {
    setStatus(`台風データ取得エラー：${error.message}`,true);
    $("stormTitle").textContent=typhoonLabel(tc);
  }
}
async function loadPastTracks() {
  setStatus("過去台風の経路一覧を取得中…");
  try {
    const past=await getJSON(`${JMA}/pastTracks.json`);
    if(!Array.isArray(past)||!past.length) throw new Error("過去経路データが空です");
    activeTcs=past;
    typhoonSelect.innerHTML="";
    past.forEach(tc=>{
      const option=document.createElement("option");
      option.value=tc.tropicalCyclone;
      option.textContent=`${typhoonLabel(tc)} · ${tc.tropicalCyclone}`;
      typhoonSelect.appendChild(option);
    });
    await loadSelectedPast();
  } catch(error) {
    setStatus(`過去経路取得エラー：${error.message}`,true);
  }
}
async function loadSelectedPast() {
  const tc=activeTcs.find(x=>x.tropicalCyclone===typhoonSelect.value);
  if(!tc) return;
  $("stormTitle").textContent=`${typhoonLabel(tc)} / ${tc.tropicalCyclone}（過去経路）`;
  $("stormSubtitle").textContent="気象庁 pastTracks.json · 経路点に日時情報は含まれていません";
  const all=[];
  Object.keys(tc).filter(k=>/^track\d+$/.test(k)).sort().forEach(key=>{
    const track=tc[key];
    const coords=[...(track.preTyphoon||[]),...(track.typhoon||[])];
    coords.forEach(([lat,lon])=>{if(Number.isFinite(lat)&&Number.isFinite(lon))all.push({lat,lon,time:null});});
  });
  drawTrack(all,typhoonLabel(tc),false);
  setStatus(`過去台風経路データ · ${tc.tropicalCyclone}`);
}
trackTypeSelect.addEventListener("change",async()=>{
  historical=trackTypeSelect.value==="besttrack";
  typhoonSelect.innerHTML="";
  if(historical) await loadPastTracks(); else await loadLiveList();
});
typhoonSelect.addEventListener("change",()=>historical?loadSelectedPast():loadSelectedLive());
// Refresh live JMA data every hour while this page is open.
// The remote GitHub Actions collector is responsible for archive snapshots when
// the browser is closed; client refresh does not replace server-side archiving.
async function refreshLiveDataPreservingSelection(){
  if(historical || trackTypeSelect.value==="besttrack")return;
  const selectedCode=typhoonSelect.value;
  try{
    const latest=await getJSON(`${JMA}/targetTc.json`);
    if(!Array.isArray(latest))throw new Error("台風リストの形式が不正です");
    activeTcs=latest;
    const options=latest.map(tc=>`<option value="${escapeHTML(tc.tropicalCyclone)}">${escapeHTML(typhoonLabel(tc))}</option>`).join("");
    typhoonSelect.innerHTML=options;
    const nextCode=latest.some(tc=>tc.tropicalCyclone===selectedCode)?selectedCode:(latest[0]?.tropicalCyclone||"");
    typhoonSelect.value=nextCode;
    if(nextCode)await loadSelectedLive();
    setStatus(`気象庁データを自動更新しました · ${fmtTime(new Date().toISOString())}`);
  }catch(error){
    setStatus(`自動更新失敗（次回再試行します）：${error.message}`,true);
  }
}
setInterval(refreshLiveDataPreservingSelection,60*60*1000);
$("fitButton").addEventListener("click",()=>{
  if(routeLayer) map.fitBounds(routeLayer.getBounds().extend([STATION.lat,STATION.lon]),{padding:[35,35]});
  else map.setView([STATION.lat,STATION.lon],5);
});
loadLiveList();


// One-page municipal briefing PDF via browser print dialog.
// Users can select which information blocks appear in the report.
function escHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}
function makeRouteSvg(points, pdfLayers={strongWind:true,stormWind:true,stormWarning:true}) {
  if(!points?.length) return '<p class="pdf-muted">位置データなし</p>';
  const W=620,H=260,pad=28;
  const warning=pdfLayers.stormWarning ? warningCorridor(points) : null;
  const radiusPts=points.filter(p=>Number.isFinite(p.stormWindRadiusKm)&&p.stormWindRadiusKm>0);
  const meanLat=points.reduce((a,p)=>a+p.lat,0)/Math.max(1,points.length);
  const kmLat=111.32, kmLon=111.32*Math.cos(meanLat*Math.PI/180);
  const radiusBounds=[];
  points.forEach(p=>{
    const r=Math.max(0,p.radiusKm||0,p.stormWindRadiusKm||0,p.strongWindRadiusKm||0,p.stormWarningRadiusKm||0);
    if(r>0)radiusBounds.push([p.lat-r/kmLat,p.lat+r/kmLat,p.lon-r/kmLon,p.lon+r/kmLon]);
  });
  const lats=points.map(p=>p.lat).concat([STATION.lat],warning?warning.map(p=>p[0]):[],radiusBounds.flatMap(b=>b.slice(0,2)));
  const lons=points.map(p=>p.lon).concat([STATION.lon],warning?warning.map(p=>p[1]):[],radiusBounds.flatMap(b=>b.slice(2,4)));
  let minLat=Math.min(...lats),maxLat=Math.max(...lats),minLon=Math.min(...lons),maxLon=Math.max(...lons);
  if(maxLat-minLat<.2){minLat-=.1;maxLat+=.1;} if(maxLon-minLon<.2){minLon-=.1;maxLon+=.1;}
  const x=lon=>pad+(lon-minLon)/(maxLon-minLon)*(W-pad*2);
  const y=lat=>H-pad-(lat-minLat)/(maxLat-minLat)*(H-pad*2);
  const poly=points.map(p=>`${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`).join(" ");
  const station=`${x(STATION.lon).toFixed(1)},${y(STATION.lat).toFixed(1)}`;
  const circles=points.map(p=>`<circle cx="${x(p.lon)}" cy="${y(p.lat)}" r="3.5" fill="#e45b58"/>`).join("");
  // Render the actual radius overlays in the PDF route chart too. SVG ellipses
  // account for the chart's independent longitude/latitude scales.
  const kmLatSvg=111.32, kmLonSvg=111.32*Math.cos(((minLat+maxLat)/2)*Math.PI/180);
  const radiusEllipse=(p,r,color,dash,fillOpacity)=>{
    if(!Number.isFinite(r)||r<=0)return "";
    const rx=(r/kmLonSvg)/(maxLon-minLon)*(W-pad*2), ry=(r/kmLatSvg)/(maxLat-minLat)*(H-pad*2);
    return `<ellipse cx="${x(p.lon)}" cy="${y(p.lat)}" rx="${Math.max(1,rx).toFixed(1)}" ry="${Math.max(1,ry).toFixed(1)}" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="1.5" ${dash?`stroke-dasharray="${dash}"`:""}/>`;
  };
  const radiusSvg=points.map(p=>[
    pdfLayers.stormWind ? radiusEllipse(p,p.stormWindRadiusKm,"#e53935","",.06) : "",
    pdfLayers.strongWind ? radiusEllipse(p,p.strongWindRadiusKm,"#f0c400","",.045) : ""
  ].join("")).join("");
  const warningEnvelopeSvg=warning&&warning.length>=4?`<polygon points="${warning.map(p=>`${x(p[1]).toFixed(1)},${y(p[0]).toFixed(1)}`).join(" ")}" fill="#9b59b6" fill-opacity=".12" stroke="#9b59b6" stroke-width="2" stroke-dasharray="6 4"/>`:"";
  const warningCirclesSvg=pdfLayers.stormWarning ? radiusPts.map(p=>radiusEllipse(p,p.stormWindRadiusKm,"#9b59b6","5 3",.025)).join("") : "";
  const warningSvg=warningEnvelopeSvg+warningCirclesSvg;
  const stationMarker=`<circle cx="${x(STATION.lon)}" cy="${y(STATION.lat)}" r="6" fill="#168bd2" stroke="#fff" stroke-width="2"/>`;
  return `<svg class="pdf-route" viewBox="0 0 ${W} ${H}" role="img" aria-label="台風経路と暴風警戒域の模式図">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#f1f6fa" rx="8"/>
    <g stroke="#d3e0e9" stroke-width="1">${[1,2,3,4].map(i=>`<line x1="${pad}" y1="${pad+i*(H-pad*2)/5}" x2="${W-pad}" y2="${pad+i*(H-pad*2)/5}"/>`).join("")}${[1,2,3,4].map(i=>`<line x1="${pad+i*(W-pad*2)/5}" y1="${pad}" x2="${pad+i*(W-pad*2)/5}" y2="${H-pad}"/>`).join("")}</g>
    ${warningSvg}${radiusSvg}<polyline points="${poly}" fill="none" stroke="#e45b58" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>${circles}${stationMarker}
    <text x="${x(STATION.lon)+10}" y="${y(STATION.lat)-9}" font-size="12" fill="#12689f" font-weight="700">父島アメダス</text>
    <text x="${pad}" y="${H-7}" font-size="10" fill="#526778">${minLon.toFixed(1)}°E — ${maxLon.toFixed(1)}°E / ${minLat.toFixed(1)}°N — ${maxLat.toFixed(1)}°N</text>
  </svg>`;
}
function makeTrackTable(points,timeAvailable=true) {
  if(!points?.length) return '<p class="pdf-muted">経路データなし</p>';
  const rows=points.map((p,i)=>{
    const m=movementText(points,i,timeAvailable);
    const time=timeAvailable&&p.time?fmtTime(p.time):"日時情報なし";
    return `<tr><td>${escHtml(time)}</td><td>${p.lat.toFixed(2)}°N</td><td>${p.lon.toFixed(2)}°E</td><td>${escHtml(m.speed)}</td><td>${escHtml(m.direction)}</td></tr>`;
  }).join("");
  return `<div class="pdf-table-wrap"><table class="pdf-track-table"><thead><tr><th>日時（JST）</th><th>緯度</th><th>経度</th><th>移動速度</th><th>移動方向</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}


function mercatorY(lat){
  const rad=Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180;
  return (1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2;
}
function lonTileX(lon,z){return (lon+180)/360*Math.pow(2,z);}
function latTileY(lat,z){return mercatorY(lat)*Math.pow(2,z);}
function pdfMapTileUrl(x,y,z,topo){
  const n=Math.pow(2,z); x=((x%n)+n)%n;
  return topo
    ? `https://${["a","b","c"][Math.abs(x+y)%3]}.tile.opentopomap.org/${z}/${x}/${y}.png`
    : `https://${["a","b","c"][Math.abs(x+y)%3]}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}
function loadPdfTile(url){
  return new Promise(resolve=>{
    const img=new Image(); img.crossOrigin="anonymous";
    img.onload=()=>resolve(img); img.onerror=()=>resolve(null); img.src=url;
  });
}
async function makePdfMapImage(points,pdfLayers){
  const W=1200,H=650;
  const valid=(points||[]).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  if(!valid.length)return "";
  const allLat=valid.map(p=>p.lat).concat([STATION.lat]);
  const allLon=valid.map(p=>p.lon).concat([STATION.lon]);
  // Include selected wind radii in the geographic extent.
  valid.forEach(p=>{
    const rs=[pdfLayers.strongWind?p.strongWindRadiusKm:0,pdfLayers.stormWind?p.stormWindRadiusKm:0,pdfLayers.stormWarning?p.stormWindRadiusKm:0].filter(r=>Number.isFinite(r)&&r>0);
    const r=Math.max(0,...rs);
    if(r){allLat.push(p.lat-r/111.32,p.lat+r/111.32);allLon.push(p.lon-r/(111.32*Math.max(.2,Math.cos(p.lat*Math.PI/180))),p.lon+r/(111.32*Math.max(.2,Math.cos(p.lat*Math.PI/180))));}
  });
  let minLat=Math.min(...allLat),maxLat=Math.max(...allLat),minLon=Math.min(...allLon),maxLon=Math.max(...allLon);
  const latPad=Math.max(.7,(maxLat-minLat)*.12),lonPad=Math.max(.8,(maxLon-minLon)*.12);
  minLat=Math.max(-80,minLat-latPad);maxLat=Math.min(80,maxLat+latPad);minLon-=lonPad;maxLon+=lonPad;
  // Fit the geographic rectangle into a landscape map image.
  const top=mercatorY(maxLat),bottom=mercatorY(minLat);
  const xNorm=lon=> (lon-minLon)/(maxLon-minLon);
  const yNorm=lat=> (mercatorY(lat)-top)/(bottom-top);
  const px=lon=>xNorm(lon)*W, py=lat=>yNorm(lat)*H;
  const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext("2d");ctx.fillStyle="#e5edf0";ctx.fillRect(0,0,W,H);
  const topo=!!baseMapCheckbox?.checked;
  // Pick a tile zoom suitable for the extent and output size.
  const z=Math.max(3,Math.min(topo?9:10,Math.floor(Math.log2(W/(maxLon-minLon)*360/256))));
  const n=Math.pow(2,z),x0=lonTileX(minLon,z),x1=lonTileX(maxLon,z),y0=latTileY(maxLat,z),y1=latTileY(minLat,z);
  const tx0=Math.floor(x0),tx1=Math.floor(x1),ty0=Math.floor(y0),ty1=Math.floor(y1);
  const jobs=[];
  for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){
    const img=await loadPdfTile(pdfMapTileUrl(tx,ty,z,topo));
    if(!img)continue;
    const left=(tx-x0)/(x1-x0)*W, right=(tx+1-x0)/(x1-x0)*W;
    const t=(ty-y0)/(y1-y0)*H, b=(ty+1-y0)/(y1-y0)*H;
    ctx.drawImage(img,left,t,right-left,b-t);
  }
  // Geographic grid
  ctx.strokeStyle="rgba(40,70,90,.35)";ctx.lineWidth=1;ctx.setLineDash([5,5]);
  const latStep=(maxLat-minLat)>12?2:(maxLat-minLat)>5?1:.5;
  const lonStep=(maxLon-minLon)>20?5:(maxLon-minLon)>8?2:1;
  for(let lat=Math.ceil(minLat/latStep)*latStep;lat<=maxLat;lat+=latStep){ctx.beginPath();ctx.moveTo(0,py(lat));ctx.lineTo(W,py(lat));ctx.stroke();}
  for(let lon=Math.ceil(minLon/lonStep)*lonStep;lon<=maxLon;lon+=lonStep){ctx.beginPath();ctx.moveTo(px(lon),0);ctx.lineTo(px(lon),H);ctx.stroke();}
  ctx.setLineDash([]);
  const radius=(p,r,color,fill,dash=[])=>{
    if(!Number.isFinite(r)||r<=0)return;
    const latRadius=r/111.32,lonRadius=r/(111.32*Math.max(.2,Math.cos(p.lat*Math.PI/180)));
    const rx=Math.abs(px(p.lon+lonRadius)-px(p.lon)),ry=Math.abs(py(p.lat+latRadius)-py(p.lat));
    ctx.beginPath();ctx.ellipse(px(p.lon),py(p.lat),Math.max(1,rx),Math.max(1,ry),0,0,Math.PI*2);
    ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);
  };
  // Storm-warning corridor independent from visible storm circles.
  if(pdfLayers.stormWarning){
    const warning=warningCorridor(valid);
    if(warning?.length>=4){
      ctx.beginPath();warning.forEach((p,i)=>i?ctx.lineTo(px(p[1]),py(p[0])):ctx.moveTo(px(p[1]),py(p[0])));ctx.closePath();
      ctx.fillStyle="rgba(155,89,182,.15)";ctx.fill();ctx.strokeStyle="#9b59b6";ctx.lineWidth=3;ctx.setLineDash([9,6]);ctx.stroke();ctx.setLineDash([]);
    }
  }
  valid.forEach(p=>{
    if(pdfLayers.strongWind)radius(p,p.strongWindRadiusKm,"#d8a900","rgba(240,196,0,.12)");
    if(pdfLayers.stormWind)radius(p,p.stormWindRadiusKm,"#d92323","rgba(229,57,53,.12)");
  });
  if(valid.length>1){
    ctx.beginPath();valid.forEach((p,i)=>i?ctx.lineTo(px(p.lon),py(p.lat)):ctx.moveTo(px(p.lon),py(p.lat)));
    ctx.strokeStyle="#e44d4d";ctx.lineWidth=5;ctx.stroke();
  }
  valid.forEach(p=>{ctx.beginPath();ctx.arc(px(p.lon),py(p.lat),7,0,Math.PI*2);ctx.fillStyle="#e44d4d";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();});
  ctx.beginPath();ctx.arc(px(STATION.lon),py(STATION.lat),10,0,Math.PI*2);ctx.fillStyle="#168bd2";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.stroke();
  ctx.font="bold 20px sans-serif";ctx.fillStyle="#075b8d";ctx.fillText("父島アメダス",px(STATION.lon)+14,py(STATION.lat)-12);
  ctx.font="16px sans-serif";ctx.fillStyle="#233";ctx.fillText(`${minLon.toFixed(1)}°E–${maxLon.toFixed(1)}°E / ${minLat.toFixed(1)}°N–${maxLat.toFixed(1)}°N`,16,H-15);
  return canvas.toDataURL("image/png");
}

async function buildPdfReport() {
  const selected = {
    past: $("pdfPastTrack").checked,
    forecast: $("pdfForecast").checked,
    time: $("pdfClosestTime").checked,
    distance: $("pdfClosestDistance").checked,
    direction: $("pdfClosestDirection").checked,
    strongWind: $("pdfStrongWind").checked,
    stormWind: $("pdfStormWind").checked,
    stormWarning: $("pdfStormWarning").checked
  };
  const pdfLayers={strongWind:selected.strongWind,stormWind:selected.stormWind,stormWarning:selected.stormWarning};
  if(!Object.values(selected).some(Boolean)) {
    alert("PDFに掲載する項目を1つ以上選択してください。"); return false;
  }
  const mapDataUrl=await makePdfMapImage(renderedTrack,pdfLayers);
  const title=$("stormTitle").textContent || "台風情報";
  const issued=$("stormSubtitle").textContent || "";
  const now=new Date().toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
  const isPast=historical;
  const blocks=[];
  if(selected.past && isPast) blocks.push(`<section><h2>過去の台風経路（ベストトラック）</h2>${makeTrackTable(renderedTrack,false)}<p class="pdf-muted">pastTracks.jsonの経路点には日時が含まれないため、移動速度は算出していません。方向は隣接座標から計算した概算です。</p></section>`);
  if(selected.forecast && !isPast) blocks.push(`<section><h2>今後の予想中心位置・予報経路</h2>${makeTrackTable(renderedTrack,true)}<p class="pdf-muted">移動速度・方向は隣接する中心位置間から計算した値（概算）です。</p></section>`);
  if(selected.past && !isPast) blocks.push(`<section><h2>過去の台風経路</h2><p class="pdf-muted">現在選択中のデータは発表中台風の予報・実況経路です。過去経路を掲載するには「過去台風の経路」を選択してください。</p></section>`);
  if(selected.forecast && isPast) blocks.push(`<section><h2>今後の予想中心位置・予報経路</h2><p class="pdf-muted">過去台風が選択されています。予報経路を掲載するには発表中台風を選択してください。</p></section>`);
  const nearest=renderedNearest;
  const info=[];
  if(selected.time) info.push(`<div class="pdf-metric"><span>父島への最接近時刻（JST）</span><strong>${!isPast && nearest?.time?escHtml(fmtTime(nearest.time)):"算出対象外／時刻データなし"}</strong></div>`);
  if(selected.distance) info.push(`<div class="pdf-metric"><span>最接近距離</span><strong>${nearest?nearest.distance.toFixed(1)+" km":"—"}</strong></div>`);
  if(selected.direction) info.push(`<div class="pdf-metric"><span>父島から見た台風中心の方角</span><strong>${nearest?`${compass(nearest.bearing)}（方位角 ${nearest.bearing.toFixed(1)}°）`:"—"}</strong></div>`);
  if(info.length) blocks.push(`<section><h2>父島アメダスへの最接近情報</h2><div class="pdf-metrics">${info.join("")}</div></section>`);
  $("pdfReport").innerHTML=`
    <header class="pdf-head"><div><div class="pdf-kicker">自治体向け台風情報 / CHICHIJIMA AMEDAS</div><h1>${escHtml(title)}</h1><p>${escHtml(issued)}</p></div><div class="pdf-created">資料作成：${escHtml(now)}<br>基準地点：父島アメダス（44301）</div></header>
    <section class="pdf-map-section"><h2>地形図・台風位置図</h2>${mapDataUrl?`<img class="pdf-generated-map" src="${mapDataUrl}" alt="地形図に台風経路・風域・父島を重ねた地図">`:`<p class="pdf-muted">地図画像を生成できませんでした。</p>`}<p class="pdf-muted">背景地図：${baseMapCheckbox?.checked?"OpenTopoMap":"OpenStreetMap"}。台風経路・風域・父島アメダスを地理座標から描画しています。</p></section>
    ${blocks.join("")}
    <footer class="pdf-foot">出典：気象庁公開台風データ（取得・加工）／父島アメダス座標。個人開発ツールによる参考資料です。公式の予報・警報・防災情報の代替ではありません。最接近値は経路点間の補間による推定値です。移動速度・方向は隣接する中心位置間から計算した概算で、公式発表値とは異なる場合があります。</footer>`;
  return true;
}
$("pdfButton").addEventListener("click",async()=>{
  if(!(await buildPdfReport())) return;
  document.body.classList.add("printing-report");
  // Let the cloned Leaflet tiles settle before opening the print dialog.
  const tileImages=[...document.querySelectorAll("#pdfReport .pdf-map-copy img.leaflet-tile")];
  await Promise.race([
    Promise.all(tileImages.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener("load",resolve,{once:true});img.addEventListener("error",resolve,{once:true});}))),
    new Promise(resolve=>setTimeout(resolve,2500))
  ]);
  window.print();
  // Restore normal screen view after the print dialog closes.
  setTimeout(()=>document.body.classList.remove("printing-report"),1000);
});
