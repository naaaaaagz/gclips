"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const TWITCH_URL = "https://www.twitch.tv/agerivagyok";
const BASE_TILE_URL = "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png?key=cb1_25b0_1_cf52869ae38041a055110db7";
const LABEL_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const MAP_STYLE: StyleSpecification = {
  version: 8,
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
const COUNTRY_NAMES_HU: Record<string, string> = {
  Austria: "Ausztria",
  Belgium: "Belgium",
  Croatia: "Horvátország",
  Germany: "Németország",
  Hungary: "Magyarország",
  Italy: "Olaszország",
  Netherlands: "Hollandia",
  Slovakia: "Szlovákia",
  Slovenia: "Szlovénia",
  Sweden: "Svédország",
};
const prefetchedTileUrls = new Set<string>();
const tilePrefetchQueue: string[] = [];
let activeTilePrefetches = 0;

function drainTilePrefetchQueue() {
  while (activeTilePrefetches < 4 && tilePrefetchQueue.length) {
    const url = tilePrefetchQueue.shift();
    if (!url) return;
    activeTilePrefetches += 1;
    fetch(url, { cache: "force-cache", mode: "cors" }).catch(() => {
      prefetchedTileUrls.delete(url);
    }).finally(() => {
      activeTilePrefetches -= 1;
      drainTilePrefetchQueue();
    });
  }
}

function queueTilePrefetch(url: string) {
  if (prefetchedTileUrls.has(url)) return;
  if (prefetchedTileUrls.size > 1600) prefetchedTileUrls.clear();
  prefetchedTileUrls.add(url);
  tilePrefetchQueue.push(url);
  drainTilePrefetchQueue();
}

function prefetchTileRing(map: MapLibreMap) {
  const bounds = map.getBounds();
  const addRing = (zoom: number, template: string) => {
    const tileCount = 2 ** zoom;
    const longitudeToX = (longitude: number) => Math.floor(((longitude + 180) / 360) * tileCount);
    const latitudeToY = (latitude: number) => {
      const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
      const radians = clamped * Math.PI / 180;
      return Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * tileCount);
    };
    let west = bounds.getWest();
    let east = bounds.getEast();
    while (east < west) east += 360;
    const minX = longitudeToX(west);
    const maxX = longitudeToX(east);
    const minY = latitudeToY(bounds.getNorth());
    const maxY = latitudeToY(bounds.getSouth());
    for (let y = minY - 1; y <= maxY + 1; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      for (let x = minX - 1; x <= maxX + 1; x += 1) {
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
        const wrappedX = ((x % tileCount) + tileCount) % tileCount;
        queueTilePrefetch(template.replace("{z}", String(zoom)).replace("{x}", String(wrappedX)).replace("{y}", String(y)));
      }
    }
  };
  const zoom = Math.max(2, Math.min(20, Math.floor(map.getZoom())));
  addRing(zoom, BASE_TILE_URL);
  addRing(Math.min(16, zoom), LABEL_TILE_URL);
}

type Place = {
  id: number; name: string; clipUrl: string; category: string;
  sourceKeywords: string; keywords: string; latitude: number; longitude: number;
  twitchTitle: string; country: string; clipDate: string; top: boolean;
  twitchCategory: string; twitchKeywords: string;
};

type SearchSuggestion = {
  label: string; normalized: string; kind: string; count: number; topHits: number; priority: number;
};

type ConnectorLine = { left: number; top: number; width: number; angle: number; preview: boolean };
type ViewportBounds = { west: number; east: number; south: number; north: number };

function getClipId(url: string) { return url.match(/\/clip\/([^/?#]+)/)?.[1] ?? ""; }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function countryNameHu(country: string) { return COUNTRY_NAMES_HU[country] ?? country; }
function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    if (value) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu-HU")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function buildSearchSuggestions(places: Place[]) {
  const suggestions = new Map<string, SearchSuggestion>();
  for (const place of places) {
    const seen = new Set<string>();
    const candidates = [
      { label: place.category, kind: "Kategória", priority: 5 },
      { label: countryNameHu(place.country), kind: "Ország", priority: 5 },
      { label: place.name, kind: "Cím", priority: 4 },
      { label: place.twitchTitle, kind: "Cím", priority: 3 },
      ...[place.sourceKeywords, place.keywords].flatMap((value) => value.split(","))
        .map((label) => ({ label: label.trim(), kind: "Kulcsszó", priority: 2 })),
      ...place.twitchKeywords.split(",")
        .map((label) => ({ label: label.trim(), kind: "Twitch-kulcsszó", priority: 1 })),
    ];
    for (const candidate of candidates) {
      const normalized = normalizeSearch(candidate.label);
      if (normalized.length < 2 || seen.has(normalized)) continue;
      seen.add(normalized);
      const current = suggestions.get(normalized);
      if (current) {
        current.count += 1;
        if (place.top) current.topHits += 1;
        if (candidate.priority > current.priority) {
          current.label = candidate.label;
          current.kind = candidate.kind;
          current.priority = candidate.priority;
        }
      } else {
        suggestions.set(normalized, {
          ...candidate, normalized, count: 1, topHits: place.top ? 1 : 0,
        });
      }
    }
  }
  return [...suggestions.values()];
}

function rankSearchSuggestions(suggestions: SearchSuggestion[], query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (normalizedQuery.length < 2) return [];
  return suggestions.filter((suggestion) => suggestion.normalized.includes(normalizedQuery))
    .map((suggestion) => {
      const exact = suggestion.normalized === normalizedQuery;
      const prefix = suggestion.normalized.startsWith(normalizedQuery);
      const wordPrefix = suggestion.normalized.split(" ").some((word) => word.startsWith(normalizedQuery));
      const matchScore = exact ? 1_000_000 : prefix ? 500_000 : wordPrefix ? 350_000 : 200_000;
      return { suggestion, score: matchScore + suggestion.count * 1_000 + suggestion.topHits * 100 + suggestion.priority };
    })
    .sort((a, b) => b.score - a.score || a.suggestion.label.localeCompare(b.suggestion.label, "hu"))
    .slice(0, 8).map(({ suggestion }) => suggestion);
}

function placeIsInViewport(place: Place, bounds: ViewportBounds | null) {
  if (!bounds) return true;
  const longitudeVisible = bounds.west <= bounds.east
    ? place.longitude >= bounds.west && place.longitude <= bounds.east
    : place.longitude >= bounds.west || place.longitude <= bounds.east;
  return longitudeVisible && place.latitude >= bounds.south && place.latitude <= bounds.north;
}

function getMapContentRect(map: MapLibreMap, listOpen: boolean, panel: HTMLElement | null) {
  const container = map.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!listOpen || typeof window === "undefined") return { left: 0, top: 0, right: width, bottom: height };
  const panelRect = panel?.getBoundingClientRect();
  const mobile = window.matchMedia("(max-width: 520px)").matches;
  if (mobile) {
    const panelHeight = panelRect?.height ?? height * 0.58;
    return { left: 0, top: 0, right: width, bottom: Math.max(80, height - panelHeight - 18) };
  }
  const panelWidth = panelRect?.width ?? Math.min(520, Math.max(350, width * 0.3));
  return { left: Math.min(width - 80, panelWidth + 24), top: 0, right: width, bottom: height };
}

function placeIsInVisibleMapArea(place: Place, map: MapLibreMap | null, listOpen: boolean, panel: HTMLElement | null) {
  if (!map) return true;
  const point = map.project([place.longitude, place.latitude]);
  const rect = getMapContentRect(map, listOpen, panel);
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function getListAwareMapOptions(map: MapLibreMap, listOpen: boolean, panel: HTMLElement | null, base = 54) {
  const rect = getMapContentRect(map, listOpen, panel);
  const width = map.getContainer().clientWidth;
  const height = map.getContainer().clientHeight;
  return {
    offset: [(rect.left + rect.right - width) / 2, (rect.top + rect.bottom - height) / 2] as [number, number],
    padding: {
      top: base + rect.top,
      right: base + width - rect.right,
      bottom: base + height - rect.bottom,
      left: base + rect.left,
    },
  };
}

function getClusterFocusOptions(map: MapLibreMap, listOpen: boolean, panel: HTMLElement | null) {
  const rect = getMapContentRect(map, listOpen, panel);
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  const contentWidth = rect.right - rect.left;
  const contentHeight = rect.bottom - rect.top;
  const focusSide = Math.max(180, Math.min(contentWidth, contentHeight) * 0.72);
  const horizontalInset = Math.max(20, (contentWidth - focusSide) / 2);
  const verticalInset = Math.max(20, (contentHeight - focusSide) / 2);
  return {
    padding: {
      top: rect.top + verticalInset,
      right: width - rect.right + horizontalInset,
      bottom: height - rect.bottom + verticalInset,
      left: rect.left + horizontalInset,
    },
  };
}

function placesToGeoJson(places: Place[]) {
  return {
    type: "FeatureCollection" as const,
    features: places.map((place) => ({
      type: "Feature" as const,
      id: place.id,
      geometry: { type: "Point" as const, coordinates: [place.longitude, place.latitude] },
      properties: {
        id: place.id, name: place.name || "Névtelen klip", linked: Boolean(place.clipUrl), top: place.top,
      },
    })),
  };
}

function makeTopStar(glow = 0) {
  const size = 80;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(2, 2);
  const outer = 17; const inner = 7.4; const center = 20;
  context.beginPath();
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.closePath();
  const brighten = (hex: string) => {
    const value = hex.slice(1);
    const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
    return `rgb(${channels.map((channel) => Math.round(channel + (255 - channel) * glow * 0.52)).join(",")})`;
  };
  const gradient = context.createLinearGradient(8, 6, 31, 34);
  gradient.addColorStop(0, brighten("#b9fff7"));
  gradient.addColorStop(0.58, brighten("#39d9cc"));
  gradient.addColorStop(1, brighten("#247fa3"));
  context.fillStyle = gradient; context.fill();
  context.lineWidth = 2.5; context.strokeStyle = brighten("#071827"); context.stroke();
  return context.getImageData(0, 0, size, size);
}

function makeTitleLabelBackground(hovered = false) {
  const width = 40; const height = 36;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.beginPath();
  context.roundRect(1.5, 1.5, width - 3, 27, 7);
  context.fillStyle = hovered ? "rgba(10, 37, 54, 0.96)" : "rgba(9, 29, 44, 0.84)"; context.fill();
  context.lineWidth = hovered ? 2 : 1.5; context.strokeStyle = hovered ? "rgba(88, 239, 224, 0.9)" : "rgba(57, 217, 204, 0.34)"; context.stroke();
  context.beginPath(); context.moveTo(16.5, 28); context.lineTo(20, 34); context.lineTo(23.5, 28); context.closePath();
  context.fillStyle = hovered ? "rgba(10, 37, 54, 0.96)" : "rgba(9, 29, 44, 0.84)"; context.fill();
  context.strokeStyle = hovered ? "rgba(88, 239, 224, 0.9)" : "rgba(57, 217, 204, 0.34)"; context.stroke();
  return context.getImageData(0, 0, width, height);
}

function ClipPlayer({ clipId, parent, title }: { clipId: string; parent: string; title: string }) {
  return (
    <div className="player-frame">
      <iframe src={`https://clips.twitch.tv/embed?clip=${encodeURIComponent(clipId)}&parent=${encodeURIComponent(parent)}&autoplay=true&muted=false`}
        title={title} allow="autoplay; fullscreen" allowFullScreen />
    </div>
  );
}

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapLoadingRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const htmlMarkersRef = useRef<Map<number, HTMLElement>>(new Map());
  const searchOriginRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const listPanelRef = useRef<HTMLElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listRowRefs = useRef(new Map<number, HTMLDivElement>());
  const [places, setPlaces] = useState<Place[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [topOnly, setTopOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [suggestionCursor, setSuggestionCursor] = useState(0);
  const [showTitles, setShowTitles] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listTopOnly, setListTopOnly] = useState(false);
  const [listSort, setListSort] = useState<"date" | "name">("date");
  const [listSortDirection, setListSortDirection] = useState<"asc" | "desc">("desc");
  const [activeListPlace, setActiveListPlace] = useState<Place | null>(null);
  const [hoveredListPlace, setHoveredListPlace] = useState<Place | null>(null);
  const [mapHoveredPlace, setMapHoveredPlace] = useState<Place | null>(null);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [connectorLine, setConnectorLine] = useState<ConnectorLine | null>(null);
  const [online, setOnline] = useState(false);
  const [listAttention, setListAttention] = useState(false);
  const listAttentionPlayedRef = useRef(false);
  const listAttentionTimerRef = useRef(0);
  const listOpenRef = useRef(false);
  const showTitlesRef = useRef(false);
  const hoveredLabelIdRef = useRef<number | null>(null);
  const hoveredLabelLeaveTimerRef = useRef(0);

  const categories = useMemo(() => unique(places.map((place) => place.category)), [places]);
  const countries = useMemo(() => unique(places.map((place) => place.country))
    .sort((a, b) => countryNameHu(a).localeCompare(countryNameHu(b), "hu")), [places]);
  const categoryCounts = useMemo(() => countValues(places.map((place) => place.category)), [places]);
  const topCount = useMemo(() => places.filter((place) => place.top).length, [places]);
  const searchTokens = useMemo(() => normalizeSearch(searchQuery).split(/\s+/).filter(Boolean), [searchQuery]);
  const suggestionIndex = useMemo(() => buildSearchSuggestions(places), [places]);
  const searchSuggestions = useMemo(() => rankSearchSuggestions(suggestionIndex, searchQuery), [suggestionIndex, searchQuery]);
  const visiblePlaces = useMemo(() => places.filter((place) => {
    if (!selectedCategories.includes(place.category) || !selectedCountries.includes(place.country)) return false;
    if (topOnly && !place.top) return false;
    if (!searchTokens.length) return true;
    const haystack = normalizeSearch([
      place.keywords, place.sourceKeywords, place.category, place.name, place.twitchTitle,
      place.twitchCategory, place.twitchKeywords, place.country, countryNameHu(place.country),
    ].join(" "));
    return searchTokens.every((token) => haystack.includes(token));
  }), [places, searchTokens, selectedCategories, selectedCountries, topOnly]);
  const listPlaces = useMemo(() => {
    const items = visiblePlaces.filter((place) => placeIsInViewport(place, viewportBounds)
      && placeIsInVisibleMapArea(place, mapRef.current, listOpen, listPanelRef.current)
      && (!listTopOnly || place.top));
    return items.sort((a, b) => {
      if (listSort === "name") {
        const comparison = (a.name || "Névtelen klip").localeCompare(b.name || "Névtelen klip", "hu", { sensitivity: "base" });
        return (listSortDirection === "asc" ? comparison : -comparison) || b.id - a.id;
      }
      if (Boolean(a.clipDate) !== Boolean(b.clipDate)) return a.clipDate ? -1 : 1;
      const comparison = (a.clipDate || "").localeCompare(b.clipDate || "");
      return (listSortDirection === "asc" ? comparison : -comparison) || b.id - a.id;
    });
  }, [listOpen, listSort, listSortDirection, listTopOnly, viewportBounds, viewportRevision, visiblePlaces]);
  const connectorPlace = hoveredListPlace ?? activeListPlace;
  const highlightedPlace = hoveredListPlace ?? mapHoveredPlace;
  const viewportHidesClips = visiblePlaces.some((place) => !placeIsInViewport(place, viewportBounds)
    || !placeIsInVisibleMapArea(place, mapRef.current, listOpen, listPanelRef.current));
  const hasActiveFilters = topOnly || listTopOnly || Boolean(searchTokens.length)
    || selectedCategories.length !== categories.length || selectedCountries.length !== countries.length || viewportHidesClips;

  useEffect(() => { listOpenRef.current = listOpen; setViewportRevision((revision) => revision + 1); }, [listOpen]);

  useEffect(() => {
    let active = true;
    fetch("/api/places").then((response) => {
      if (!response.ok) throw new Error("A helyszínek nem tölthetők be");
      return response.json();
    }).then((data: Place[]) => {
      if (!active) return;
      setPlaces(data);
      setSelectedCategories(unique(data.map((place) => place.category)));
      setSelectedCountries(unique(data.map((place) => place.country)));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const endpoint = "/api/live";
    const timer = window.setTimeout(() => {
      fetch(endpoint).then((response) => response.ok ? response.json() : { online: false })
        .then((payload: { online?: boolean }) => { if (active) setOnline(Boolean(payload.online)); })
        .catch(() => {});
    }, 1600);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const scheduleAttention = () => {
      if (listAttentionPlayedRef.current || listOpen || document.hidden || !document.hasFocus()) return;
      window.clearTimeout(listAttentionTimerRef.current);
      listAttentionTimerRef.current = window.setTimeout(() => {
        if (listOpen || document.hidden || !document.hasFocus()) return;
        listAttentionPlayedRef.current = true;
        setListAttention(true);
        listAttentionTimerRef.current = window.setTimeout(() => setListAttention(false), 1150);
      }, 1500);
    };
    const handleVisibility = () => { if (!document.hidden) scheduleAttention(); };
    scheduleAttention();
    window.addEventListener("focus", scheduleAttention);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(listAttentionTimerRef.current);
      window.removeEventListener("focus", scheduleAttention);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [listOpen]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current || !places.length) return;
    let cancelled = false;
    let detachMapWakeups = () => {};
    import("maplibre-gl").then((maplibreModule) => {
      const maplibregl = maplibreModule.default ?? maplibreModule;
      if (cancelled || !mapContainer.current) return;
      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: MAP_STYLE,
        center: [13.9, 47.8], zoom: 4, minZoom: 2, maxZoom: 17,
        attributionControl: false, fadeDuration: 0,
        maxTileCacheZoomLevels: 8,
        cancelPendingTileRequestsWhileZooming: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

      // DOM markers do not depend on the style/worker lifecycle, so the database
      // locations remain visible even while the basemap is still loading.
      for (const place of places) {
        const markerElement = document.createElement("button");
        markerElement.type = "button";
        markerElement.title = place.name;
        markerElement.setAttribute("aria-label", place.name);
        markerElement.style.cssText = place.top
          ? "width:24px;height:24px;border:0;background:transparent;color:#39d9cc;font-size:24px;line-height:24px;filter:drop-shadow(0 0 5px #071827);cursor:pointer;padding:0"
          : "width:13px;height:13px;border:2px solid #071827;border-radius:50%;background:#39d9cc;box-shadow:0 0 0 2px rgba(57,217,204,.3);cursor:pointer;padding:0";
        if (place.top) markerElement.textContent = "★";
        markerElement.addEventListener("click", (event) => {
          event.stopPropagation();
          if (place.clipUrl) setSelected(place);
        });
        new maplibregl.Marker({ element: markerElement, anchor: "center" })
          .setLngLat([place.longitude, place.latitude])
          .addTo(map);
        htmlMarkersRef.current.set(place.id, markerElement);
      }

      let prefetchTimer = 0;
      let glowTimer = 0;
      let glowFrame = 0;
      const scheduleTilePrefetch = () => {
        window.clearTimeout(prefetchTimer);
        prefetchTimer = window.setTimeout(() => prefetchTileRing(map), 140);
      };
      const scheduleNodeGlow = () => {
        window.clearTimeout(glowTimer);
        window.cancelAnimationFrame(glowFrame);
        glowTimer = window.setTimeout(() => {
          if (!map.getLayer("clip-points") || !map.hasImage("top-star")) return;
          const startedAt = performance.now();
          const normal = [57, 217, 204];
          const highlight = [143, 245, 235];
          const render = (now: number) => {
            const progress = Math.min(1, (now - startedAt) / 440);
            const strength = Math.sin(progress * Math.PI);
            const color = normal.map((channel, index) => Math.round(channel + (highlight[index] - channel) * strength));
            map.setPaintProperty("clip-points", "circle-color", ["case", ["get", "linked"], `rgb(${color.join(",")})`, "#7c9299"]);
            const glowingStar = makeTopStar(strength);
            if (glowingStar) map.updateImage("top-star", glowingStar);
            if (progress < 1) glowFrame = window.requestAnimationFrame(render);
            else {
              map.setPaintProperty("clip-points", "circle-color", ["case", ["get", "linked"], "#39d9cc", "#7c9299"]);
              const baseStar = makeTopStar();
              if (baseStar) map.updateImage("top-star", baseStar);
            }
          };
          glowFrame = window.requestAnimationFrame(render);
        }, 60);
      };
      const syncViewportBounds = () => {
        const bounds = map.getBounds();
        setViewportBounds({ west: bounds.getWest(), east: bounds.getEast(), south: bounds.getSouth(), north: bounds.getNorth() });
        setViewportRevision((revision) => revision + 1);
      };
      const wakeMap = () => requestAnimationFrame(() => requestAnimationFrame(() => {
        if (cancelled) return;
        map.resize();
        map.triggerRepaint();
        scheduleTilePrefetch();
      }));
      const handleVisibility = () => { if (document.visibilityState === "visible") wakeMap(); };
      const resizeObserver = new ResizeObserver(wakeMap);
      resizeObserver.observe(mapContainer.current);
      window.addEventListener("load", wakeMap);
      window.addEventListener("pageshow", wakeMap);
      document.addEventListener("visibilitychange", handleVisibility);
      map.on("moveend", scheduleTilePrefetch);
      map.on("moveend", syncViewportBounds);
      map.on("zoomend", scheduleNodeGlow);
      map.on("resize", syncViewportBounds);
      map.on("idle", scheduleTilePrefetch);
      detachMapWakeups = () => {
        window.clearTimeout(prefetchTimer);
        window.clearTimeout(glowTimer);
        window.cancelAnimationFrame(glowFrame);
        resizeObserver.disconnect();
        window.removeEventListener("load", wakeMap);
        window.removeEventListener("pageshow", wakeMap);
        document.removeEventListener("visibilitychange", handleVisibility);
        map.off("moveend", scheduleTilePrefetch);
        map.off("moveend", syncViewportBounds);
        map.off("zoomend", scheduleNodeGlow);
        map.off("resize", syncViewportBounds);
        map.off("idle", scheduleTilePrefetch);
      };

      const initializeMapLayers = () => {
        if (cancelled || !map.isStyleLoaded() || map.getSource("clips")) return;
        mapLoadingRef.current?.classList.remove("visible");

        const star = makeTopStar();
        if (star) map.addImage("top-star", star, { pixelRatio: 2 });
        const titleBackground = makeTitleLabelBackground();
        if (titleBackground) {
          map.addImage("title-label-background", titleBackground, {
            pixelRatio: 2, stretchX: [[7, 16], [24, 33]], stretchY: [[7, 20]], content: [7, 5, 33, 25],
          });
        }
        const hoveredTitleBackground = makeTitleLabelBackground(true);
        if (hoveredTitleBackground) {
          map.addImage("title-label-hover-background", hoveredTitleBackground, {
            pixelRatio: 2, stretchX: [[7, 16], [24, 33]], stretchY: [[7, 20]], content: [7, 5, 33, 25],
          });
        }
        map.addSource("clips", {
          type: "geojson", data: placesToGeoJson(places), cluster: false,
        });
        map.addSource("active-clip", { type: "geojson", data: placesToGeoJson([]) });
        map.addSource("hovered-label", { type: "geojson", data: placesToGeoJson([]) });
        map.addSource("active-cluster", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "clip-clusters", type: "circle", source: "clips", filter: ["has", "point_count"],
          paint: {
            "circle-radius": ["step", ["get", "point_count"], 17.5, 10, 21, 100, 24],
            "circle-color": "#12334a", "circle-stroke-color": "#43dfd1", "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "cluster-count", type: "symbol", source: "clips", filter: ["has", "point_count"],
          layout: {
            "text-field": ["to-string", ["get", "point_count"]], "text-font": ["Arial"],
            "text-size": ["step", ["get", "point_count"], 13, 100, 12],
            "text-allow-overlap": true, "text-ignore-placement": true,
            "text-anchor": "center", "text-justify": "center", "text-letter-spacing": 0,
            "text-rotation-alignment": "viewport", "text-pitch-alignment": "viewport",
          },
          paint: { "text-color": "#ffffff", "text-halo-color": "rgba(5, 25, 39, .62)", "text-halo-width": 0.7 },
        });
        map.addLayer({
          id: "clip-points", type: "circle", source: "clips",
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "top"], false]],
          paint: {
            "circle-radius": ["case", ["get", "linked"], 5.5, 4.5],
            "circle-color": ["case", ["get", "linked"], "#39d9cc", "#7c9299"],
            "circle-color-transition": { duration: 0, delay: 0 },
            "circle-stroke-color": "#071827", "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: "top-points", type: "symbol", source: "clips",
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "top"], true]],
          layout: {
            "icon-image": "top-star", "icon-size": 0.55, "icon-allow-overlap": true,
            "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport", "icon-keep-upright": true,
          },
        });
        map.addLayer({
          id: "clip-labels", type: "symbol", source: "clips",
          filter: ["!", ["has", "point_count"]],
          layout: {
            visibility: "none", "icon-image": "title-label-background", "icon-text-fit": "both",
            "icon-text-fit-padding": [5, 8, 5, 8],
            "icon-allow-overlap": true, "icon-ignore-placement": true,
            "text-field": ["get", "name"], "text-font": ["Arial"], "text-size": 12,
            "text-anchor": "bottom", "text-offset": [0, -1.45], "text-max-width": 18,
            "text-allow-overlap": true, "text-ignore-placement": true,
            "text-rotation-alignment": "viewport", "text-pitch-alignment": "viewport",
            "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport",
          },
          paint: {
            "icon-opacity": ["case", ["boolean", ["feature-state", "title-hover"], false], 0, 1],
            "text-opacity": ["case", ["boolean", ["feature-state", "title-hover"], false], 0, 1],
            "text-color": "#efffff", "text-halo-color": "rgba(4, 11, 16, 0.45)",
            "text-halo-width": 0.7, "text-halo-blur": 0.2,
          },
        });
        map.addLayer({
          id: "hovered-clip-label", type: "symbol", source: "hovered-label",
          layout: {
            "icon-image": "title-label-hover-background", "icon-text-fit": "both", "icon-text-fit-padding": [5, 8, 5, 8],
            "icon-allow-overlap": true, "icon-ignore-placement": true,
            "text-field": ["get", "name"], "text-font": ["Arial"], "text-size": 12,
            "text-anchor": "bottom", "text-offset": [0, -1.45], "text-max-width": 18,
            "text-allow-overlap": true, "text-ignore-placement": true,
            "text-rotation-alignment": "viewport", "text-pitch-alignment": "viewport",
            "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport",
          },
          paint: {
            "icon-translate": [0, 0], "icon-translate-transition": { duration: 170, delay: 0 },
            "text-translate": [0, 0], "text-translate-transition": { duration: 170, delay: 0 },
            "text-color": "#f2ffff", "text-halo-color": "rgba(4, 34, 48, 0.74)", "text-halo-width": 0.9,
          },
        });
        map.addLayer({
          id: "active-clip-point", type: "circle", source: "active-clip",
          filter: ["==", ["get", "top"], false],
          paint: {
            "circle-radius": ["case", ["get", "linked"], 10.5, 8.25],
            "circle-color": ["case", ["get", "linked"], "#55eadc", "#91a5ac"],
            "circle-stroke-color": "#b9fff7", "circle-stroke-width": 2, "circle-blur": 0.06,
          },
        });
        map.addLayer({
          id: "active-top-halo", type: "circle", source: "active-clip",
          filter: ["==", ["get", "top"], true],
          paint: {
            "circle-radius": 14, "circle-color": "rgba(0, 0, 0, 0)",
            "circle-stroke-color": "#65eadf", "circle-stroke-width": 2.1, "circle-stroke-opacity": 0.8,
          },
        }, "top-points");
        map.addLayer({
          id: "clip-hit-area", type: "circle", source: "clips", filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": ["case", ["get", "top"], 20, ["get", "linked"], 12.75, 11.5],
            "circle-color": "rgba(0, 0, 0, 0.01)", "circle-stroke-width": 0,
          },
        });
        map.addLayer({
          id: "active-cluster", type: "circle", source: "active-cluster",
          paint: {
            "circle-radius": ["step", ["get", "point_count"], 19.25, 10, 23, 100, 26.5],
            "circle-color": "#18435e", "circle-stroke-color": "#65eadf", "circle-stroke-width": 2.3,
          },
        });

        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "clip-map-tooltip" });
        const clearHoveredTitleLabel = () => {
          window.clearTimeout(hoveredLabelLeaveTimerRef.current);
          const hoveredId = hoveredLabelIdRef.current;
          if (hoveredId !== null) map.setFeatureState({ source: "clips", id: hoveredId }, { "title-hover": false });
          (map.getSource("hovered-label") as GeoJSONSource).setData(placesToGeoJson([]));
          hoveredLabelIdRef.current = null;
        };
        const emphasizeTitleLabel = (place: Place) => {
          window.clearTimeout(hoveredLabelLeaveTimerRef.current);
          if (hoveredLabelIdRef.current !== place.id) clearHoveredTitleLabel();
          hoveredLabelIdRef.current = place.id;
          map.setFeatureState({ source: "clips", id: place.id }, { "title-hover": true });
          (map.getSource("hovered-label") as GeoJSONSource).setData(placesToGeoJson([place]));
          map.setPaintProperty("hovered-clip-label", "icon-translate", [0, 0]);
          map.setPaintProperty("hovered-clip-label", "text-translate", [0, 0]);
          window.requestAnimationFrame(() => {
            if (hoveredLabelIdRef.current !== place.id) return;
            map.setPaintProperty("hovered-clip-label", "icon-translate", [0, -7]);
            map.setPaintProperty("hovered-clip-label", "text-translate", [0, -7]);
          });
        };
        const deEmphasizeTitleLabel = () => {
          if (hoveredLabelIdRef.current === null) return;
          map.setPaintProperty("hovered-clip-label", "icon-translate", [0, 0]);
          map.setPaintProperty("hovered-clip-label", "text-translate", [0, 0]);
          hoveredLabelLeaveTimerRef.current = window.setTimeout(clearHoveredTitleLabel, 175);
        };
        const bindPointLayer = (layerId: string) => {
          map.on("mouseenter", layerId, (event) => {
            map.getCanvas().style.cursor = "pointer";
            const feature = event.features?.[0];
            if (!feature || feature.geometry.type !== "Point") return;
            const place = places.find((item) => item.id === Number(feature.properties?.id));
            setMapHoveredPlace(place ?? null);
            if (place && showTitlesRef.current) {
              popup.remove();
              emphasizeTitleLabel(place);
              return;
            }
            popup.setLngLat(feature.geometry.coordinates as [number, number])
              .setText(String(feature.properties?.name ?? "Névtelen klip")).addTo(map);
          });
          map.on("mouseleave", layerId, () => {
            map.getCanvas().style.cursor = "";
            setMapHoveredPlace(null);
            if (showTitlesRef.current) deEmphasizeTitleLabel(); else popup.remove();
          });
          map.on("click", layerId, (event) => {
            const id = Number(event.features?.[0]?.properties?.id);
            const place = places.find((item) => item.id === id);
            if (place?.clipUrl) setSelected(place);
          });
        };
        bindPointLayer("clip-hit-area");
        bindPointLayer("clip-labels");
        bindPointLayer("hovered-clip-label");
        map.on("mouseenter", "clip-clusters", (event) => {
          map.getCanvas().style.cursor = "pointer";
          const feature = event.features?.[0];
          if (!feature || feature.geometry.type !== "Point") return;
          (map.getSource("active-cluster") as GeoJSONSource).setData({
            type: "FeatureCollection",
            features: [{
              type: "Feature", geometry: feature.geometry,
              properties: { point_count: Number(feature.properties?.point_count ?? 2) },
            }],
          });
        });
        map.on("mouseleave", "clip-clusters", () => {
          map.getCanvas().style.cursor = "";
          (map.getSource("active-cluster") as GeoJSONSource).setData({ type: "FeatureCollection", features: [] });
        });
        map.on("click", "clip-clusters", (event) => {
          const feature = event.features?.[0];
          if (!feature || feature.geometry.type !== "Point") return;
          (map.getSource("active-cluster") as GeoJSONSource).setData({ type: "FeatureCollection", features: [] });
          const clusterId = Number(feature.properties?.cluster_id);
          const pointCount = Number(feature.properties?.point_count ?? 2);
          (map.getSource("clips") as GeoJSONSource).getClusterLeaves(clusterId, pointCount, 0).then((leaves) => {
            const coordinates = leaves.flatMap((leaf) => leaf.geometry.type === "Point"
              ? [[Number(leaf.geometry.coordinates[0]), Number(leaf.geometry.coordinates[1])]] : []);
            if (!coordinates.length) return;
            const west = Math.min(...coordinates.map(([longitude]) => longitude));
            const east = Math.max(...coordinates.map(([longitude]) => longitude));
            const south = Math.min(...coordinates.map(([, latitude]) => latitude));
            const north = Math.max(...coordinates.map(([, latitude]) => latitude));
            const focus = getClusterFocusOptions(map, listOpenRef.current, listPanelRef.current);
            if (west === east && south === north) {
              const { offset } = getListAwareMapOptions(map, listOpenRef.current, listPanelRef.current);
              map.easeTo({ center: [west, south], zoom: 17, offset, duration: 720 });
            } else {
              map.fitBounds([[west, south], [east, north]], { padding: focus.padding, maxZoom: 17, duration: 720 });
            }
          }).catch(() => {});
        });
        map.on("click", (event) => {
          const interactiveFeatures = map.queryRenderedFeatures(event.point, {
            layers: ["clip-clusters", "cluster-count", "clip-hit-area", "clip-points", "top-points", "clip-labels", "hovered-clip-label", "active-clip-point", "active-top-halo", "active-cluster"],
          });
          if (!interactiveFeatures.length) {
            setListOpen(false);
            setFiltersOpen(false);
          }
        });

        const loadCountryBorders = () => {
          fetch(COUNTRY_BORDERS_URL).then((response) => response.ok ? response.json() : null).then((geoJson) => {
            if (cancelled || !geoJson || map.getSource("country-borders")) return;
            map.addSource("country-borders", { type: "geojson", data: geoJson });
            map.addLayer({
              id: "country-borders", type: "line", source: "country-borders",
              paint: { "line-color": "#86a8b3", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.1, 8, 1.6, 14, 2], "line-opacity": 0.68 },
            }, "clip-clusters");
          }).catch(() => {});
        };
        if ("requestIdleCallback" in window) window.requestIdleCallback(loadCountryBorders, { timeout: 1800 });
        else window.setTimeout(loadCountryBorders, 900);

        setMapReady(true);
        syncViewportBounds();
        wakeMap();
      };
      map.on("styledata", initializeMapLayers);
      map.on("load", initializeMapLayers);
      map.on("idle", initializeMapLayers);
      initializeMapLayers();
    });
    return () => {
      cancelled = true;
      detachMapWakeups();
      htmlMarkersRef.current.clear();
      mapRef.current?.remove(); mapRef.current = null;
    };
  }, [places]);

  useEffect(() => {
    const visibleIds = new Set(visiblePlaces.map((place) => place.id));
    htmlMarkersRef.current.forEach((element, id) => {
      element.style.display = visibleIds.has(id) ? "block" : "none";
    });
  }, [visiblePlaces]);

  useEffect(() => {
    const source = mapRef.current?.getSource("clips") as GeoJSONSource | undefined;
    if (!mapReady || !source) return;
    source.setData(placesToGeoJson(visiblePlaces));
  }, [mapReady, visiblePlaces]);

  useEffect(() => {
    const source = mapRef.current?.getSource("active-clip") as GeoJSONSource | undefined;
    if (!mapReady || !source) return;
    source.setData(placesToGeoJson(highlightedPlace ? [highlightedPlace] : []));
  }, [highlightedPlace, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer("clip-labels")) return;
    showTitlesRef.current = showTitles;
    map.setLayoutProperty("clip-labels", "visibility", showTitles ? "visible" : "none");
    map.setLayoutProperty("hovered-clip-label", "visibility", showTitles ? "visible" : "none");
    if (!showTitles && hoveredLabelIdRef.current !== null) {
      map.setFeatureState({ source: "clips", id: hoveredLabelIdRef.current }, { "title-hover": false });
      (map.getSource("hovered-label") as GeoJSONSource | undefined)?.setData(placesToGeoJson([]));
      hoveredLabelIdRef.current = null;
    }
  }, [mapReady, showTitles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!visiblePlaces.length) {
      map.stop();
      const origin = searchTokens.length ? searchOriginRef.current : null;
      if (origin) map.easeTo({ center: origin.center, zoom: origin.zoom, duration: 350 });
      return;
    }
    const timeout = window.setTimeout(() => {
      const { offset, padding } = getListAwareMapOptions(map, listOpen, listPanelRef.current);
      if (visiblePlaces.length === 1) {
        map.easeTo({ center: [visiblePlaces[0].longitude, visiblePlaces[0].latitude], zoom: 14, offset, duration: 650 });
        return;
      }
      const west = Math.min(...visiblePlaces.map((place) => place.longitude));
      const east = Math.max(...visiblePlaces.map((place) => place.longitude));
      const south = Math.min(...visiblePlaces.map((place) => place.latitude));
      const north = Math.max(...visiblePlaces.map((place) => place.latitude));
      const maxZoom = visiblePlaces.length <= 4 ? 13 : visiblePlaces.length <= 20 ? 11 : 7;
      map.fitBounds([[west, south], [east, north]], {
        padding, maxZoom, duration: 650,
      });
    }, searchTokens.length ? 260 : 0);
    return () => window.clearTimeout(timeout);
  }, [mapReady, searchTokens.length, visiblePlaces]);

  useEffect(() => {
    if (activeListPlace && !listPlaces.some((place) => place.id === activeListPlace.id)) {
      setActiveListPlace(null);
      setConnectorLine(null);
    }
    if (hoveredListPlace && !listPlaces.some((place) => place.id === hoveredListPlace.id)) {
      setHoveredListPlace(null);
    }
  }, [activeListPlace, hoveredListPlace, listPlaces]);

  useEffect(() => {
    const map = mapRef.current;
    const panel = listPanelRef.current;
    const scroll = listScrollRef.current;
    if (!mapReady || !map || !listOpen || !connectorPlace || !panel || !scroll) {
      setConnectorLine(null);
      return;
    }
    let animationFrame = 0;
    const updateConnector = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const row = listRowRefs.current.get(connectorPlace.id);
        if (!row) return setConnectorLine(null);
        const rowRect = row.getBoundingClientRect();
        const scrollRect = scroll.getBoundingClientRect();
        if (rowRect.bottom < scrollRect.top || rowRect.top > scrollRect.bottom) return setConnectorLine(null);
        const mapRect = map.getContainer().getBoundingClientRect();
        const projected = map.project([connectorPlace.longitude, connectorPlace.latitude]);
        const left = rowRect.right - 3;
        const top = rowRect.top + rowRect.height / 2;
        const endX = mapRect.left + projected.x;
        const endY = mapRect.top + projected.y;
        const deltaX = endX - left;
        const deltaY = endY - top;
        setConnectorLine({
          left, top, width: Math.hypot(deltaX, deltaY), angle: Math.atan2(deltaY, deltaX) * 180 / Math.PI,
          preview: Boolean(hoveredListPlace && hoveredListPlace.id !== activeListPlace?.id),
        });
      });
    };
    updateConnector();
    map.on("move", updateConnector);
    map.on("resize", updateConnector);
    scroll.addEventListener("scroll", updateConnector, { passive: true });
    window.addEventListener("resize", updateConnector);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      map.off("move", updateConnector);
      map.off("resize", updateConnector);
      scroll.removeEventListener("scroll", updateConnector);
      window.removeEventListener("resize", updateConnector);
    };
  }, [activeListPlace, connectorPlace, hoveredListPlace, listOpen, mapReady]);

  useEffect(() => {
    if (!listOpen) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setListOpen(false);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [listOpen]);

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setSelected(null);
    document.addEventListener("keydown", close); document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", close); document.body.classList.remove("modal-open"); };
  }, [selected]);

  const toggleFilter = (value: string, current: string[], update: (values: string[]) => void) =>
    update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  const updateSearchQuery = (nextQuery: string) => {
    const map = mapRef.current;
    const previous = normalizeSearch(searchQuery);
    const next = normalizeSearch(nextQuery);
    if (!previous && next && map) {
      const center = map.getCenter();
      searchOriginRef.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
    } else if (!next) {
      searchOriginRef.current = null;
    }
    setSuggestionCursor(0);
    setSearchQuery(nextQuery);
  };

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    updateSearchQuery(suggestion.label);
    setSearchFocused(false);
  };

  const focusListPlace = (place: Place) => {
    setActiveListPlace(place);
    const map = mapRef.current;
    if (!map) return;
    map.stop();
    const { offset } = getListAwareMapOptions(map, true, listPanelRef.current);
    map.easeTo({ center: [place.longitude, place.latitude], zoom: 15, offset, duration: 720 });
  };

  const activateListPlace = (place: Place) => {
    if (activeListPlace?.id === place.id) {
      if (place.clipUrl) setSelected(place);
      return;
    }
    focusListPlace(place);
  };

  const toggleListSort = (nextSort: "date" | "name") => {
    if (nextSort === listSort) {
      setListSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    } else {
      setListSort(nextSort);
      setListSortDirection(nextSort === "date" ? "desc" : "asc");
    }
  };

  const clearAllFilters = () => {
    if (!hasActiveFilters) return;
    setSelectedCategories(categories);
    setSelectedCountries(countries);
    setTopOnly(false);
    setListTopOnly(false);
    setSearchQuery("");
    setSearchFocused(false);
    setActiveListPlace(null);
    setHoveredListPlace(null);
    searchOriginRef.current = null;
    const map = mapRef.current;
    if (!map || !places.length) return;
    const west = Math.min(...places.map((place) => place.longitude));
    const east = Math.max(...places.map((place) => place.longitude));
    const south = Math.min(...places.map((place) => place.latitude));
    const north = Math.max(...places.map((place) => place.latitude));
    map.stop();
    const { padding } = getListAwareMapOptions(map, listOpen, listPanelRef.current, 64);
    map.fitBounds([[west, south], [east, north]], {
      padding, maxZoom: 7, duration: 700,
    });
  };
  const parent = typeof window === "undefined" ? "localhost" : window.location.hostname;
  const clipId = selected ? getClipId(selected.clipUrl) : "";

  return (
    <main className="site-shell">
      <header className="site-header">
        <div className="identity">
          <div className="wordmark" aria-label="Geri Clips"><span>Geri</span><em>Clips</em></div>
        </div>
        <a className="twitch-button" href={TWITCH_URL} target="_blank" rel="noreferrer">Twitch profil</a>
        {online && (
          <a className="live-button" href={TWITCH_URL} target="_blank" rel="noreferrer">
            <span className="live-led" aria-hidden="true" />LIVE
          </a>
        )}
      </header>

      <div className="filter-area">
        <div className="search-box">
          <span className="search-icon" aria-hidden="true" />
          <input type="search" value={searchQuery} onChange={(event) => updateSearchQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)} onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && searchSuggestions.length) {
                event.preventDefault(); setSuggestionCursor((cursor) => (cursor + 1) % searchSuggestions.length);
              } else if (event.key === "ArrowUp" && searchSuggestions.length) {
                event.preventDefault(); setSuggestionCursor((cursor) => (cursor - 1 + searchSuggestions.length) % searchSuggestions.length);
              } else if (event.key === "Enter" && searchSuggestions[suggestionCursor]) {
                event.preventDefault(); chooseSuggestion(searchSuggestions[suggestionCursor]);
              } else if (event.key === "Escape") setSearchFocused(false);
            }}
            placeholder="Balaton, vicces, zene, ..." aria-label="Keresés a klipek között"
            aria-autocomplete="list" aria-controls="search-suggestions" />
          {searchQuery && <button className="search-clear" onClick={() => updateSearchQuery("")} aria-label="Keresés törlése">×</button>}
          {searchFocused && normalizeSearch(searchQuery).length >= 2 && (
            <div className="search-suggestions" id="search-suggestions" role="listbox">
              {searchSuggestions.length ? searchSuggestions.map((suggestion, index) => (
                <button key={suggestion.normalized} type="button" role="option" aria-selected={index === suggestionCursor}
                  className={index === suggestionCursor ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)}>
                  <span className="suggestion-label">{suggestion.label}</span>
                  <span className="suggestion-meta">{suggestion.kind} · {suggestion.count} találat</span>
                </button>
              )) : <p className="search-empty">Nincs találat</p>}
            </div>
          )}
        </div>
        <button className={`title-toggle ${showTitles ? "active" : ""}`} type="button" role="switch"
          aria-checked={showTitles} aria-label="Klipcímek megjelenítése"
          onClick={() => setShowTitles((visible) => !visible)}>
          <span className="title-toggle-track" aria-hidden="true"><i /></span><b>Címek</b>
        </button>
        <button className="filter-button" onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen} aria-controls="filters-panel">
          <span className="filter-icon" aria-hidden="true"><i /><i /><i /></span>Szűrők
        </button>
        {filtersOpen && (
          <section className="filters-panel" id="filters-panel" aria-label="Térképszűrők">
              <div className="filter-section">
                <h2>Kiemelt klipek</h2>
                <div className="filter-options single-option">
                  <label><input type="checkbox" checked={topOnly} onChange={() => setTopOnly((value) => !value)} />
                    <span>Csak TOP klipek <small>({topCount})</small></span></label>
                </div>
              </div>
              <div className="filter-section">
                <h2>Kategória</h2>
                <div className="filter-options">
                  <label className="select-all-option">
                    <input type="checkbox" checked={selectedCategories.length === categories.length}
                      onChange={() => setSelectedCategories(selectedCategories.length === categories.length ? [] : categories)} />
                    <span>ÖSSZES</span>
                  </label>
                  {categories.map((category) => (
                    <label key={category}><input type="checkbox" checked={selectedCategories.includes(category)}
                      onChange={() => toggleFilter(category, selectedCategories, setSelectedCategories)} />
                      <span>{category} <small>({categoryCounts[category]})</small></span></label>
                  ))}
                </div>
              </div>
          </section>
        )}
      </div>

      <div className={`clip-list-shell ${listOpen ? "open" : ""}`}>
        <aside className="clip-list-panel" ref={listPanelRef} aria-label="Kliplista">
          <div className="clip-list-heading">
            <div className="clip-list-titlebar"><h2>Lista</h2><small>{listPlaces.length} klip</small></div>
            <div className="clip-list-toolbar">
              <button type="button" className="list-clear-button" disabled={!hasActiveFilters} onClick={clearAllFilters}>ÖSSZES</button>
              <button type="button" className={`list-top-toggle ${listTopOnly ? "active" : ""}`}
                aria-pressed={listTopOnly} onClick={() => setListTopOnly((onlyTop) => !onlyTop)}>
                <span aria-hidden="true"><i /></span>TOP
              </button>
              <div className="list-sort" aria-label="Lista sorrendje">
                {(["date", "name"] as const).map((sort) => (
                  <button key={sort} type="button" className={listSort === sort ? "active" : ""}
                    aria-pressed={listSort === sort} onClick={() => toggleListSort(sort)}>
                    {sort === "date" ? "Dátum" : "Név"}
                    {listSort === sort && <span aria-hidden="true">{listSortDirection === "asc" ? "↑" : "↓"}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="clip-list-scroll" ref={listScrollRef}>
            {listOpen ? (listPlaces.length ? listPlaces.map((place) => (
              <div key={place.id} role="button" tabIndex={0}
                ref={(element) => { if (element) listRowRefs.current.set(place.id, element); else listRowRefs.current.delete(place.id); }}
                className={`clip-list-row ${!place.clipUrl ? "inactive" : ""} ${activeListPlace?.id === place.id ? "active" : ""} ${mapHoveredPlace?.id === place.id ? "map-hovered" : ""}`}
                onMouseEnter={() => setHoveredListPlace(place)} onMouseLeave={() => setHoveredListPlace(null)}
                onClick={() => activateListPlace(place)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault(); activateListPlace(place);
                }} title={!place.clipUrl ? "Ehhez a helyhez nincs lejátszható klip" : undefined}>
                <button className="list-play-button" type="button" disabled={!place.clipUrl}
                  aria-label={place.clipUrl ? `${place.name || "Névtelen klip"} lejátszása` : "Nincs lejátszható klip"}
                  onClick={(event) => { event.stopPropagation(); if (place.clipUrl) setSelected(place); }} />
                {place.top && <span className="list-top-badge">TOP</span>}
                <span className="clip-list-title">{place.name || "Névtelen klip"}</span>
                {place.clipDate && <time dateTime={place.clipDate}>{place.clipDate.replaceAll("-", "/")}</time>}
              </div>
            )) : <p className="clip-list-empty">Nincs megjeleníthető klip.</p>) : null}
          </div>
        </aside>
        <button className={`clip-list-toggle ${listAttention && !listOpen ? "attention" : ""}`} type="button" onClick={() => setListOpen((open) => !open)}
          aria-expanded={listOpen} aria-label={listOpen ? "Lista bezárása" : "Lista megnyitása"}>
          <span aria-hidden="true">›</span><b>Lista</b>
        </button>
      </div>
      {connectorLine && <div className={`clip-connector ${connectorLine.preview ? "preview" : ""}`} aria-hidden="true" style={{
        left: connectorLine.left, top: connectorLine.top, width: connectorLine.width,
        transform: `rotate(${connectorLine.angle}deg)`,
      }} />}

      <div ref={mapContainer} className="map" aria-label="Geri klipjeinek interaktív térképe"
        data-visible-count={visiblePlaces.length} />
      <div ref={mapLoadingRef} className="map-loading" role="status" aria-label="Térkép betöltése">
        <span className="map-loading-spinner" aria-hidden="true" />
      </div>

      {selected && clipId && (
        <div className="modal-backdrop">
          <button className="modal-dismiss" onClick={() => setSelected(null)} aria-label="Klip bezárása" />
          <section className="clip-modal" role="dialog" aria-modal="true" aria-labelledby="clip-modal-title">
            <div className="modal-heading">
              <h2 id="clip-modal-title">{selected.name}</h2>
              <div className="modal-actions">
                {selected.top && <span className="top-badge">TOP</span>}
                <button className="close-button" onClick={() => setSelected(null)} aria-label="Klip bezárása"><span /><span /></button>
              </div>
            </div>
            <ClipPlayer key={clipId} clipId={clipId} parent={parent} title={selected.twitchTitle || selected.name} />
            {selected.sourceKeywords && <p className="clip-source-keywords">{selected.sourceKeywords}</p>}
          </section>
        </div>
      )}
      <div className="site-credit">
        vibecoded with love :: powered by{" "}
        <a href="https://nagz.space" target="_blank" rel="noopener noreferrer">
          nagz.space
        </a>
      </div>
    </main>
  );
}
