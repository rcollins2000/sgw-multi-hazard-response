import { create } from "zustand";
import { PERSONAS, type PersonaKey } from "../lib/api";

export type ViewMode = "live" | "demo_debby";

export type AppState = {
  mode: ViewMode;
  persona: PersonaKey;
  /**
   * Cockpit focus: which asset the "priority decision" surface shows.
   * `null` means "the highest-risk asset from /api/assets" — CockpitPage
   * resolves this at render time, so the store doesn't need to know the
   * asset list.
   */
  focusedAssetId: string | null;
  setMode: (m: ViewMode) => void;
  setPersona: (p: PersonaKey) => void;
  setFocusedAsset: (id: string | null) => void;
  personaInfo: () => (typeof PERSONAS)[number];
};

export const useAppStore = create<AppState>((set, get) => ({
  mode: "live",
  persona: "noc",
  focusedAssetId: null,
  setMode: (m) => set({ mode: m }),
  setPersona: (p) => set({ persona: p }),
  setFocusedAsset: (id) => set({ focusedAssetId: id }),
  personaInfo: () => PERSONAS.find((p) => p.key === get().persona) ?? PERSONAS[0],
}));
