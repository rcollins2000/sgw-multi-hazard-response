/*
  stormPaths — hand-curated storm-path templates the ScenariosPage map uses
  to render "hypothetical hurricane" cones + tracks.

  Two sources of truth feed this:

    1. Historic tracks (Debby, Idalia, Matthew, Michael) — coordinates hand-
       digitised from NHC track archive. Approximate but recognisably real so
       the reviewer can eyeball the geometry against a real map.

    2. Synthesised composites (cat3_charleston, worst_case_cascade_east) —
       parameterised composites the runner already conditions on. The track
       is *plausible* not *predicted* — that's the whole point of the
       "STRESS TEST · NOT A LIVE FORECAST" chip on the page.

  A path template is (name, landfall, track [(lat, lon)…], cone
  polygon [(lat, lon)…]). Leaflet expects [lat, lon] — matching leaflet's
  convention rather than GeoJSON's is deliberate; less flipping in components.
*/

export type LatLon = [number, number];

export type StormPathTemplate = {
  key: string;
  name: string;
  saffir_simpson?: string;
  year?: number;
  landfall: LatLon;
  track: LatLon[];
  cone: LatLon[];
  /** One-line factual note shown next to the map. */
  note: string;
};

// -- Historic ----------------------------------------------------------------

const IDALIA: StormPathTemplate = {
  key: "hurricane_idalia_2023",
  name: "Hurricane Idalia",
  saffir_simpson: "Cat 3",
  year: 2023,
  landfall: [29.9, -83.6],
  track: [
    [21.5, -85.5],
    [23.5, -85.2],
    [25.5, -84.7],
    [27.7, -84.4],
    [29.9, -83.6],
    [31.5, -82.7],
    [33.0, -81.3],
    [34.5, -79.5],
    [35.8, -76.8],
  ],
  cone: [
    [21.0, -87.0],
    [24.0, -87.5],
    [27.5, -86.5],
    [30.5, -85.5],
    [33.5, -84.0],
    [36.0, -82.0],
    [36.5, -77.5],
    [36.0, -75.5],
    [34.5, -76.5],
    [32.5, -79.0],
    [30.0, -81.0],
    [27.0, -82.5],
    [24.0, -83.5],
    [21.0, -83.5],
  ],
  note: "NHC-digitised track. Landfall at Keaton Beach, FL as Cat-3 (Aug-2023).",
};

const DEBBY: StormPathTemplate = {
  key: "hurricane_debby_2024",
  name: "Hurricane Debby",
  saffir_simpson: "Cat 1",
  year: 2024,
  landfall: [29.9, -83.6],
  track: [
    [22.5, -83.5],
    [25.0, -84.0],
    [27.5, -84.0],
    [29.6, -83.4],
    [31.0, -82.5],
    [32.0, -81.5],
    [32.7, -80.2],
    [34.0, -78.5],
    [35.5, -76.0],
  ],
  cone: [
    [22.0, -85.5],
    [24.5, -85.5],
    [27.5, -85.0],
    [30.0, -84.5],
    [32.5, -83.5],
    [34.5, -81.5],
    [36.0, -78.5],
    [36.0, -75.5],
    [34.5, -76.0],
    [32.5, -78.0],
    [30.5, -80.5],
    [28.0, -82.5],
    [25.0, -82.5],
    [22.5, -82.0],
  ],
  note: "NHC-digitised track. Cat-1 landfall at Big Bend + stall over SC/GA (Aug-2024).",
};

const MATTHEW: StormPathTemplate = {
  key: "hurricane_matthew_2016",
  name: "Hurricane Matthew",
  saffir_simpson: "Cat 4",
  year: 2016,
  landfall: [32.6, -80.1],
  track: [
    [17.5, -74.5],
    [20.0, -74.5],
    [22.5, -75.5],
    [25.0, -77.0],
    [27.5, -78.5],
    [30.0, -80.0],
    [32.6, -80.1],
    [34.7, -78.0],
    [36.5, -75.0],
  ],
  cone: [
    [17.0, -76.5],
    [20.0, -77.5],
    [23.0, -78.5],
    [26.0, -80.5],
    [29.0, -82.0],
    [32.0, -82.5],
    [35.0, -80.5],
    [36.5, -78.0],
    [36.5, -73.5],
    [35.0, -75.0],
    [32.5, -78.0],
    [29.5, -79.5],
    [26.5, -78.5],
    [23.0, -76.5],
    [20.0, -75.0],
    [17.5, -74.0],
  ],
  note: "NHC-digitised track. Cat-4 offshore SC/GA + landfall near McClellanville (Oct-2016).",
};

const MICHAEL: StormPathTemplate = {
  key: "hurricane_michael_2018",
  name: "Hurricane Michael",
  saffir_simpson: "Cat 5",
  year: 2018,
  landfall: [30.0, -85.5],
  track: [
    [19.5, -86.5],
    [22.0, -86.0],
    [24.5, -85.8],
    [27.0, -85.8],
    [30.0, -85.5],
    [32.0, -84.0],
    [34.0, -81.0],
    [35.5, -78.0],
    [36.5, -75.5],
  ],
  cone: [
    [19.0, -88.5],
    [22.0, -88.5],
    [25.0, -88.0],
    [28.0, -87.5],
    [30.5, -87.0],
    [32.5, -85.5],
    [35.0, -82.5],
    [36.5, -78.5],
    [37.0, -75.0],
    [35.5, -76.0],
    [33.5, -79.0],
    [31.0, -82.0],
    [28.0, -84.0],
    [25.0, -84.0],
    [22.0, -84.0],
    [19.5, -84.5],
  ],
  note: "NHC-digitised track. Cat-5 Florida panhandle landfall + inland surge (Oct-2018).",
};

// -- Synthesised composites --------------------------------------------------

const CAT3_CHARLESTON: StormPathTemplate = {
  key: "cat3_charleston_30d",
  name: "Cat 3 · Charleston landfall (hypothetical)",
  saffir_simpson: "Cat 3",
  landfall: [32.78, -79.93],
  track: [
    [23.0, -78.5],
    [25.5, -79.5],
    [28.0, -80.2],
    [30.5, -80.3],
    [32.78, -79.93],
    [34.5, -78.5],
    [36.0, -76.5],
  ],
  cone: [
    [22.5, -81.5],
    [25.0, -82.0],
    [28.0, -82.5],
    [31.0, -82.5],
    [33.5, -81.5],
    [35.5, -79.0],
    [36.5, -75.5],
    [35.5, -74.5],
    [33.5, -76.5],
    [31.0, -78.0],
    [28.0, -78.0],
    [25.0, -77.0],
    [22.5, -76.5],
  ],
  note: "Synthesised cone from HURDAT2 climatology (planned integration). Not a live forecast.",
};

const WORST_CASE_CASCADE: StormPathTemplate = {
  key: "worst_case_cascade",
  name: "Worst single-asset cascade (baseline conditions)",
  landfall: [33.0, -80.0],
  track: [],
  cone: [],
  note: "No hazard footprint. Ranks assets by preventative_priority × downstream cascade depth.",
};

// -- Registry ----------------------------------------------------------------

export const STORM_TEMPLATES: Record<string, StormPathTemplate> = {
  hurricane_idalia_2023: IDALIA,
  hurricane_debby_2024: DEBBY,
  hurricane_matthew_2016: MATTHEW,
  hurricane_michael_2018: MICHAEL,
  cat3_charleston_30d: CAT3_CHARLESTON,
  worst_case_cascade: WORST_CASE_CASCADE,
};

/**
 * Preset → storm path key. Kept explicit rather than derived so the mapping
 * is auditable in one place.
 */
export const PRESET_TO_TEMPLATE: Record<string, string> = {
  replay_idalia: "hurricane_idalia_2023",
  replay_debby: "hurricane_debby_2024",
  cat3_charleston_30d: "cat3_charleston_30d",
  worst_case_cascade: "worst_case_cascade",
};

/**
 * Free-text → template resolver. Runs BEFORE the LLM parser so the map can
 * render immediately without paying an LLM roundtrip. If none match we return
 * null and the ScenariosPage renders the SGW footprint without a storm path
 * (still legible — the impacts list is what matters).
 *
 * Matches keywords case-insensitively. Preference order matters: more specific
 * storms first, generic hazard keywords last.
 */
export function resolveTemplateFromDirective(directive: string): StormPathTemplate | null {
  const q = directive.toLowerCase();
  if (q.includes("idalia")) return IDALIA;
  if (q.includes("debby")) return DEBBY;
  if (q.includes("matthew")) return MATTHEW;
  if (q.includes("michael")) return MICHAEL;
  if (q.includes("charleston") && (q.includes("cat") || q.includes("hurricane"))) {
    return CAT3_CHARLESTON;
  }
  if (q.includes("worst") && q.includes("cascade")) return WORST_CASE_CASCADE;
  return null;
}

/**
 * ScenarioSpec → template resolver. Runs AFTER the LLM parses a spec so the
 * map picks up on the LLM's chosen path.
 *
 * Priority order:
 *   1. path_template_hint (LLM's explicit pick, or preset-attached)
 *   2. reference_event (LLM said this is Idalia/Debby/etc.)
 *   3. worst_case_cascade kind → no-path template
 *   4. synthesised on Coast East → Charleston Cat-3 default
 *   5. null → map renders the SGW footprint with no cone
 */
export function resolveTemplateFromSpec(spec: {
  reference_event?: string | null;
  kind: string;
  region_focus?: string | null;
  severity?: string | null;
  path_template_hint?: string | null;
}): StormPathTemplate | null {
  if (spec.path_template_hint && STORM_TEMPLATES[spec.path_template_hint]) {
    return STORM_TEMPLATES[spec.path_template_hint];
  }
  if (spec.reference_event && STORM_TEMPLATES[spec.reference_event]) {
    return STORM_TEMPLATES[spec.reference_event];
  }
  if (spec.kind === "worst_case_cascade") return WORST_CASE_CASCADE;
  if (spec.kind === "synthesised" && spec.region_focus === "COAST_EAST") {
    return CAT3_CHARLESTON;
  }
  return null;
}
