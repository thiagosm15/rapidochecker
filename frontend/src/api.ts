import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

export type Settings = {
  auto_accept: boolean;
  min_price_per_km: number;
  min_fare: number;
  max_pickup_km: number;
  accept_texts: string[];
  target_package: string;
  sync_99_enabled: boolean;
  ninety_nine_package: string;
  ride_active_texts: string[];
  ride_end_texts: string[];
  offline_texts: string[];
  online_texts: string[];
  schedule_enabled: boolean;
  schedule_start: string;
  schedule_end: string;
  schedule_days: number[];
  alert_enabled: boolean;
};

export type WeeklyDay = { date: string; label: string; earnings: number; accepted: number; total: number; accept_rate: number };
export type Weekly = { days: WeeklyDay[]; week_earnings: number; week_accepted: number; week_total: number };

const tzOffset = () => -new Date().getTimezoneOffset();

export function useWeekly() {
  return useQuery({ queryKey: ["stats", "weekly"], queryFn: () => req<Weekly>(`/stats/weekly?tz=${tzOffset()}`) });
}

export type Ride = {
  id: string;
  price: number;
  trip_km: number;
  pickup_km: number;
  price_per_km: number;
  accepted: boolean;
  reasons: string[];
  source: "simulador" | "rapidocar";
  pickup?: string | null;
  dropoff?: string | null;
  created_at: string;
};

export type RideIn = Omit<Ride, "id" | "pickup" | "dropoff">;

export type Stats = {
  today_earnings: number;
  today_total: number;
  today_accepted: number;
  accept_rate: number;
};

export type RideStatus = "all" | "accepted" | "rejected";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  return res.json() as Promise<T>;
}

function todayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
export const num = (v: number, d = 1) => v.toFixed(d).replace(".", ",");

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => req<Settings>("/settings") });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Settings>) => req<Settings>("/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useStats() {
  return useQuery({ queryKey: ["stats"], queryFn: () => req<Stats>(`/stats?since=${encodeURIComponent(todayStartIso())}`) });
}

export function useRides(status: RideStatus) {
  return useQuery({ queryKey: ["rides", status], queryFn: () => req<Ride[]>(`/rides?status=${status}`) });
}

export function useSimulate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => req<Ride>(`/simulate?tz=${tzOffset()}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["rides"] });
    },
  });
}

export function uploadRides(items: RideIn[]) {
  return req<{ inserted: number }>("/rides/bulk", { method: "POST", body: JSON.stringify(items) });
}
