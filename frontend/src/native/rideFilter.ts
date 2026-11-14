import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

import type { RideIn, Settings } from "@/src/api";

type RideFilterNative = {
  setConfig(json: string): void;
  isServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  getPendingEvents(): string;
  clearPendingEvents(): void;
  getSyncState(): string;
  resetBusy99(): void;
  setLearning(on: boolean): void;
  getCapturedScreens(): string;
};

export type CapturedScreen = { package: string; at: number; texts: string[] };
export type CapturedScreens = { learning: boolean; rapido: CapturedScreen | null; ninety_nine: CapturedScreen | null };

export function getCapturedScreens(): CapturedScreens | null {
  return mod ? (JSON.parse(mod.getCapturedScreens()) as CapturedScreens) : null;
}

export function setLearning(on: boolean) {
  mod?.setLearning(on);
}

export type SyncState = { busy_99: boolean; since: number; log: { type: string; at: number }[] };

export function getSyncState(): SyncState | null {
  return mod ? (JSON.parse(mod.getSyncState()) as SyncState) : null;
}

export function resetBusy99() {
  mod?.resetBusy99();
}

// Only present in an Android build (APK). Null in Expo Go, iOS and web.
const mod = Platform.OS === "android" ? requireOptionalNativeModule<RideFilterNative>("RideFilter") : null;

export const nativeAvailable = !!mod;

// Set once the driver accepts the in-app accessibility disclosure (app/aviso.tsx).
export const DISCLOSURE_KEY = "a11y_disclosure_ok";

export function pushConfig(s: Settings) {
  mod?.setConfig(JSON.stringify(s));
}

export function isServiceEnabled(): boolean {
  return mod ? mod.isServiceEnabled() : false;
}

export function openAccessibilitySettings() {
  mod?.openAccessibilitySettings();
}

export function takePendingEvents(): RideIn[] {
  if (!mod) return [];
  const list = JSON.parse(mod.getPendingEvents() || "[]") as RideIn[];
  return list;
}

export function clearPendingEvents() {
  mod?.clearPendingEvents();
}

/** On logout: stop the service from acting with the previous driver's settings. */
export function resetNativeForLogout() {
  if (!mod) return;
  mod.setConfig(JSON.stringify({ auto_accept: false, sync_99_enabled: false }));
  mod.clearPendingEvents();
  mod.resetBusy99();
  mod.setLearning(false);
}
