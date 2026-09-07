import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const SOURCE = "1rmCpUX9JnmWHKrqDtfjcjkf0eb1I5lQlg22QJc0d60w";
const SOURCE_TABS = [{ gid: "0", zedSource: false }, { gid: "20260907", zedSource: true }];
const TWITCH_URL = "https://www.twitch.tv/agerivagyok";
const LIVE_URL = "/api/live";
const BASE_TILE_URL = "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png?key=cb1_25b0_1_cf52869ae38041a055110db7";
const LABEL_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const COUNTRY_NAMES_HU = {
  Austria: "Ausztria", Belgium: "Belgium", Croatia: "Horvátország", Germany: "Németország",
  Hungary: "Magyarország", Italy: "Olaszország", Netherlands: "Hollandia", Slovakia: "Szlovákia",
  Slovenia: "Szlovénia", Sweden: "Svédország",
};
const MAP_STYLE = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    "dark-base": {
      type: "raster", tileSize: 256, maxzoom: 20,
      tiles: [BASE_TILE_URL],
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
    "english-labels": {
      type: "raster", tileSize: 256, maxzoom: 16,
      tiles: [LABEL_TILE_URL],
      attribution: "&copy; Esri",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#071827" } },
    { id: "dark-base", type: "raster", source: "dark-base", paint: { "raster-fade-duration": 120 } },
    { id: "english-labels", type: "raster", source: "english-labels", paint: { "raster-fade-duration": 120, "raster-opacity": 0.94 } },
  ],
};
const COUNTRY_BORDERS_URL = "./country-borders-europe.geojson";
const twitchMetadata = JSON.parse(readFileSync(new URL("../data/twitch-meta.json", import.meta.url), "utf8"));
const minifyCss = (value) => value
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ")
  .replace(/\s*([{}:;,>])\s*/g, "$1")
  .trim();
const appCss = minifyCss(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  .replace(/^@import\s+"tailwindcss";\s*/u, ""));
const maplibreCss = minifyCss(readFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl.css", import.meta.url), "utf8"));

const cell = (row, index) => row.c?.[index]?.v ?? "";
const clipId = (url) => String(url).match(/\/clip\/([^/?#]+)/)?.[1] ?? "";
const tables = await Promise.all(SOURCE_TABS.map(async (tab) => {
  const endpoint = `https://docs.google.com/spreadsheets/d/${SOURCE}/gviz/tq?tqx=out:json&gid=${tab.gid}`;
  const raw = await (await fetch(endpoint)).text();
  const payload = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  return { rows: payload.table.rows, zedSource: tab.zedSource };
}));
const places = tables.flatMap((table, tableIndex) => table.rows.map((row, index) => {
  const coordinates = String(cell(row, 5)).split(",").map((value) => Number(value.trim()));
  const url = String(cell(row, 1));
  const twitch = twitchMetadata[clipId(url)] ?? {};
  return {
    id: tableIndex * 1_000_000 + index,
    name: String(cell(row, 0)),
    clipUrl: url,
    category: String(cell(row, 2)),
    sourceKeywords: String(cell(row, 3)),
    keywords: String(cell(row, 4)),
    latitude: coordinates[0],
    longitude: coordinates[1],
    twitchTitle: String(cell(row, 6)),
    country: String(cell(row, 7)),
    clipDate: String(cell(row, 8)),
    top: String(cell(row, 9)).trim().toUpperCase() === "TOP",
    zedSource: table.zedSource,
    twitchCategory: twitch.category ?? "",
    twitchKeywords: twitch.language ?? "",
  };
})).filter((place) => place.name !== "Clip name" && Number.isFinite(place.latitude) && Number.isFinite(place.longitude));

const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
const categories = unique(places.map((place) => place.category));
const countries = unique(places.map((place) => place.country));
const topCount = places.filter((place) => place.top).length;
const data = JSON.stringify(places).replace(/</g, "\\u003c");

const html = `<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#071827">
  <meta name="description" content="AgeriVagyok streamjeinek emlékezetes klipjei térképen.">
  <meta name="keywords" content="geri, agerivagyok, twitch, streamer, clip, clips, clipek, térkép">
  <meta name="msapplication-TileColor" content="#071827">
  <meta name="msapplication-config" content="./browserconfig.xml">
  <title>Geri Clips</title>
  <link rel="icon" href="./favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="16x16" href="./favicon-16x16.png">
  <link rel="icon" type="image/png" sizes="32x32" href="./favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="48x48" href="./favicon-48x48.png">
  <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png">
  <link rel="manifest" href="./site.webmanifest">
  <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossorigin>
  <link rel="preconnect" href="https://server.arcgisonline.com" crossorigin>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>${maplibreCss}\n${appCss}</style>
  <style>
    .filters-panel,.modal-backdrop{display:none}
    .filters-panel.open{display:block}.modal-backdrop.open{display:grid}
    .live-button[hidden],.search-clear[hidden],.top-badge[hidden],.search-suggestions[hidden]{display:none}
  </style>
</head>
<body>
  <main class="site-shell">
    <header class="site-header">
      <div class="identity">
        <div class="wordmark" aria-label="Geri Clips"><span>Geri</span><em>Clips</em></div>
      </div>
      <a class="twitch-button" href="${TWITCH_URL}" target="_blank" rel="noreferrer">Twitch profil</a>
      <a class="live-button" id="live-button" href="${TWITCH_URL}" target="_blank" rel="noreferrer" hidden><span class="live-led" aria-hidden="true"></span>LIVE</a>
    </header>

    <div class="filter-area">
      <div class="search-box">
        <span class="search-icon" aria-hidden="true"></span>
        <input id="search-input" type="search" placeholder="Balaton, vicces, zene, ..." aria-label="Keresés a klipek között" aria-autocomplete="list" aria-controls="search-suggestions">
        <button class="search-clear" id="search-clear" aria-label="Keresés törlése" hidden>×</button>
        <div class="search-suggestions" id="search-suggestions" role="listbox" hidden></div>
      </div>
      <button class="title-toggle zed-toggle active" id="zed-toggle" type="button" role="switch" aria-checked="true" aria-label="Zed streamjéből származó klipek megjelenítése"><span class="title-toggle-track" aria-hidden="true"><i></i></span><b>Zed streamjéből</b></button>
      <button class="title-toggle" id="title-toggle" type="button" role="switch" aria-checked="false" aria-label="Klipcímek megjelenítése"><span class="title-toggle-track" aria-hidden="true"><i></i></span><b>Címek</b></button>
      <button class="filter-button" id="filter-button" aria-expanded="false" aria-controls="filters-panel"><span class="filter-icon" aria-hidden="true"><i></i><i></i><i></i></span>Szűrők</button>
      <section class="filters-panel" id="filters-panel" aria-label="Térképszűrők">
        <div class="filter-section">
          <h2>Kiemelt klipek</h2>
          <div class="filter-options single-option"><label><input type="checkbox" id="top-only"><span>Csak TOP klipek <small id="top-count"></small></span></label></div>
        </div>
        <div class="filter-section">
          <h2>Kategória</h2>
          <div class="filter-options" id="category-options"><label class="select-all-option"><input type="checkbox" data-select-all="category" checked><span>ÖSSZES</span></label></div>
        </div>
      </section>
    </div>

    <div class="clip-list-shell" id="clip-list-shell">
      <aside class="clip-list-panel" id="clip-list-panel" aria-label="Kliplista">
        <div class="clip-list-heading">
          <div class="clip-list-titlebar"><h2>Lista</h2><small id="clip-list-count"></small></div>
          <div class="clip-list-toolbar">
            <button class="list-clear-button" id="list-clear-button" type="button" disabled>ÖSSZES</button>
            <button class="list-top-toggle" id="list-top-toggle" type="button" aria-pressed="false"><span aria-hidden="true"><i></i></span>TOP</button>
            <div class="list-sort" aria-label="Lista sorrendje">
              <button class="active" id="list-sort-date" type="button" aria-pressed="true">Dátum <span aria-hidden="true">↓</span></button>
              <button id="list-sort-name" type="button" aria-pressed="false">Név <span aria-hidden="true"></span></button>
            </div>
          </div>
        </div>
        <div class="clip-list-scroll" id="clip-list-scroll"></div>
      </aside>
      <button class="clip-list-toggle" id="clip-list-toggle" type="button" aria-expanded="false" aria-label="Lista megnyitása"><span aria-hidden="true">›</span><b>Lista</b></button>
    </div>
    <div class="clip-connector" id="clip-connector" aria-hidden="true" hidden></div>

    <div id="map" class="map" aria-label="Geri klipjeinek interaktív térképe"></div>
    <div class="map-loading" id="map-loading" role="status" aria-label="Térkép betöltése"><span class="map-loading-spinner" aria-hidden="true"></span></div>

    <div class="modal-backdrop" id="modal-backdrop" aria-hidden="true">
      <button class="modal-dismiss" id="modal-dismiss" aria-label="Klip bezárása"></button>
      <section class="clip-modal" role="dialog" aria-modal="true" aria-labelledby="clip-modal-title">
        <div class="modal-heading">
          <h2 id="clip-modal-title"></h2>
          <div class="modal-actions"><span class="top-badge" id="top-badge" hidden>TOP</span><button class="close-button" id="close-button" aria-label="Klip bezárása"><span></span><span></span></button></div>
        </div>
        <div class="player-frame" id="player-frame"></div>
        <p class="clip-source-keywords" id="clip-source-keywords" hidden></p>
      </section>
    </div>
    <div class="site-credit">vibecoded with love :: powered by <a href="https://nagz.space" target="_blank" rel="noopener noreferrer">nagz.space</a></div>
  </main>

  <script>
    const places=${data};
    const normalizeSearch=value=>String(value).normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLocaleLowerCase("hu-HU").replace(/[^\\p{L}\\p{N}]+/gu," ").trim();
    const clipId=url=>(String(url).match(/\\/clip\\/([^/?#]+)/)||[])[1]||"";
    const unique=values=>[...new Set(values.filter(Boolean))];
    const countValues=values=>values.reduce((counts,value)=>{if(value)counts[value]=(counts[value]||0)+1;return counts},{});
    const countryNames=${JSON.stringify(COUNTRY_NAMES_HU)},countryName=country=>countryNames[country]||country;
    function buildSearchSuggestions(){const index=new Map();places.forEach(place=>{const seen=new Set(),candidates=[{label:place.category,kind:"Kategória",priority:5},{label:countryName(place.country),kind:"Ország",priority:5},{label:place.name,kind:"Cím",priority:4},{label:place.twitchTitle,kind:"Cím",priority:3},...[place.sourceKeywords,place.keywords].flatMap(value=>String(value).split(",")).map(label=>({label:label.trim(),kind:"Kulcsszó",priority:2})),...String(place.twitchKeywords).split(",").map(label=>({label:label.trim(),kind:"Twitch-kulcsszó",priority:1}))];candidates.forEach(candidate=>{const normalized=normalizeSearch(candidate.label);if(normalized.length<2||seen.has(normalized))return;seen.add(normalized);const current=index.get(normalized);if(current){current.count+=1;if(place.top)current.topHits+=1;if(candidate.priority>current.priority){current.label=candidate.label;current.kind=candidate.kind;current.priority=candidate.priority}}else index.set(normalized,{...candidate,normalized,count:1,topHits:place.top?1:0})})});return [...index.values()]}
    function rankedSuggestions(query){const normalizedQuery=normalizeSearch(query);if(normalizedQuery.length<2)return[];return suggestionIndex.filter(suggestion=>suggestion.normalized.includes(normalizedQuery)).map(suggestion=>{const exact=suggestion.normalized===normalizedQuery,prefix=suggestion.normalized.startsWith(normalizedQuery),wordPrefix=suggestion.normalized.split(" ").some(word=>word.startsWith(normalizedQuery)),matchScore=exact?1000000:prefix?500000:wordPrefix?350000:200000;return{suggestion,score:matchScore+suggestion.count*1000+suggestion.topHits*100+suggestion.priority}}).sort((a,b)=>b.score-a.score||a.suggestion.label.localeCompare(b.suggestion.label,"hu")).slice(0,8).map(item=>item.suggestion)}
    const categories=unique(places.map(place=>place.category)).sort((a,b)=>a.localeCompare(b));
    const countries=unique(places.map(place=>place.country)).sort((a,b)=>countryName(a).localeCompare(countryName(b),"hu"));
    const categoryCounts=countValues(places.map(place=>place.category));
    const selectedCategories=new Set(categories),selectedCountries=new Set(countries);
    const suggestionIndex=buildSearchSuggestions();
    let topOnly=false,searchQuery="",searchFocused=false,suggestionCursor=0,searchOrigin=null,activeListPlace=null,hoveredListPlace=null,mapHoveredPlace=null,listTopOnly=false,listSort="date",listSortDirection="desc",viewportBounds=null,currentVisible=[],showTitles=false,showZed=true;
    function addFilterOptions(type,values,counts){const container=document.getElementById(type+"-options");values.forEach(value=>{const label=document.createElement("label"),input=document.createElement("input"),span=document.createElement("span"),small=document.createElement("small");input.type="checkbox";input.dataset.filter=type;input.value=value;input.checked=true;span.append(document.createTextNode((type==="country"?countryName(value):value)+" "));small.textContent="("+counts[value]+")";span.append(small);label.append(input,span);container.append(label)})}
    addFilterOptions("category",categories,categoryCounts);document.getElementById("top-count").textContent="("+places.filter(place=>place.top).length+")";

    setTimeout(()=>fetch("${LIVE_URL}").then(response=>response.ok?response.json():{online:false}).then(payload=>{if(payload.online)document.getElementById("live-button").hidden=false}).catch(()=>{}),1600);

    const map=new maplibregl.Map({container:"map",style:${JSON.stringify(MAP_STYLE)},center:[13.9,47.8],zoom:4,minZoom:2,maxZoom:17,attributionControl:false,fadeDuration:0,maxTileCacheZoomLevels:8,cancelPendingTileRequestsWhileZooming:false});
    map.addControl(new maplibregl.NavigationControl({showCompass:true,visualizePitch:true}),"bottom-right");
    map.addControl(new maplibregl.AttributionControl({compact:true}),"bottom-left");

    const prefetchedTileUrls=new Set(),tilePrefetchQueue=[];let activeTilePrefetches=0,prefetchTimer=0,glowTimer=0,glowFrame=0;
    function drainTilePrefetchQueue(){while(activeTilePrefetches<4&&tilePrefetchQueue.length){const url=tilePrefetchQueue.shift();activeTilePrefetches+=1;fetch(url,{cache:"force-cache",mode:"cors"}).catch(()=>prefetchedTileUrls.delete(url)).finally(()=>{activeTilePrefetches-=1;drainTilePrefetchQueue()})}}
    function queueTilePrefetch(url){if(prefetchedTileUrls.has(url))return;if(prefetchedTileUrls.size>1600)prefetchedTileUrls.clear();prefetchedTileUrls.add(url);tilePrefetchQueue.push(url);drainTilePrefetchQueue()}
    function prefetchTileRing(){const bounds=map.getBounds();function addRing(zoom,template){const tileCount=2**zoom,longitudeToX=longitude=>Math.floor((longitude+180)/360*tileCount),latitudeToY=latitude=>{const clamped=Math.max(-85.05112878,Math.min(85.05112878,latitude)),radians=clamped*Math.PI/180;return Math.floor((1-Math.asinh(Math.tan(radians))/Math.PI)/2*tileCount)};let west=bounds.getWest(),east=bounds.getEast();while(east<west)east+=360;const minX=longitudeToX(west),maxX=longitudeToX(east),minY=latitudeToY(bounds.getNorth()),maxY=latitudeToY(bounds.getSouth());for(let y=minY-1;y<=maxY+1;y+=1){if(y<0||y>=tileCount)continue;for(let x=minX-1;x<=maxX+1;x+=1){if(x>=minX&&x<=maxX&&y>=minY&&y<=maxY)continue;const wrappedX=((x%tileCount)+tileCount)%tileCount;queueTilePrefetch(template.replace("{z}",String(zoom)).replace("{x}",String(wrappedX)).replace("{y}",String(y)))}}}const zoom=Math.max(2,Math.min(20,Math.floor(map.getZoom())));addRing(zoom,${JSON.stringify(BASE_TILE_URL)});addRing(Math.min(16,zoom),${JSON.stringify(LABEL_TILE_URL)})}
    function scheduleTilePrefetch(){clearTimeout(prefetchTimer);prefetchTimer=setTimeout(prefetchTileRing,140)}
    function scheduleNodeGlow(){clearTimeout(glowTimer);cancelAnimationFrame(glowFrame);glowTimer=setTimeout(()=>{if(!map.getLayer("clip-points")||!map.hasImage("top-star"))return;const startedAt=performance.now(),normal=[57,217,204],highlight=[143,245,235],render=now=>{const progress=Math.min(1,(now-startedAt)/440),strength=Math.sin(progress*Math.PI),color=normal.map((channel,index)=>Math.round(channel+(highlight[index]-channel)*strength));map.setPaintProperty("clip-points","circle-color",["case",["get","zedSource"],"#f6bd7b",["get","linked"],"rgb("+color.join(",")+")","#7c9299"]);const glowingStar=makeTopStar(strength);if(glowingStar)map.updateImage("top-star",glowingStar);const glowingZedStar=makeTopStar(strength,true);if(glowingZedStar&&map.hasImage("zed-top-star"))map.updateImage("zed-top-star",glowingZedStar);if(progress<1)glowFrame=requestAnimationFrame(render);else{map.setPaintProperty("clip-points","circle-color",["case",["get","zedSource"],"#f6bd7b",["get","linked"],"#39d9cc","#7c9299"]);const baseStar=makeTopStar();if(baseStar)map.updateImage("top-star",baseStar);const baseZedStar=makeTopStar(0,true);if(baseZedStar&&map.hasImage("zed-top-star"))map.updateImage("zed-top-star",baseZedStar)}};glowFrame=requestAnimationFrame(render)},60)}
    function wakeMap(){requestAnimationFrame(()=>requestAnimationFrame(()=>{map.resize();map.triggerRepaint();scheduleTilePrefetch()}))}
    new ResizeObserver(wakeMap).observe(document.getElementById("map"));window.addEventListener("load",wakeMap);window.addEventListener("pageshow",wakeMap);document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")wakeMap()});map.on("moveend",scheduleTilePrefetch);map.on("moveend",syncListViewport);map.on("zoomend",scheduleNodeGlow);map.on("resize",syncListViewport);map.on("idle",scheduleTilePrefetch);

    function placesToGeoJson(items){return{type:"FeatureCollection",features:items.map(place=>({type:"Feature",id:place.id,geometry:{type:"Point",coordinates:[place.longitude,place.latitude]},properties:{id:place.id,name:place.name||"Névtelen klip",linked:Boolean(place.clipUrl),top:place.top,zedSource:place.zedSource}}))}}
    function makeTopStar(glow=0,zed=false){const size=80,canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;const context=canvas.getContext("2d");if(!context)return null;context.scale(2,2);const outer=17,inner=7.4,center=20;context.beginPath();for(let index=0;index<10;index+=1){const radius=index%2===0?outer:inner,angle=-Math.PI/2+index*Math.PI/5,x=center+Math.cos(angle)*radius,y=center+Math.sin(angle)*radius;index===0?context.moveTo(x,y):context.lineTo(x,y)}context.closePath();const brighten=hex=>{const value=hex.slice(1),channels=[0,2,4].map(offset=>parseInt(value.slice(offset,offset+2),16));return"rgb("+channels.map(channel=>Math.round(channel+(255-channel)*glow*.52)).join(",")+")"},gradient=context.createLinearGradient(8,6,31,34);gradient.addColorStop(0,brighten(zed?"#fff0dc":"#b9fff7"));gradient.addColorStop(.58,brighten(zed?"#f6bd7b":"#39d9cc"));gradient.addColorStop(1,brighten(zed?"#c8743f":"#247fa3"));context.fillStyle=gradient;context.fill();context.lineWidth=2.5;context.strokeStyle=brighten("#071827");context.stroke();return context.getImageData(0,0,size,size)}
    function addTopStar(){const star=makeTopStar();if(star)map.addImage("top-star",star,{pixelRatio:2});const zedStar=makeTopStar(0,true);if(zedStar)map.addImage("zed-top-star",zedStar,{pixelRatio:2})}
    function makeTitleLabelBackground(hovered=false){const width=40,height=36,canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d");if(!context)return null;const fill=hovered?"rgba(10, 37, 54, 0.96)":"rgba(9, 29, 44, 0.84)",stroke=hovered?"rgba(88, 239, 224, 0.9)":"rgba(57, 217, 204, 0.34)";context.beginPath();context.roundRect(1.5,1.5,width-3,27,7);context.fillStyle=fill;context.fill();context.lineWidth=hovered?2:1.5;context.strokeStyle=stroke;context.stroke();context.beginPath();context.moveTo(16.5,28);context.lineTo(20,34);context.lineTo(23.5,28);context.closePath();context.fillStyle=fill;context.fill();context.strokeStyle=stroke;context.stroke();return context.getImageData(0,0,width,height)}

    let mapReady=false;
    map.on("load",()=>{
      addTopStar();
       const titleBackground=makeTitleLabelBackground();if(titleBackground)map.addImage("title-label-background",titleBackground,{pixelRatio:2,stretchX:[[7,16],[24,33]],stretchY:[[7,20]],content:[7,5,33,25]});const hoveredTitleBackground=makeTitleLabelBackground(true);if(hoveredTitleBackground)map.addImage("title-label-hover-background",hoveredTitleBackground,{pixelRatio:2,stretchX:[[7,16],[24,33]],stretchY:[[7,20]],content:[7,5,33,25]});
      map.addSource("clips",{type:"geojson",data:placesToGeoJson(places),cluster:true,clusterMaxZoom:16,clusterRadius:22});
       map.addSource("active-clip",{type:"geojson",data:placesToGeoJson([])});
       map.addSource("hovered-label",{type:"geojson",data:placesToGeoJson([])});
      map.addSource("active-cluster",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
       map.addLayer({id:"clip-clusters",type:"circle",source:"clips",filter:["has","point_count"],paint:{"circle-radius":["step",["get","point_count"],17.5,10,21,100,24],"circle-color":"#12334a","circle-stroke-color":"#43dfd1","circle-stroke-width":2}});
       map.addLayer({id:"cluster-count",type:"symbol",source:"clips",filter:["has","point_count"],layout:{"text-field":["to-string",["get","point_count"]],"text-font":["Open Sans Regular"],"text-size":["step",["get","point_count"],13,100,12],"text-allow-overlap":true,"text-ignore-placement":true,"text-anchor":"center","text-justify":"center","text-letter-spacing":0,"text-rotation-alignment":"viewport","text-pitch-alignment":"viewport"},paint:{"text-color":"#fff","text-halo-color":"rgba(5, 25, 39, .62)","text-halo-width":.7}});
       map.addLayer({id:"clip-points",type:"circle",source:"clips",filter:["all",["!",["has","point_count"]],["==",["get","top"],false]],paint:{"circle-radius":["case",["get","linked"],5.5,4.5],"circle-color":["case",["get","zedSource"],"#f6bd7b",["get","linked"],"#39d9cc","#7c9299"],"circle-color-transition":{duration:0,delay:0},"circle-stroke-color":"#071827","circle-stroke-width":1.5}});
       map.addLayer({id:"top-points",type:"symbol",source:"clips",filter:["all",["!",["has","point_count"]],["==",["get","top"],true]],layout:{"icon-image":["case",["get","zedSource"],"zed-top-star","top-star"],"icon-size":.55,"icon-allow-overlap":true,"icon-rotation-alignment":"viewport","icon-pitch-alignment":"viewport","icon-keep-upright":true}});
       map.addLayer({id:"clip-labels",type:"symbol",source:"clips",filter:["!",["has","point_count"]],layout:{visibility:"none","icon-image":"title-label-background","icon-text-fit":"both","icon-text-fit-padding":[5,8,5,8],"icon-allow-overlap":true,"icon-ignore-placement":true,"text-field":["get","name"],"text-font":["Open Sans Regular"],"text-size":12,"text-anchor":"bottom","text-offset":[0,-1.45],"text-max-width":18,"text-allow-overlap":true,"text-ignore-placement":true,"text-rotation-alignment":"viewport","text-pitch-alignment":"viewport","icon-rotation-alignment":"viewport","icon-pitch-alignment":"viewport"},paint:{"icon-opacity":["case",["boolean",["feature-state","title-hover"],false],0,1],"text-opacity":["case",["boolean",["feature-state","title-hover"],false],0,1],"text-color":"#efffff","text-halo-color":"rgba(4, 11, 16, 0.45)","text-halo-width":.7,"text-halo-blur":.2}});
       map.addLayer({id:"hovered-clip-label",type:"symbol",source:"hovered-label",layout:{"icon-image":"title-label-hover-background","icon-text-fit":"both","icon-text-fit-padding":[5,8,5,8],"icon-allow-overlap":true,"icon-ignore-placement":true,"text-field":["get","name"],"text-font":["Open Sans Regular"],"text-size":12,"text-anchor":"bottom","text-offset":[0,-1.45],"text-max-width":18,"text-allow-overlap":true,"text-ignore-placement":true,"text-rotation-alignment":"viewport","text-pitch-alignment":"viewport","icon-rotation-alignment":"viewport","icon-pitch-alignment":"viewport"},paint:{"icon-translate":[0,0],"icon-translate-transition":{duration:170,delay:0},"text-translate":[0,0],"text-translate-transition":{duration:170,delay:0},"text-color":"#f2ffff","text-halo-color":"rgba(4, 34, 48, .74)","text-halo-width":.9}});
       map.addLayer({id:"active-clip-point",type:"circle",source:"active-clip",filter:["==",["get","top"],false],paint:{"circle-radius":["case",["get","linked"],10.5,8.25],"circle-color":["case",["get","zedSource"],"#ffd19d",["get","linked"],"#55eadc","#91a5ac"],"circle-stroke-color":["case",["get","zedSource"],"#fff0dc","#b9fff7"],"circle-stroke-width":2,"circle-blur":.06}});
       map.addLayer({id:"active-top-halo",type:"circle",source:"active-clip",filter:["==",["get","top"],true],paint:{"circle-radius":14,"circle-color":"rgba(0, 0, 0, 0)","circle-stroke-color":["case",["get","zedSource"],"#ffd19d","#65eadf"],"circle-stroke-width":2.1,"circle-stroke-opacity":.8}},"top-points");
       map.addLayer({id:"clip-hit-area",type:"circle",source:"clips",filter:["!",["has","point_count"]],paint:{"circle-radius":["case",["get","top"],20,["get","linked"],12.75,11.5],"circle-color":"rgba(0, 0, 0, 0.01)","circle-stroke-width":0}});
       map.addLayer({id:"active-cluster",type:"circle",source:"active-cluster",paint:{"circle-radius":["step",["get","point_count"],19.25,10,23,100,26.5],"circle-color":"#18435e","circle-stroke-color":"#65eadf","circle-stroke-width":2.3}});
       const popup=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:12,className:"clip-map-tooltip"});
       let hoveredLabelId=null,hoveredLabelLeaveTimer=0;
       function clearHoveredTitleLabel(){clearTimeout(hoveredLabelLeaveTimer);if(hoveredLabelId!==null)map.setFeatureState({source:"clips",id:hoveredLabelId},{"title-hover":false});map.getSource("hovered-label").setData(placesToGeoJson([]));hoveredLabelId=null}
       function emphasizeTitleLabel(place){clearTimeout(hoveredLabelLeaveTimer);if(hoveredLabelId!==place.id)clearHoveredTitleLabel();hoveredLabelId=place.id;map.setFeatureState({source:"clips",id:place.id},{"title-hover":true});map.getSource("hovered-label").setData(placesToGeoJson([place]));map.setPaintProperty("hovered-clip-label","icon-translate",[0,0]);map.setPaintProperty("hovered-clip-label","text-translate",[0,0]);requestAnimationFrame(()=>{if(hoveredLabelId!==place.id)return;map.setPaintProperty("hovered-clip-label","icon-translate",[0,-7]);map.setPaintProperty("hovered-clip-label","text-translate",[0,-7])})}
       function deEmphasizeTitleLabel(){if(hoveredLabelId===null)return;map.setPaintProperty("hovered-clip-label","icon-translate",[0,0]);map.setPaintProperty("hovered-clip-label","text-translate",[0,0]);hoveredLabelLeaveTimer=setTimeout(clearHoveredTitleLabel,175)}
       function bindPointLayer(layerId){map.on("mouseenter",layerId,event=>{map.getCanvas().style.cursor="pointer";const feature=event.features&&event.features[0];if(!feature||feature.geometry.type!=="Point")return;const place=places.find(item=>item.id===Number(feature.properties.id))||null;mapHoveredPlace=place;updateHighlightedPoint();updateListHoverState();if(place&&showTitles){popup.remove();emphasizeTitleLabel(place);return}popup.setLngLat(feature.geometry.coordinates).setText(feature.properties.name||"").addTo(map)});map.on("mouseleave",layerId,()=>{map.getCanvas().style.cursor="";mapHoveredPlace=null;updateHighlightedPoint();updateListHoverState();if(showTitles)deEmphasizeTitleLabel();else popup.remove()});map.on("click",layerId,event=>{const id=Number(event.features&&event.features[0]&&event.features[0].properties.id),place=places.find(item=>item.id===id);if(place&&place.clipUrl)openClip(place)})}
       bindPointLayer("clip-hit-area");
      bindPointLayer("clip-labels");
      bindPointLayer("hovered-clip-label");
      map.on("mouseenter","clip-clusters",event=>{map.getCanvas().style.cursor="pointer";const feature=event.features&&event.features[0];if(!feature||feature.geometry.type!=="Point")return;map.getSource("active-cluster").setData({type:"FeatureCollection",features:[{type:"Feature",geometry:feature.geometry,properties:{point_count:Number(feature.properties.point_count||2)}}]})});map.on("mouseleave","clip-clusters",()=>{map.getCanvas().style.cursor="";map.getSource("active-cluster").setData({type:"FeatureCollection",features:[]})});
      map.on("click","clip-clusters",event=>{const feature=event.features&&event.features[0];if(!feature||feature.geometry.type!=="Point")return;map.getSource("active-cluster").setData({type:"FeatureCollection",features:[]});const clusterId=Number(feature.properties.cluster_id),pointCount=Number(feature.properties.point_count||2);map.getSource("clips").getClusterLeaves(clusterId,pointCount,0).then(leaves=>{const coordinates=leaves.filter(leaf=>leaf.geometry.type==="Point").map(leaf=>[Number(leaf.geometry.coordinates[0]),Number(leaf.geometry.coordinates[1])]);if(!coordinates.length)return;const west=Math.min(...coordinates.map(([longitude])=>longitude)),east=Math.max(...coordinates.map(([longitude])=>longitude)),south=Math.min(...coordinates.map(([,latitude])=>latitude)),north=Math.max(...coordinates.map(([,latitude])=>latitude));if(west===east&&south===north){const options=getListAwareMapOptions();map.easeTo({center:[west,south],zoom:17,offset:options.offset,duration:720})}else map.fitBounds([[west,south],[east,north]],{padding:getClusterFocusOptions().padding,maxZoom:17,duration:720})}).catch(()=>{})});
       map.on("click",event=>{const interactiveFeatures=map.queryRenderedFeatures(event.point,{layers:["clip-clusters","cluster-count","clip-hit-area","clip-points","top-points","clip-labels","hovered-clip-label","active-clip-point","active-top-halo","active-cluster"]});if(!interactiveFeatures.length){setListOpen(false);setFiltersOpen(false)}});
      const loadCountryBorders=()=>fetch("${COUNTRY_BORDERS_URL}").then(response=>response.ok?response.json():null).then(geoJson=>{if(!geoJson||map.getSource("country-borders"))return;map.addSource("country-borders",{type:"geojson",data:geoJson});map.addLayer({id:"country-borders",type:"line",source:"country-borders",paint:{"line-color":"#86a8b3","line-width":["interpolate",["linear"],["zoom"],2,1.1,8,1.6,14,2],"line-opacity":.68}},"clip-clusters")}).catch(()=>{});"requestIdleCallback" in window?requestIdleCallback(loadCountryBorders,{timeout:1800}):setTimeout(loadCountryBorders,900);
      mapReady=true;syncListViewport();renderMarkers(true);wakeMap();
    });

    const backdrop=document.getElementById("modal-backdrop"),player=document.getElementById("player-frame"),clipName=document.getElementById("clip-modal-title"),topBadge=document.getElementById("top-badge"),clipSourceKeywords=document.getElementById("clip-source-keywords");
    function closeModal(){backdrop.classList.remove("open");backdrop.setAttribute("aria-hidden","true");player.replaceChildren();clipSourceKeywords.textContent="";clipSourceKeywords.hidden=true;document.body.classList.remove("modal-open")}
    function openClip(place){const id=clipId(place.clipUrl);if(!id)return;clipName.textContent=place.name;topBadge.hidden=!place.top;clipSourceKeywords.textContent=place.sourceKeywords||"";clipSourceKeywords.hidden=!place.sourceKeywords;const iframe=document.createElement("iframe");iframe.title=place.twitchTitle||place.name;iframe.allow="autoplay; fullscreen";iframe.allowFullscreen=true;iframe.src="https://clips.twitch.tv/embed?clip="+encodeURIComponent(id)+"&parent="+encodeURIComponent(location.hostname||"localhost")+"&autoplay=true&muted=false";backdrop.classList.add("open");backdrop.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");player.append(iframe)}
    const listShell=document.getElementById("clip-list-shell"),listPanel=document.getElementById("clip-list-panel"),listScroll=document.getElementById("clip-list-scroll"),listToggle=document.getElementById("clip-list-toggle"),listCount=document.getElementById("clip-list-count"),listClearButton=document.getElementById("list-clear-button"),listTopToggle=document.getElementById("list-top-toggle"),listSortDate=document.getElementById("list-sort-date"),listSortName=document.getElementById("list-sort-name"),connector=document.getElementById("clip-connector");
    function getMapContentRect(open=listShell.classList.contains("open")){const container=map.getContainer(),width=container.clientWidth,height=container.clientHeight;if(!open)return{left:0,top:0,right:width,bottom:height};const rect=listPanel.getBoundingClientRect();if(matchMedia("(max-width: 520px)").matches)return{left:0,top:0,right:width,bottom:Math.max(80,height-rect.height-18)};return{left:Math.min(width-80,rect.width+24),top:0,right:width,bottom:height}}
    function getListAwareMapOptions(base=54){const rect=getMapContentRect(),container=map.getContainer(),width=container.clientWidth,height=container.clientHeight;return{offset:[(rect.left+rect.right-width)/2,(rect.top+rect.bottom-height)/2],padding:{top:base+rect.top,right:base+width-rect.right,bottom:base+height-rect.bottom,left:base+rect.left}}}function getClusterFocusOptions(){const rect=getMapContentRect(),container=map.getContainer(),width=container.clientWidth,height=container.clientHeight,contentWidth=rect.right-rect.left,contentHeight=rect.bottom-rect.top,focusSide=Math.max(180,Math.min(contentWidth,contentHeight)*.72),horizontalInset=Math.max(20,(contentWidth-focusSide)/2),verticalInset=Math.max(20,(contentHeight-focusSide)/2);return{padding:{top:rect.top+verticalInset,right:width-rect.right+horizontalInset,bottom:height-rect.bottom+verticalInset,left:rect.left+horizontalInset}}}
    function placeIsInVisibleMapArea(place){const point=map.project([place.longitude,place.latitude]),rect=getMapContentRect();return point.x>=rect.left&&point.x<=rect.right&&point.y>=rect.top&&point.y<=rect.bottom}
    let listAttentionPlayed=false,listAttentionTimer=0;
    function scheduleListAttention(){if(listAttentionPlayed||document.hidden||!document.hasFocus()||listShell.classList.contains("open"))return;clearTimeout(listAttentionTimer);listAttentionTimer=setTimeout(()=>{if(document.hidden||!document.hasFocus()||listShell.classList.contains("open"))return;listAttentionPlayed=true;listToggle.classList.add("attention");setTimeout(()=>listToggle.classList.remove("attention"),1150)},1500)}
    window.addEventListener("focus",scheduleListAttention);document.addEventListener("visibilitychange",()=>{if(!document.hidden)scheduleListAttention()});scheduleListAttention();
    function setListOpen(open){listShell.classList.toggle("open",open);listToggle.setAttribute("aria-expanded",String(open));listToggle.setAttribute("aria-label",open?"Lista bezárása":"Lista megnyitása");renderClipList(currentVisible);if(open){clearTimeout(listAttentionTimer);requestAnimationFrame(updateConnector)}else{hoveredListPlace=null;updateHighlightedPoint();connector.hidden=true;scheduleListAttention()}}
    function focusListPlace(place){activeListPlace=place;renderClipList(currentVisible);map.stop();map.easeTo({center:[place.longitude,place.latitude],zoom:15,offset:getListAwareMapOptions().offset,duration:720})}
    function activateListPlace(place){if(activeListPlace&&activeListPlace.id===place.id){if(place.clipUrl)openClip(place);return}focusListPlace(place)}
    function placeIsInViewport(place){if(!viewportBounds)return true;const longitudeVisible=viewportBounds.west<=viewportBounds.east?place.longitude>=viewportBounds.west&&place.longitude<=viewportBounds.east:place.longitude>=viewportBounds.west||place.longitude<=viewportBounds.east;return longitudeVisible&&place.latitude>=viewportBounds.south&&place.latitude<=viewportBounds.north}
    function syncListViewport(){const bounds=map.getBounds();viewportBounds={west:bounds.getWest(),east:bounds.getEast(),south:bounds.getSouth(),north:bounds.getNorth()};if(mapReady)renderClipList(currentVisible)}
    function orderedListPlaces(visible){const items=visible.filter(place=>placeIsInViewport(place)&&placeIsInVisibleMapArea(place)&&(!listTopOnly||place.top));return items.sort((a,b)=>{if(listSort==="name"){const comparison=String(a.name||"Névtelen klip").localeCompare(String(b.name||"Névtelen klip"),"hu",{sensitivity:"base"});return(listSortDirection==="asc"?comparison:-comparison)||b.id-a.id}if(Boolean(a.clipDate)!==Boolean(b.clipDate))return a.clipDate?-1:1;const comparison=String(a.clipDate||"").localeCompare(String(b.clipDate||""));return(listSortDirection==="asc"?comparison:-comparison)||b.id-a.id})}
    function hasActiveFilters(){return!showZed||topOnly||listTopOnly||Boolean(normalizeSearch(searchQuery))||selectedCategories.size!==categories.length||selectedCountries.size!==countries.length||currentVisible.some(place=>!placeIsInViewport(place)||!placeIsInVisibleMapArea(place))}
    function renderClipList(visible){listScroll.replaceChildren();if(!listShell.classList.contains("open")){listCount.textContent="";listClearButton.disabled=!hasActiveFilters();return}const sorted=orderedListPlaces(visible);listClearButton.disabled=!hasActiveFilters();listCount.textContent=sorted.length+" klip";if(activeListPlace&&!sorted.some(place=>place.id===activeListPlace.id))activeListPlace=null;if(hoveredListPlace&&!sorted.some(place=>place.id===hoveredListPlace.id)){hoveredListPlace=null;updateHighlightedPoint()}if(!sorted.length){connector.hidden=true;const empty=document.createElement("p");empty.className="clip-list-empty";empty.textContent="Nincs megjeleníthető klip.";listScroll.append(empty);return}sorted.forEach(place=>{const row=document.createElement("div");row.tabIndex=0;row.setAttribute("role","button");row.className="clip-list-row"+(!place.clipUrl?" inactive":"")+(activeListPlace&&activeListPlace.id===place.id?" active":"");row.dataset.listId=String(place.id);if(!place.clipUrl)row.title="Ehhez a helyhez nincs lejátszható klip";const play=document.createElement("button");play.type="button";play.className="list-play-button";play.disabled=!place.clipUrl;play.setAttribute("aria-label",place.clipUrl?(place.name||"Névtelen klip")+" lejátszása":"Nincs lejátszható klip");play.addEventListener("click",event=>{event.stopPropagation();if(place.clipUrl)openClip(place)});row.append(play);if(place.top){const badge=document.createElement("span");badge.className="list-top-badge";badge.textContent="TOP";row.append(badge)}const title=document.createElement("span");title.className="clip-list-title";title.textContent=place.name||"Névtelen klip";row.append(title);if(place.clipDate){const time=document.createElement("time");time.dateTime=place.clipDate;time.textContent=String(place.clipDate).replaceAll("-","/");row.append(time)}row.addEventListener("mouseenter",()=>{hoveredListPlace=place;updateHighlightedPoint();updateConnector()});row.addEventListener("mouseleave",()=>{hoveredListPlace=null;updateHighlightedPoint();updateConnector()});row.addEventListener("click",()=>activateListPlace(place));row.addEventListener("keydown",event=>{if(event.target!==row||event.key!=="Enter"&&event.key!==" ")return;event.preventDefault();activateListPlace(place)});listScroll.append(row)});requestAnimationFrame(updateConnector)}
    function updateHighlightedPoint(){if(!mapReady)return;const place=hoveredListPlace||mapHoveredPlace;map.getSource("active-clip").setData(placesToGeoJson(place?[place]:[]))}
    function updateListHoverState(){if(!listShell.classList.contains("open"))return;listScroll.querySelectorAll("[data-list-id]").forEach(row=>row.classList.toggle("map-hovered",Boolean(mapHoveredPlace&&Number(row.dataset.listId)===mapHoveredPlace.id)))}
    function updateConnector(){const place=hoveredListPlace||activeListPlace;if(!listShell.classList.contains("open")||!place){connector.hidden=true;return}const row=listScroll.querySelector('[data-list-id="'+place.id+'"]');if(!row){connector.hidden=true;return}const rowRect=row.getBoundingClientRect(),scrollRect=listScroll.getBoundingClientRect();if(rowRect.bottom<scrollRect.top||rowRect.top>scrollRect.bottom){connector.hidden=true;return}const mapRect=map.getContainer().getBoundingClientRect(),projected=map.project([place.longitude,place.latitude]),left=rowRect.right-3,top=rowRect.top+rowRect.height/2,endX=mapRect.left+projected.x,endY=mapRect.top+projected.y,deltaX=endX-left,deltaY=endY-top;connector.hidden=false;connector.classList.toggle("preview",Boolean(hoveredListPlace&&(!activeListPlace||hoveredListPlace.id!==activeListPlace.id)));connector.style.left=left+"px";connector.style.top=top+"px";connector.style.width=Math.hypot(deltaX,deltaY)+"px";connector.style.transform="rotate("+(Math.atan2(deltaY,deltaX)*180/Math.PI)+"deg)"}
    function updateListSortControls(){[[listSortDate,"date"],[listSortName,"name"]].forEach(([button,sort])=>{const active=listSort===sort;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));button.querySelector("span").textContent=active?(listSortDirection==="asc"?"↑":"↓"):""})}
    function toggleListSort(nextSort){if(listSort===nextSort)listSortDirection=listSortDirection==="asc"?"desc":"asc";else{listSort=nextSort;listSortDirection=nextSort==="date"?"desc":"asc"}updateListSortControls();renderClipList(currentVisible)}
    function clearAllFilters(){if(!hasActiveFilters())return;selectedCategories.clear();categories.forEach(value=>selectedCategories.add(value));selectedCountries.clear();countries.forEach(value=>selectedCountries.add(value));document.querySelectorAll("[data-filter]").forEach(input=>input.checked=true);document.querySelectorAll("[data-select-all]").forEach(input=>{input.checked=true;input.indeterminate=false});topOnly=false;document.getElementById("top-only").checked=false;showZed=true;zedToggle.classList.add("active");zedToggle.setAttribute("aria-checked","true");listTopOnly=false;listTopToggle.classList.remove("active");listTopToggle.setAttribute("aria-pressed","false");searchQuery="";searchOrigin=null;document.getElementById("search-input").value="";document.getElementById("search-clear").hidden=true;activeListPlace=null;hoveredListPlace=null;updateHighlightedPoint();renderMarkers()}
    listToggle.addEventListener("click",()=>setListOpen(!listShell.classList.contains("open")));listClearButton.addEventListener("click",clearAllFilters);listTopToggle.addEventListener("click",()=>{listTopOnly=!listTopOnly;listTopToggle.classList.toggle("active",listTopOnly);listTopToggle.setAttribute("aria-pressed",String(listTopOnly));renderClipList(currentVisible)});listSortDate.addEventListener("click",()=>toggleListSort("date"));listSortName.addEventListener("click",()=>toggleListSort("name"));listScroll.addEventListener("scroll",()=>requestAnimationFrame(updateConnector),{passive:true});map.on("move",()=>requestAnimationFrame(updateConnector));map.on("resize",updateConnector);window.addEventListener("resize",updateConnector);
    let fitTimer=0;
    function fitVisible(visible,tokens,initial=false){clearTimeout(fitTimer);if(!visible.length){map.stop();if(tokens.length&&searchOrigin)map.easeTo({center:searchOrigin.center,zoom:searchOrigin.zoom,duration:350});return}fitTimer=setTimeout(()=>{const options=getListAwareMapOptions();if(visible.length===1)map.easeTo({center:[visible[0].longitude,visible[0].latitude],zoom:14,offset:options.offset,duration:initial?0:650});else{const west=Math.min(...visible.map(place=>place.longitude)),east=Math.max(...visible.map(place=>place.longitude)),south=Math.min(...visible.map(place=>place.latitude)),north=Math.max(...visible.map(place=>place.latitude)),maxZoom=visible.length<=4?13:visible.length<=20?11:7;map.fitBounds([[west,south],[east,north]],{padding:options.padding,maxZoom,duration:initial?0:650});if(initial)map.setZoom(Math.max(map.getMinZoom(),map.getZoom()-1))}},initial?0:tokens.length?260:0)}
    function renderMarkers(initial=false){const tokens=normalizeSearch(searchQuery).split(/\\s+/).filter(Boolean);const visible=places.filter(place=>{if(!showZed&&place.zedSource||!selectedCategories.has(place.category)||!selectedCountries.has(place.country)||topOnly&&!place.top)return false;if(!tokens.length)return true;const haystack=normalizeSearch([place.keywords,place.sourceKeywords,place.category,place.name,place.twitchTitle,place.twitchCategory,place.twitchKeywords,place.country,countryName(place.country)].join(" "));return tokens.every(token=>haystack.includes(token))});currentVisible=visible;document.getElementById("map").dataset.visibleCount=String(visible.length);renderClipList(visible);if(mapReady&&!initial)map.getSource("clips").setData(placesToGeoJson(visible));fitVisible(visible,tokens,initial)}

    const zedToggle=document.getElementById("zed-toggle"),titleToggle=document.getElementById("title-toggle"),filterButton=document.getElementById("filter-button"),filtersPanel=document.getElementById("filters-panel");
    zedToggle.addEventListener("click",()=>{showZed=!showZed;zedToggle.classList.toggle("active",showZed);zedToggle.setAttribute("aria-checked",String(showZed));renderMarkers()});
    titleToggle.addEventListener("click",()=>{showTitles=!showTitles;titleToggle.classList.toggle("active",showTitles);titleToggle.setAttribute("aria-checked",String(showTitles));if(mapReady){map.setLayoutProperty("clip-labels","visibility",showTitles?"visible":"none");map.setLayoutProperty("hovered-clip-label","visibility",showTitles?"visible":"none");if(!showTitles){map.getSource("hovered-label").setData(placesToGeoJson([]));map.removeFeatureState({source:"clips"})}}});
    function setFiltersOpen(open){filterButton.setAttribute("aria-expanded",String(open));filtersPanel.classList.toggle("open",open)}
    filterButton.addEventListener("click",()=>setFiltersOpen(filterButton.getAttribute("aria-expanded")!=="true"));
    function updateSelectAll(type){const inputs=[...document.querySelectorAll('[data-filter="'+type+'"]')],all=document.querySelector('[data-select-all="'+type+'"]');all.checked=inputs.every(input=>input.checked);all.indeterminate=!all.checked&&inputs.some(input=>input.checked)}
    document.querySelectorAll("[data-filter]").forEach(input=>input.addEventListener("change",()=>{const target=input.dataset.filter==="category"?selectedCategories:selectedCountries;input.checked?target.add(input.value):target.delete(input.value);updateSelectAll(input.dataset.filter);renderMarkers()}));
    document.querySelectorAll("[data-select-all]").forEach(all=>all.addEventListener("change",()=>{const type=all.dataset.selectAll,target=type==="category"?selectedCategories:selectedCountries;target.clear();document.querySelectorAll('[data-filter="'+type+'"]').forEach(input=>{input.checked=all.checked;if(all.checked)target.add(input.value)});all.indeterminate=false;renderMarkers()}));
    document.getElementById("top-only").addEventListener("change",event=>{topOnly=event.target.checked;renderMarkers()});
    const searchInput=document.getElementById("search-input"),searchClear=document.getElementById("search-clear"),suggestionsPanel=document.getElementById("search-suggestions");
    function renderSearchSuggestions(){const query=normalizeSearch(searchQuery);if(!searchFocused||query.length<2){suggestionsPanel.hidden=true;suggestionsPanel.replaceChildren();return}const suggestions=rankedSuggestions(searchQuery);suggestionCursor=Math.min(suggestionCursor,Math.max(0,suggestions.length-1));suggestionsPanel.hidden=false;suggestionsPanel.replaceChildren();if(!suggestions.length){const empty=document.createElement("p");empty.className="search-empty";empty.textContent="Nincs találat";suggestionsPanel.append(empty);return}suggestions.forEach((suggestion,index)=>{const button=document.createElement("button");button.type="button";button.setAttribute("role","option");button.setAttribute("aria-selected",String(index===suggestionCursor));if(index===suggestionCursor)button.className="active";const label=document.createElement("span"),meta=document.createElement("span");label.className="suggestion-label";label.textContent=suggestion.label;meta.className="suggestion-meta";meta.textContent=suggestion.kind+" · "+suggestion.count+" találat";button.append(label,meta);button.addEventListener("mousedown",event=>event.preventDefault());button.addEventListener("click",()=>chooseSuggestion(suggestion));suggestionsPanel.append(button)})}
    function updateSearch(nextValue=searchInput.value){const previous=normalizeSearch(searchQuery),next=normalizeSearch(nextValue);if(!previous&&next){const center=map.getCenter();searchOrigin={center:[center.lng,center.lat],zoom:map.getZoom()}}else if(!next)searchOrigin=null;searchQuery=nextValue;searchInput.value=nextValue;searchClear.hidden=!searchQuery;suggestionCursor=0;renderMarkers();renderSearchSuggestions()}
    function chooseSuggestion(suggestion){updateSearch(suggestion.label);searchFocused=false;renderSearchSuggestions();searchInput.blur()}
    searchInput.addEventListener("input",()=>updateSearch());searchInput.addEventListener("focus",()=>{searchFocused=true;renderSearchSuggestions()});searchInput.addEventListener("blur",()=>setTimeout(()=>{searchFocused=false;renderSearchSuggestions()},120));searchInput.addEventListener("keydown",event=>{const suggestions=rankedSuggestions(searchQuery);if(event.key==="ArrowDown"&&suggestions.length){event.preventDefault();suggestionCursor=(suggestionCursor+1)%suggestions.length;renderSearchSuggestions()}else if(event.key==="ArrowUp"&&suggestions.length){event.preventDefault();suggestionCursor=(suggestionCursor-1+suggestions.length)%suggestions.length;renderSearchSuggestions()}else if(event.key==="Enter"&&suggestions[suggestionCursor]){event.preventDefault();chooseSuggestion(suggestions[suggestionCursor])}else if(event.key==="Escape"){searchFocused=false;renderSearchSuggestions()}});searchClear.addEventListener("click",()=>{updateSearch("");searchInput.focus()});
    document.getElementById("close-button").addEventListener("click",closeModal);document.getElementById("modal-dismiss").addEventListener("click",closeModal);
    document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeModal();setFiltersOpen(false);setListOpen(false)}});
  </script>
</body>
</html>`;

writeFileSync(new URL("../index.html", import.meta.url), html, "utf8");
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl.mjs", import.meta.url), new URL("../maplibre-gl.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", import.meta.url), new URL("../maplibre-gl-shared.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url), new URL("../maplibre-gl-worker.mjs", import.meta.url));
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl.css", import.meta.url), new URL("../maplibre-gl.css", import.meta.url));
for (const asset of [
  "favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png",
  "apple-touch-icon.png", "android-chrome-192x192.png", "android-chrome-512x512.png",
  "mstile-150x150.png", "site.webmanifest", "browserconfig.xml",
  "country-borders-europe.geojson",
]) copyFileSync(new URL(`../public/${asset}`, import.meta.url), new URL(`../${asset}`, import.meta.url));
console.log(`Generated index.html with ${places.length} locations, ${topCount} TOP clips and ${countries.length} countries.`);
