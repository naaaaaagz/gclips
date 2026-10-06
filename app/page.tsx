"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getClipId } from "../lib/clip-data.mjs";
import { createTilePrefetcher, tileRingUrls } from "../lib/tile-prefetch.mjs";
import placesSnapshot from "../data/places-snapshot.json";
import { manageModalFocus } from "../lib/modal-focus.mjs";

const TWITCH_URL = "https://www.twitch.tv/agerivagyok";
const BASE_TILE_URL = "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png?key=cb1_25b0_1_cf52869ae38041a055110db7";
const LABEL_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const MAP_STYLE: StyleSpecification = {
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
      attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community",
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
function getViewportBounds(map: MapLibreMap): ViewportBounds {
  const bounds = map.getBounds();
  return { west: bounds.getWest(), east: bounds.getEast(), south: bounds.getSouth(), north: bounds.getNorth() };
}

function prefetchTileRing(map: MapLibreMap, prefetcher: ReturnType<typeof createTilePrefetcher>) {
  const bounds = getViewportBounds(map);
  const zoom = Math.max(2, Math.min(20, Math.floor(map.getZoom())));
  prefetcher.update([...tileRingUrls(bounds, zoom, BASE_TILE_URL), ...tileRingUrls(bounds, Math.min(16, zoom), LABEL_TILE_URL)]);
}

type Place = {
  id: number; name: string; clipUrl: string; category: string;
  sourceKeywords: string; keywords: string; latitude: number; longitude: number;
  twitchTitle: string; country: string; clipDate: string; top: boolean;
  twitchCategory: string; zedSource: boolean;
};

type SearchSuggestion = {
  label: string; normalized: string; kind: string; count: number; topHits: number; priority: number;
};

type ConnectorLine = { left: number; top: number; width: number; angle: number; preview: boolean };
type ViewportBounds = { west: number; east: number; south: number; north: number };

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

function placeIdsInVisibleMapArea(places: Place[], map: MapLibreMap, listOpen: boolean, panel: HTMLElement | null) {
  const bounds = getViewportBounds(map);
  const rect = getMapContentRect(map, listOpen, panel);
  const ids = new Set<number>();
  for (const place of places) {
    if (!placeIsInViewport(place, bounds)) continue;
    const point = map.project([place.longitude, place.latitude]);
    if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) ids.add(place.id);
  }
  return ids;
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
        zedSource: place.zedSource,
      },
    })),
  };
}

let starCanvas: HTMLCanvasElement | null = null;

function makeTopStar(glow = 0, zed = false) {
  const size = 80;
  starCanvas ??= document.createElement("canvas");
  const canvas = starCanvas;
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
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
  gradient.addColorStop(0, brighten(zed ? "#fff0dc" : "#b9fff7"));
  gradient.addColorStop(0.58, brighten(zed ? "#f6bd7b" : "#39d9cc"));
  gradient.addColorStop(1, brighten(zed ? "#c8743f" : "#247fa3"));
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
  const listPanelRef = useRef<HTMLElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listRowRefs = useRef(new Map<number, HTMLDivElement>());
  const [places, setPlaces] = useState<Place[]>([]);
  const [dataError, setDataError] = useState("");
  const [dataAttempt, setDataAttempt] = useState(0);
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
  const [showZed, setShowZed] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [listTopOnly, setListTopOnly] = useState(false);
  const [listSort, setListSort] = useState<"date" | "name">("date");
  const [listSortDirection, setListSortDirection] = useState<"asc" | "desc">("desc");
  const [activeListChoice, setActiveListPlace] = useState<Place | null>(null);
  const [hoveredListChoice, setHoveredListPlace] = useState<Place | null>(null);
  const [mapHoveredPlace, setMapHoveredPlace] = useState<Place | null>(null);
  const [listAreaIds, setListAreaIds] = useState<Set<number> | null>(null);
  const syncListAreaRef = useRef<() => void>(() => {});
  const [connectorLine, setConnectorLine] = useState<ConnectorLine | null>(null);
  const [online, setOnline] = useState(false);
  const [listAttention, setListAttention] = useState(false);
  const listAttentionPlayedRef = useRef(false);
  const listAttentionTimerRef = useRef(0);
  const listOpenRef = useRef(false);
  const showTitlesRef = useRef(false);
  const hoveredLabelIdRef = useRef<number | null>(null);
  const hoveredLabelLeaveTimerRef = useRef(0);
  const initialFitRef = useRef(true);

  const categories = useMemo(() => unique(places.map((place) => place.category)), [places]);
  const countries = useMemo(() => unique(places.map((place) => place.country))
    .sort((a, b) => countryNameHu(a).localeCompare(countryNameHu(b), "hu")), [places]);
  const categoryCounts = useMemo(() => countValues(places.map((place) => place.category)), [places]);
  const countryCounts = useMemo(() => countValues(places.map((place) => place.country)), [places]);
  const topCount = useMemo(() => places.filter((place) => place.top).length, [places]);
  const searchTokens = useMemo(() => normalizeSearch(searchQuery).split(/\s+/).filter(Boolean), [searchQuery]);
  const suggestionIndex = useMemo(() => buildSearchSuggestions(places), [places]);
  const searchSuggestions = useMemo(() => rankSearchSuggestions(suggestionIndex, searchQuery), [suggestionIndex, searchQuery]);
  const suggestionsOpen = searchFocused && normalizeSearch(searchQuery).length >= 2;
  const visiblePlaces = useMemo(() => places.filter((place) => {
    if (!showZed && place.zedSource) return false;
    if ((place.category && !selectedCategories.includes(place.category)) || (place.country && !selectedCountries.includes(place.country))) return false;
    if (topOnly && !place.top) return false;
    if (!searchTokens.length) return true;
    const haystack = normalizeSearch([
      place.keywords, place.sourceKeywords, place.category, place.name, place.twitchTitle,
      place.twitchCategory, place.country, countryNameHu(place.country),
    ].join(" "));
    return searchTokens.every((token) => haystack.includes(token));
  }), [places, searchTokens, selectedCategories, selectedCountries, showZed, topOnly]);
  const listPlaces = useMemo(() => {
    const items = visiblePlaces.filter((place) => (!listAreaIds || listAreaIds.has(place.id))
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
  }, [listAreaIds, listSort, listSortDirection, listTopOnly, visiblePlaces]);
  // A row that scrolled out of the list is no longer active or hovered.
  const activeListPlace = activeListChoice && listPlaces.some((place) => place.id === activeListChoice.id) ? activeListChoice : null;
  const hoveredListPlace = hoveredListChoice && listPlaces.some((place) => place.id === hoveredListChoice.id) ? hoveredListChoice : null;
  const connectorPlace = hoveredListPlace ?? activeListPlace;
  const highlightedPlace = hoveredListPlace ?? mapHoveredPlace;
  const viewportHidesClips = useMemo(() => Boolean(listAreaIds)
    && visiblePlaces.some((place) => !listAreaIds?.has(place.id)), [listAreaIds, visiblePlaces]);
  const hasActiveFilters = !showZed || topOnly || listTopOnly || Boolean(searchTokens.length)
    || selectedCategories.length !== categories.length || selectedCountries.length !== countries.length || viewportHidesClips;

  useEffect(() => { listOpenRef.current = listOpen; syncListAreaRef.current(); }, [listOpen]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch("/api/places", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }).then((response) => {
      if (!response.ok) throw new Error("A helyszínek nem tölthetők be");
      return response.json();
    }).then((data: Place[]) => {
      if (!active) return;
      if (!Array.isArray(data)) throw new Error("Invalid map data");
      setDataError(data.length ? "" : "Nincs megjeleníthető klip.");
      setPlaces(data);
      setSelectedCategories(unique(data.map((place) => place.category)));
      setSelectedCountries(unique(data.map((place) => place.country)));
    }).catch(() => {
      if (!active) return;
      setDataError("A friss adatok nem tölthetők be. A mentett klipeket mutatjuk.");
      setPlaces(placesSnapshot);
      setSelectedCategories(unique(placesSnapshot.map((place) => place.category)));
      setSelectedCountries(unique(placesSnapshot.map((place) => place.country)));
    });
    return () => { active = false; controller.abort(); };
  }, [dataAttempt]);

  useEffect(() => {
    if (window.location.hostname.endsWith("github.io")) return;
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
      const maplibregl = maplibreModule;
      if (cancelled || !mapContainer.current) return;
      // The worker imports ./maplibre-gl-shared.mjs, so both are served unbundled from public/.
      maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: MAP_STYLE,
        center: [13.9, 47.8], zoom: 4, minZoom: 2, maxZoom: 17,
        attributionControl: false, fadeDuration: 0,
        maxTileCacheZoomLevels: 8,
        cancelPendingTileRequestsWhileZooming: false,
      });
      mapRef.current = map;
      setMapReady(false);
      mapLoadingRef.current?.classList.add("visible");
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

      let prefetchTimer = 0;
      const prefetcher = createTilePrefetcher();
      let glowTimer = 0;
      let glowFrame = 0;
      const scheduleTilePrefetch = () => {
        window.clearTimeout(prefetchTimer);
        prefetchTimer = window.setTimeout(() => prefetchTileRing(map, prefetcher), 140);
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
            map.setPaintProperty("clip-points", "circle-color", ["case", ["get", "zedSource"], "#f6bd7b", ["get", "linked"], `rgb(${color.join(",")})`, "#7c9299"]);
            const glowingStar = makeTopStar(strength);
            if (glowingStar) map.updateImage("top-star", glowingStar);
            const glowingZedStar = makeTopStar(strength, true);
            if (glowingZedStar && map.hasImage("zed-top-star")) map.updateImage("zed-top-star", glowingZedStar);
            if (progress < 1) glowFrame = window.requestAnimationFrame(render);
            else {
              map.setPaintProperty("clip-points", "circle-color", ["case", ["get", "zedSource"], "#f6bd7b", ["get", "linked"], "#39d9cc", "#7c9299"]);
              const baseStar = makeTopStar();
              if (baseStar) map.updateImage("top-star", baseStar);
              const baseZedStar = makeTopStar(0, true);
              if (baseZedStar && map.hasImage("zed-top-star")) map.updateImage("zed-top-star", baseZedStar);
            }
          };
          glowFrame = window.requestAnimationFrame(render);
        }, 60);
      };
      const syncListArea = () => {
        if (cancelled) return;
        setListAreaIds(placeIdsInVisibleMapArea(places, map, listOpenRef.current, listPanelRef.current));
      };
      syncListAreaRef.current = syncListArea;
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
      map.on("moveend", syncListArea);
      map.on("zoomend", scheduleNodeGlow);
      map.on("resize", syncListArea);
      map.on("idle", scheduleTilePrefetch);
      detachMapWakeups = () => {
        window.clearTimeout(prefetchTimer);
        prefetcher.dispose();
        syncListAreaRef.current = () => {};
        window.clearTimeout(glowTimer);
        window.cancelAnimationFrame(glowFrame);
        resizeObserver.disconnect();
        window.removeEventListener("load", wakeMap);
        window.removeEventListener("pageshow", wakeMap);
        document.removeEventListener("visibilitychange", handleVisibility);
        map.off("moveend", scheduleTilePrefetch);
        map.off("moveend", syncListArea);
        map.off("zoomend", scheduleNodeGlow);
        map.off("resize", syncListArea);
        map.off("idle", scheduleTilePrefetch);
      };

      map.on("load", () => {
        if (cancelled) return;
        mapLoadingRef.current?.classList.remove("visible");

        const star = makeTopStar();
        if (star) map.addImage("top-star", star, { pixelRatio: 2 });
        const zedStar = makeTopStar(0, true);
        if (zedStar) map.addImage("zed-top-star", zedStar, { pixelRatio: 2 });
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
          type: "geojson", data: placesToGeoJson(places), cluster: true, clusterMaxZoom: 16, clusterRadius: 22,
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
            "text-field": ["to-string", ["get", "point_count"]], "text-font": ["Open Sans Regular"],
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
            "circle-color": ["case", ["get", "zedSource"], "#f6bd7b", ["get", "linked"], "#39d9cc", "#7c9299"],
            "circle-color-transition": { duration: 0, delay: 0 },
            "circle-stroke-color": "#071827", "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: "top-points", type: "symbol", source: "clips",
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "top"], true]],
          layout: {
            "icon-image": ["case", ["get", "zedSource"], "zed-top-star", "top-star"], "icon-size": 0.55, "icon-allow-overlap": true,
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
            "text-field": ["get", "name"], "text-font": ["Open Sans Regular"], "text-size": 12,
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
            "text-field": ["get", "name"], "text-font": ["Open Sans Regular"], "text-size": 12,
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
            "circle-color": ["case", ["get", "zedSource"], "#ffd19d", ["get", "linked"], "#55eadc", "#91a5ac"],
            "circle-stroke-color": ["case", ["get", "zedSource"], "#fff0dc", "#b9fff7"], "circle-stroke-width": 2, "circle-blur": 0.06,
          },
        });
        map.addLayer({
          id: "active-top-halo", type: "circle", source: "active-clip",
          filter: ["==", ["get", "top"], true],
          paint: {
            "circle-radius": 14, "circle-color": "rgba(0, 0, 0, 0)",
            "circle-stroke-color": ["case", ["get", "zedSource"], "#ffd19d", "#65eadf"], "circle-stroke-width": 2.1, "circle-stroke-opacity": 0.8,
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
        else setTimeout(loadCountryBorders, 900);

        setMapReady(true);
        syncListArea();
        wakeMap();
      });
    });
    return () => {
      cancelled = true;
      detachMapWakeups();
      mapRef.current?.remove(); mapRef.current = null;
    };
  }, [places]);

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
      return;
    }
    const timeout = window.setTimeout(() => {
      const { offset, padding } = getListAwareMapOptions(map, listOpenRef.current, listPanelRef.current);
      if (visiblePlaces.length === 1) {
        map.easeTo({ center: [visiblePlaces[0].longitude, visiblePlaces[0].latitude], zoom: 14, offset, duration: 650 });
        return;
      }
      const west = Math.min(...visiblePlaces.map((place) => place.longitude));
      const east = Math.max(...visiblePlaces.map((place) => place.longitude));
      const south = Math.min(...visiblePlaces.map((place) => place.latitude));
      const north = Math.max(...visiblePlaces.map((place) => place.latitude));
      const maxZoom = visiblePlaces.length <= 4 ? 13 : visiblePlaces.length <= 20 ? 11 : 7;
      const initialFit = initialFitRef.current;
      map.fitBounds([[west, south], [east, north]], {
        padding, maxZoom, duration: initialFit ? 0 : 650,
      });
      if (initialFit) {
        map.setZoom(Math.max(map.getMinZoom(), map.getZoom() - 1));
        initialFitRef.current = false;
      }
    }, searchTokens.length ? 260 : 0);
    return () => window.clearTimeout(timeout);
  }, [mapReady, searchTokens.length, visiblePlaces]);

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
    if (selected || (!listOpen && !filtersOpen)) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (filtersOpen) setFiltersOpen(false);
      else setListOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [filtersOpen, listOpen, selected]);

  useEffect(() => {
    if (!selected) return;
    const dialog = document.querySelector<HTMLElement>(".clip-modal");
    if (!dialog) return;
    const releaseFocus = manageModalFocus(dialog, () => setSelected(null));
    document.body.classList.add("modal-open");
    return () => { releaseFocus(); document.body.classList.remove("modal-open"); };
  }, [selected]);

  const toggleFilter = (value: string, current: string[], update: (values: string[]) => void) =>
    update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  const updateSearchQuery = (nextQuery: string) => {
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
    setShowZed(true);
    setListTopOnly(false);
    setSearchQuery("");
    setSearchFocused(false);
    setActiveListPlace(null);
    setHoveredListPlace(null);
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
          <h1 className="wordmark" aria-label="Geri Clips"><span>Geri</span><em>Clips</em></h1>
        </div>
        <a className="twitch-button" href={TWITCH_URL} target="_blank" rel="noreferrer">Twitch-profil</a>
        {online && (
          <a className="live-button" href={TWITCH_URL} target="_blank" rel="noreferrer">
            <span className="live-led" aria-hidden="true" />LIVE
          </a>
        )}
      </header>

      <div className="filter-area">
        <div className="search-box">
          <span className="search-icon" aria-hidden="true" />
          <input type="search" value={searchQuery} onChange={(event) => { setSearchFocused(true); updateSearchQuery(event.target.value); }}
            onFocus={() => setSearchFocused(true)} onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
            onKeyDown={(event) => {
              if (!suggestionsOpen) return;
              if (event.key === "ArrowDown" && searchSuggestions.length) {
                event.preventDefault(); setSuggestionCursor((cursor) => (cursor + 1) % searchSuggestions.length);
              } else if (event.key === "ArrowUp" && searchSuggestions.length) {
                event.preventDefault(); setSuggestionCursor((cursor) => (cursor - 1 + searchSuggestions.length) % searchSuggestions.length);
              } else if (event.key === "Enter" && searchSuggestions[suggestionCursor]) {
                event.preventDefault(); chooseSuggestion(searchSuggestions[suggestionCursor]);
              } else if (event.key === "Escape") {
                // React listens on the document too, so mark the event handled for the close-panels listener.
                event.preventDefault(); event.stopPropagation(); setSearchFocused(false);
              }
            }}
            placeholder="Balaton, vicces, zene…" aria-label="Keresés a klipek között"
            role="combobox" aria-expanded={suggestionsOpen} aria-autocomplete="list" aria-controls="search-suggestions"
            aria-activedescendant={suggestionsOpen && searchSuggestions[suggestionCursor] ? `search-option-${suggestionCursor}` : undefined} />
          {searchQuery && <button className="search-clear" onClick={() => updateSearchQuery("")} aria-label="Keresés törlése">×</button>}
          {suggestionsOpen && (
            <div className="search-suggestions" id="search-suggestions" role="listbox">
              {searchSuggestions.length ? searchSuggestions.map((suggestion, index) => (
                <button key={suggestion.normalized} id={`search-option-${index}`} type="button" tabIndex={-1} role="option" aria-selected={index === suggestionCursor}
                  className={index === suggestionCursor ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)}>
                  <span className="suggestion-label">{suggestion.label}</span>
                  <span className="suggestion-meta">{suggestion.kind} · {suggestion.count} találat</span>
                </button>
              )) : <p className="search-empty">Nincs találat</p>}
            </div>
          )}
        </div>
        <button className={`title-toggle zed-toggle ${showZed ? "active" : ""}`} type="button" role="switch"
          aria-checked={showZed} aria-label="Zed streamjéből származó klipek megjelenítése"
          onClick={() => setShowZed((visible) => !visible)}>
          <span className="title-toggle-track" aria-hidden="true"><i /></span><b>Zed streamjéből</b>
        </button>
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
              <div className="filter-section">
                <h2>Ország</h2>
                <div className="filter-options">
                  <label className="select-all-option">
                    <input type="checkbox" checked={selectedCountries.length === countries.length}
                      onChange={() => setSelectedCountries(selectedCountries.length === countries.length ? [] : countries)} />
                    <span>ÖSSZES</span>
                  </label>
                  {countries.map((country) => (
                    <label key={country}><input type="checkbox" checked={selectedCountries.includes(country)}
                      onChange={() => toggleFilter(country, selectedCountries, setSelectedCountries)} />
                      <span>{countryNameHu(country)} <small>({countryCounts[country]})</small></span></label>
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
              <button type="button" className="list-clear-button" disabled={!hasActiveFilters} onClick={clearAllFilters}>Szűrők törlése</button>
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
              <div key={place.id}
                ref={(element) => { if (element) listRowRefs.current.set(place.id, element); else listRowRefs.current.delete(place.id); }}
                className={`clip-list-row ${!place.clipUrl ? "inactive" : ""} ${activeListPlace?.id === place.id ? "active" : ""} ${mapHoveredPlace?.id === place.id ? "map-hovered" : ""}`}
                onMouseEnter={() => setHoveredListPlace(place)} onMouseLeave={() => setHoveredListPlace(null)}
                title={!place.clipUrl ? "Ehhez a helyhez nincs lejátszható klip" : undefined}>
                <button className="list-play-button" type="button" disabled={!place.clipUrl}
                  aria-label={place.clipUrl ? `${place.name || "Névtelen klip"} lejátszása` : "Nincs lejátszható klip"}
                  onClick={(event) => { event.stopPropagation(); if (place.clipUrl) setSelected(place); }} />
                {place.top && <span className="list-top-badge">TOP</span>}
                <button className="clip-list-title" type="button" onClick={() => activateListPlace(place)}>{place.name || "Névtelen klip"}</button>
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

      <div ref={mapContainer} className="map" role="region" aria-label="Geri klipjeinek interaktív térképe"
        data-visible-count={visiblePlaces.length} />
      {dataError && <div className="map-data-error" role="alert">{dataError}{" "}
        <button type="button" onClick={() => setDataAttempt((attempt) => attempt + 1)}>Újrapróbálás</button>
      </div>}
      <div ref={mapLoadingRef} className="map-loading visible" role="status" aria-label="Térkép betöltése">
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
