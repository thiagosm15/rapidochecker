import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { brl, num, useWeekly } from "@/src/api";
import { fonts } from "@/src/fonts";
import { makeStyles } from "@/src/theme";

const BAR_MAX = 120;

export function WeeklyChart() {
  const styles = useStyles();
  const weekly = useWeekly();
  const [selected, setSelected] = useState<number | null>(null);

  if (!weekly.data) {
    return (
      <View style={styles.card} testID="weekly-chart">
        <Text style={styles.title}>Últimos 7 dias</Text>
        <Text style={styles.muted}>{weekly.isError ? "Não foi possível carregar o gráfico." : "Carregando..."}</Text>
      </View>
    );
  }

  const { days, week_earnings, week_accepted, week_total } = weekly.data;
  const max = Math.max(1, ...days.map((d) => d.earnings));
  const idx = selected ?? days.length - 1;
  const day = days[idx];

  return (
    <View style={styles.card} testID="weekly-chart">
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Últimos 7 dias</Text>
          <Text style={styles.big} testID="week-earnings">{brl(week_earnings)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.muted}>Taxa de aceite</Text>
          <Text style={styles.rate} testID="week-accept-rate">
            {num(week_total ? (week_accepted * 100) / week_total : 0)}%
          </Text>
        </View>
      </View>

      <View style={styles.bars}>
        {days.map((d, i) => {
          const h = Math.max(4, (d.earnings / max) * BAR_MAX);
          const active = i === idx;
          return (
            <Pressable key={d.date} testID={`weekly-bar-${i}`} onPress={() => setSelected(i)} style={styles.barCol} hitSlop={4}>
              <View style={styles.barTrack}>
                <Animated.View entering={FadeIn.delay(i * 40)} style={[styles.bar, { height: h }, active ? styles.barActive : null]} />
              </View>
              <Text style={[styles.barLabel, active && styles.barLabelActive]}>{d.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.detail} testID="weekly-day-detail">
        <Text style={styles.detailText}>
          {day.label} {day.date.slice(8, 10)}/{day.date.slice(5, 7)}
        </Text>
        <Text style={styles.detailValue}>{brl(day.earnings)}</Text>
        <Text style={styles.detailText}>
          {day.accepted}/{day.total} aceitas · {num(day.accept_rate)}%
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 16, gap: 12, borderWidth: 1, borderColor: c.border },
  head: { flexDirection: "row", alignItems: "flex-end" },
  title: { fontFamily: fonts.body, fontSize: 13, color: c.onSurfaceSecondary },
  big: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, color: c.onSurface },
  rate: { fontFamily: fonts.display, fontSize: 24, color: c.brandSecondary },
  muted: { fontFamily: fonts.body, fontSize: 12, color: c.muted },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: BAR_MAX + 24 },
  barCol: { flex: 1, alignItems: "center", gap: 6 },
  barTrack: { height: BAR_MAX, width: "100%", justifyContent: "flex-end", alignItems: "center" },
  bar: { width: "70%", borderRadius: 4, backgroundColor: c.surfaceTertiary },
  barActive: { backgroundColor: c.brandPrimary },
  barLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: c.muted },
  barLabelActive: { color: c.onSurface },
  detail: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider },
  detailText: { fontFamily: fonts.body, fontSize: 12, color: c.onSurfaceSecondary },
  detailValue: { fontFamily: fonts.display, fontSize: 20, color: c.success },
}));
