import { Ionicons } from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { brl, num, useMonthly } from "@/src/api";
import { ErrorState, LoadingState } from "@/src/components/StateViews";
import { fonts } from "@/src/fonts";
import { makeStyles, useTheme } from "@/src/theme";

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shift = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  return ym(new Date(y, m - 1 + delta, 1));
};
const hourRange = (h: number) => `${String(h).padStart(2, "0")}h–${String((h + 1) % 24).padStart(2, "0")}h`;

export default function Relatorio() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const current = ym(new Date());
  const [month, setMonth] = useState(current);
  const q = useMonthly(month);
  const r = q.data;
  const maxHour = Math.max(1, ...(r?.hours.map((h) => h.earnings) ?? [1]));

  return (
    <View style={styles.screen} testID="relatorio-screen">
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="relatorio-back-button" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Relatório mensal</Text>
      </View>

      <View style={styles.monthNav}>
        <Pressable testID="month-prev-button" onPress={() => setMonth(shift(month, -1))} style={styles.iconBtn}>
          <Ionicons name="chevron-back-circle" size={30} color={colors.onSurfaceSecondary} />
        </Pressable>
        <Text style={styles.monthLabel} testID="month-label">
          {r?.label ?? month}
        </Text>
        <Pressable
          testID="month-next-button"
          disabled={month >= current}
          onPress={() => setMonth(shift(month, 1))}
          style={[styles.iconBtn, month >= current && { opacity: 0.3 }]}
        >
          <Ionicons name="chevron-forward-circle" size={30} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      {q.isLoading ? (
        <LoadingState label="Carregando relatório..." />
      ) : q.isError || !r ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); }} tintColor={colors.brandPrimary} />}
        >
          <Animated.View entering={FadeIn} style={styles.hero}>
            <Text style={styles.heroLabel}>Ganhos no mês</Text>
            <Text style={styles.heroValue} testID="month-earnings">{brl(r.earnings)}</Text>
            <Text style={styles.heroSub}>
              {r.accepted} corridas aceitas de {r.total} ofertas · {num(r.accept_rate)}% de aceite
            </Text>
          </Animated.View>

          <View style={styles.grid}>
            <Kpi label="Média por dia" value={brl(r.avg_per_day)} sub={`${r.active_days} ${r.active_days === 1 ? "dia rodado" : "dias rodados"}`} testID="kpi-avg-day" />
            <Kpi label="Média por corrida" value={brl(r.avg_ride)} testID="kpi-avg-ride" />
            <Kpi label="R$/km médio" value={brl(r.avg_price_per_km)} testID="kpi-avg-ppk" />
            <Kpi label="Km rodados" value={`${num(r.km)} km`} testID="kpi-km" />
          </View>

          <Text style={styles.section}>MELHORES HORÁRIOS PARA RODAR</Text>
          {r.best_hours.length ? (
            <View style={styles.card}>
              {r.best_hours.map((h, i) => (
                <View key={h.hour} style={[styles.rankRow, i > 0 && styles.rankDivider]} testID={`best-hour-${i}`}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Text style={styles.rankName}>{hourRange(h.hour)}</Text>
                  <Text style={styles.rankMeta}>{h.accepted} corridas</Text>
                  <Text style={styles.rankValue}>{brl(h.earnings)}</Text>
                </View>
              ))}
              <View style={styles.hours}>
                {r.hours.map((h) => (
                  <View key={h.hour} style={styles.hourCol}>
                    <View style={[styles.hourBar, { height: Math.max(2, (h.earnings / maxHour) * 56) }, h.earnings === maxHour && styles.hourBarTop]} />
                  </View>
                ))}
              </View>
              <View style={styles.hoursAxis}>
                {["0h", "6h", "12h", "18h", "23h"].map((t) => (
                  <Text key={t} style={styles.axis}>{t}</Text>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.empty}>Sem corridas aceitas neste mês.</Text>
          )}

          <Text style={styles.section}>MELHORES DIAS DA SEMANA</Text>
          {r.best_days.length ? (
            <View style={styles.card}>
              {r.best_days.map((d, i) => (
                <View key={d.day} style={[styles.rankRow, i > 0 && styles.rankDivider]} testID={`best-day-${i}`}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Text style={styles.rankName}>{d.label}</Text>
                  <Text style={styles.rankMeta}>{d.accepted} corridas</Text>
                  <Text style={styles.rankValue}>{brl(d.earnings)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Sem dados ainda.</Text>
          )}

          {r.rejection_reasons.length ? (
            <>
              <Text style={styles.section}>POR QUE RECUSOU</Text>
              <View style={styles.card}>
                {r.rejection_reasons.map((x, i) => (
                  <View key={x.reason} style={[styles.rankRow, i > 0 && styles.rankDivider]}>
                    <Text style={[styles.rankName, { flex: 1 }]}>{x.reason}</Text>
                    <Text style={styles.rankValue}>{x.count}x</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Kpi({ label, value, sub, testID }: { label: string; value: string; sub?: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue} testID={testID} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 8 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.display, fontSize: 28, color: c.onSurface },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, height: 56, borderBottomWidth: 1, borderBottomColor: c.divider },
  monthLabel: { fontFamily: fonts.displaySemi, fontSize: 22, color: c.onSurface },
  content: { padding: 16, gap: 12 },
  hero: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 16, borderLeftWidth: 4, borderLeftColor: c.success },
  heroLabel: { fontFamily: fonts.body, fontSize: 13, color: c.onSurfaceSecondary },
  heroValue: { fontFamily: fonts.display, fontSize: 52, lineHeight: 58, color: c.success },
  heroSub: { fontFamily: fonts.body, fontSize: 13, color: c.onSurfaceTertiary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  kpi: { flexBasis: "47%", flexGrow: 1, backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 12 },
  kpiLabel: { fontFamily: fonts.body, fontSize: 12, color: c.onSurfaceSecondary },
  kpiValue: { fontFamily: fonts.display, fontSize: 26, color: c.onSurface },
  kpiSub: { fontFamily: fonts.body, fontSize: 11, color: c.muted },
  section: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 2, color: c.muted, marginTop: 8 },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  rankDivider: { borderTopWidth: 1, borderTopColor: c.divider },
  rank: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.brandTertiary, color: c.onBrandTertiary, textAlign: "center", lineHeight: 24, fontFamily: fonts.bodySemi, fontSize: 12, overflow: "hidden" },
  rankName: { fontFamily: fonts.bodyMedium, fontSize: 15, color: c.onSurface },
  rankMeta: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: c.muted },
  rankValue: { fontFamily: fonts.display, fontSize: 20, color: c.success },
  hours: { flexDirection: "row", alignItems: "flex-end", height: 60, gap: 2, marginTop: 12 },
  hourCol: { flex: 1, justifyContent: "flex-end" },
  hourBar: { backgroundColor: c.surfaceTertiary, borderRadius: 2 },
  hourBarTop: { backgroundColor: c.brandPrimary },
  hoursAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  axis: { fontFamily: fonts.body, fontSize: 10, color: c.muted },
  empty: { fontFamily: fonts.body, fontSize: 14, color: c.onSurfaceSecondary },
}));
