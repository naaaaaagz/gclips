import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");
const CACHE_FILE = resolve(DATA_DIR, "reverse-geocode-cache.json");
const OUTPUT_FILE = resolve(DATA_DIR, "enriched-keywords.json");
const SOURCE = "1rmCpUX9JnmWHKrqDtfjcjkf0eb1I5lQlg22QJc0d60w";
const USER_AGENT = "GeriClipsMap/1.0";

mkdirSync(DATA_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const keyFor = (lat, lon) => `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
const normalize = (value) => tidy(value)
  .toLocaleLowerCase("hu-HU")
  .replace(/[“”„]/g, '"')
  .replace(/[’‘]/g, "'")
  .replace(/^[-–—\s]+|[-–—\s]+$/g, "");

const translationPairs = [
  ["állat", "animal"], ["kutya", "dog"], ["eb", "dog"], ["macska", "cat"],
  ["cica", "cat"], ["ló", "horse"], ["madár", "bird"], ["galamb", "pigeon"],
  ["kacsa", "duck"], ["hattyú", "swan"], ["vaddisznó", "wild boar"],
  ["autó", "car"], ["kocsi", "car"], ["verda", "car"], ["busz", "bus"],
  ["kamion", "truck"], ["teherautó", "truck"], ["motor", "motorcycle"],
  ["robogó", "scooter"], ["roller", "scooter"], ["bicikli", "bicycle"],
  ["kerékpár", "bicycle"], ["bringa", "bike"], ["biciklis", "cyclist"],
  ["futár", "courier"], ["gyalogos", "pedestrian"], ["turista", "tourist"],
  ["rendőr", "police"], ["mentő", "ambulance"], ["tűzoltó", "firefighter"],
  ["gyerek", "child"], ["kislány", "girl"], ["kisfiú", "boy"],
  ["néni", "old lady"], ["bácsi", "old man"], ["ember", "person"],
  ["baleset", "accident"], ["karambol", "crash"], ["ütközés", "collision"],
  ["esés", "fall"], ["elesik", "fall"], ["borulás", "crash"],
  ["ordítás", "screaming"], ["kiabálás", "shouting"], ["kiabál", "shout"],
  ["sikítás", "scream"], ["beszólás", "remark"], ["düh", "rage"],
  ["harag", "anger"], ["vicces", "funny"], ["félelem", "fear"],
  ["ijesztő", "scary"], ["jumpscare", "ijesztés"], ["hülye", "idiot"],
  ["szabálytalan", "traffic violation"], ["szabálytalanság", "traffic violation"],
  ["rendelés", "order"], ["kiszállítás", "delivery"], ["átvétel", "pickup"],
  ["étel", "food"], ["pizza", "pizza"], ["jatt", "tip"], ["borravaló", "tip"],
  ["út", "road"], ["utca", "street"], ["tér", "square"], ["híd", "bridge"],
  ["alagút", "tunnel"], ["lépcső", "stairs"], ["park", "park"],
  ["bolt", "shop"], ["üzlet", "store"], ["étterem", "restaurant"],
  ["kávé", "coffee"], ["vonat", "train"], ["repülő", "airplane"],
  ["hajó", "boat"], ["folyó", "river"], ["tó", "lake"], ["hegy", "mountain"],
  ["eső", "rain"], ["vihar", "storm"], ["szél", "wind"], ["hó", "snow"],
  ["nyár", "summer"], ["tél", "winter"], ["karácsony", "christmas"],
  ["nyaralás", "holiday"], ["külföld", "abroad"], ["séta", "walk"],
  ["magyarország", "hungary"], ["ausztria", "austria"], ["olaszország", "italy"],
  ["németország", "germany"], ["horvátország", "croatia"], ["szlovénia", "slovenia"],
  ["szlovákia", "slovakia"], ["svédország", "sweden"], ["belgium", "belgium"],
  ["hollandia", "netherlands"], ["bátor", "brave"], ["merész", "bold"],
];

const synonymGroups = [
  ["bátor", "merész", "vakmerő"],
  ["autó", "kocsi", "verda"],
  ["bicikli", "kerékpár", "bringa", "bike"],
  ["macska", "cica"], ["kutya", "eb"],
  ["düh", "harag", "rage"],
  ["kiabál", "kiabálás", "ordít", "ordítás"],
  ["baleset", "karambol", "ütközés", "crash"],
  ["vicces", "humoros", "funny"],
  ["futár", "kézbesítő", "courier"],
  ["gyalogos", "járókelő", "pedestrian"],
  ["turista", "látogató", "tourist"],
  ["jatt", "borravaló", "tip"],
  ["fél", "félelem", "ijedtség"],
  ["szabálytalan", "szabálytalanság", "szabálytalankodás"],
];

const expansions = new Map();
const connect = (values) => {
  const cleaned = [...new Set(values.map(normalize).filter(Boolean))];
  for (const value of cleaned) {
    if (!expansions.has(value)) expansions.set(value, new Set());
    for (const peer of cleaned) if (peer !== value) expansions.get(value).add(peer);
  }
};
for (const pair of translationPairs) connect(pair);
for (const group of synonymGroups) connect(group);

const animalWords = new Set([
  "állat", "animal", "kutya", "dog", "eb", "macska", "cat", "cica", "ló", "horse",
  "madár", "bird", "galamb", "pigeon", "kacsa", "duck", "hattyú", "swan", "vaddisznó",
  "wild boar", "őz", "deer", "szarvas", "róka", "fox", "bogár", "rovar", "béka", "frog",
]);

function addTerm(target, raw) {
  const term = normalize(raw);
  if (!term || term.length > 90) return;
  target.add(term);
  const words = term.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? [];
  if (words.length > 1) {
    for (const word of words) if (word.length > 1) target.add(word);
    const joined = words.join("");
    if (joined.length > 2) target.add(joined);
  }
}

function romanToNumber(value) {
  const digits = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  let previous = 0;
  for (const char of value.toUpperCase().split("").reverse()) {
    const current = digits[char] ?? 0;
    total += current < previous ? -current : current;
    previous = Math.max(previous, current);
  }
  return total;
}

function locationTerms(result, rowCountry) {
  const terms = new Set();
  const address = result?.address ?? {};
  const usefulKeys = [
    "road", "pedestrian", "square", "cycleway", "neighbourhood", "quarter", "suburb",
    "borough", "city_district", "city", "town", "village", "municipality", "county",
    "state_district", "state", "country",
  ];
  for (const key of usefulKeys) addTerm(terms, address[key]);
  addTerm(terms, rowCountry);

  const featureCategories = new Set([
    "amenity", "shop", "tourism", "historic", "leisure", "office", "railway",
    "public_transport", "building", "man_made", "place",
  ]);
  if (result?.name && featureCategories.has(result.category)) addTerm(terms, result.name);
  for (const nameKey of ["name", "name:hu", "name:en", "official_name", "alt_name", "brand"]) {
    addTerm(terms, result?.namedetails?.[nameKey]);
  }

  const locationText = [...terms].join(" ");
  const districtMatches = [...locationText.matchAll(/(?:budapest\s*)?([ivxlc]+)\.?\s*(?:kerület|district)/giu)];
  for (const match of districtMatches) {
    const number = romanToNumber(match[1]);
    if (number >= 1 && number <= 23) {
      addTerm(terms, `${number}. kerület`);
      addTerm(terms, `budapest ${number}. kerület`);
      addTerm(terms, `district ${number}`);
    }
  }
  return terms;
}

function expandKeywords(sourceKeywords, locations) {
  const terms = new Set();
  for (const fragment of String(sourceKeywords ?? "").split(/[,;\n]+/)) addTerm(terms, fragment);
  for (const location of locations) addTerm(terms, location);

  let changed = true;
  for (let pass = 0; pass < 2 && changed; pass += 1) {
    changed = false;
    for (const term of [...terms]) {
      const peers = expansions.get(term);
      if (!peers) continue;
      for (const peer of peers) {
        const before = terms.size;
        addTerm(terms, peer);
        if (terms.size !== before) changed = true;
      }
    }
  }

  const hasAnimal = [...terms].some((term) => animalWords.has(term));
  if (hasAnimal) {
    addTerm(terms, "állat");
    addTerm(terms, "animal");
  }

  return [...terms].join(", ");
}

async function fetchSheetRows() {
  const endpoint = `https://docs.google.com/spreadsheets/d/${SOURCE}/gviz/tq?tqx=out:json&gid=0`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Sheet returned ${response.status}`);
  const raw = await response.text();
  const payload = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  const value = (row, index) => row.c?.[index]?.v ?? "";
  return payload.table.rows.map((row, index) => ({
    sheetRow: index + 1,
    name: tidy(value(row, 0)),
    sourceKeywords: tidy(value(row, 3)),
    coordinates: tidy(value(row, 5)),
    country: tidy(value(row, 7)),
  })).filter((row) => row.name && row.name !== "Clip name" && row.coordinates !== "Coordinates");
}

async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: "18",
    addressdetails: "1",
    namedetails: "1",
    extratags: "1",
    "accept-language": "hu,en",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: { "User-Agent": USER_AGENT, Referer: "https://naaaaaagz.github.io/zz/" },
  });
  if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
  return response.json();
}

const rows = await fetchSheetRows();
const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
let fetched = 0;

for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  const [lat, lon] = row.coordinates.split(",").map((part) => Number(part.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const key = keyFor(lat, lon);
  if (!cache[key]) {
    try {
      cache[key] = await reverseGeocode(lat, lon);
      fetched += 1;
      writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    } catch (error) {
      console.warn(`Reverse geocoding failed for row ${row.sheetRow}: ${error.message}`);
      cache[key] = { error: error.message };
    }
    await sleep(1100);
  }
  if ((index + 1) % 25 === 0 || index + 1 === rows.length) {
    console.log(`Location enrichment: ${index + 1}/${rows.length} (${fetched} new lookups)`);
  }
}

const enriched = rows.map((row) => {
  const [lat, lon] = row.coordinates.split(",").map((part) => Number(part.trim()));
  const reverse = cache[keyFor(lat, lon)] ?? {};
  const locations = locationTerms(reverse, row.country);
  return {
    sheetRow: row.sheetRow,
    name: row.name,
    keywords: expandKeywords(row.sourceKeywords, locations),
    location: {
      name: reverse.name ?? "",
      displayName: reverse.display_name ?? "",
      address: reverse.address ?? {},
    },
  };
});

writeFileSync(OUTPUT_FILE, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
console.log(`Wrote ${enriched.length} enriched keyword rows to ${OUTPUT_FILE}`);
