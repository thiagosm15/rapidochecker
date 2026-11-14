import { Ionicons } from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { brl, num, uploadRides, useSettings, useStats, useUpdateSettings } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { ErrorState, LoadingState } from "@/src/components/StateViews";
import { fonts } from "@/src/fonts";
import {
  clearPendingEvents,
  getSyncState,
  isServiceEnabled,
  nativeAvailable,
  openAccessibilitySettings,
  pushConfig,
  resetBusy99,
  SyncState,
  takePendingEvents,
} from "@/src/native/rideFilter";
import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, useTheme } from "@/src/theme";

export default function Painel() {
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const qc = useQueryClient();
  const settings = useSettings();
  const stats = useStats();
  const update = useUpdateSettings();
  const [serviceOn, setServiceOn] = useState(isServiceEnabled());
  const [refreshing, setRefreshing] = useState(false);
  const [syncState, setSyncState] = useState<SyncState | null>(getSyncState());
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const sync = useCallback(async () => {
    setServiceOn(isServiceEnabled());
    setSyncState(getSyncState());
    const pending = takePendingEvents();
    if (pending.length) {
      try {
        await uploadRides(pending);
        clearPendingEvents();
      } catch {
        // keep events on device; retried on next focus
      }
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["stats"] }),
      qc.invalidateQueries({ queryKey: ["rides"] }),
    ]);
  }, [qc]);

  useFocusEffect(
    useCallback(() => {
      sync();
    }, [sync]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && sync());
    return () => sub.remove();
  }, [sync]);

  useEffect(() => {
    if (settings.data) pushConfig(settings.data);
  }, [settings.data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([sync(), settings.refetch()]);
    setRefreshing(false);
  };

  if (settings.isLoading) return <View style={styles.screen}><ScreenHeader title="Painel" /><LoadingState label="Carregando painel..." /></View>;
  if (settings.isError || !settings.data)
    return <View style={styles.screen}><ScreenHeader title="Painel" /><ErrorState onRetry={() => settings.refetch()} /></View>;

  const s = settings.data;
  const on = s.auto_accept;

  const toggle = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    update.mutate({ auto_accept: !on });
  };

  const banner = !nativeAvailable
    ? { tone: "info" as const, icon: "information-circle" as const, title: "Modo prévia", text: "A automação real só funciona no APK Android. Use o Simulador para testar seus filtros." }
    : serviceOn
      ? { tone: "success" as const, icon: "checkmark-circle" as const, title: "Serviço de acessibilidade ativo", text: "Pronto para ler ofertas do RapidoCar." }
      : { tone: "error" as const, icon: "alert-circle" as const, title: "Serviço de acessibilidade inativo", text: "Ative \"AutoCorrida\" nas configurações de acessibilidade." };
  const toneColor = { info: colors.info, success: colors.success, error: colors.error }[banner.tone];
  const toneBg = { info: colors.infoTint, success: colors.successTint, error: colors.errorTint }[banner.tone];

  return (
    <View style={styles.screen} testID="painel-screen">
      <ScreenHeader title="Painel" subtitle="Auto-aceite de corridas RapidoCar" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomChrome + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <View style={[styles.banner, { borderColor: toneColor, backgroundColor: toneBg }]} testID="service-status-banner">
          <Ionicons name={banner.icon} size={22} color={toneColor} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: toneColor }]} testID="service-status-text">{banner.title}</Text>
            <Text style={styles.bannerText}>{banner.text}</Text>
          </View>
          {nativeAvailable && !serviceOn ? (
            <Pressable testID="open-accessibility-settings-button" onPress={openAccessibilitySettings} style={[styles.bannerBtn, { backgroundColor: toneColor }]}>
              <Text style={styles.bannerBtnText}>Ativar</Text>
            </Pressable>
          ) : null}
        </View>

        <Animated.View style={pressStyle}>
          <Pressable
            testID="auto-accept-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: on }}
            disabled={update.isPending}
            onPressIn={() => (scale.value = withSpring(0.97))}
            onPressOut={() => (scale.value = withSpring(1))}
            onPress={toggle}
            style={[styles.toggle, on ? styles.toggleOn : styles.toggleOff]}
          >
            <View style={[styles.powerRing, { borderColor: on ? colors.onBrandPrimary : colors.borderStrong }]}>
              <Ionicons name="power" size={44} color={on ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleLabel, { color: on ? colors.onBrandPrimary : colors.onSurfaceSecondary }]}>AUTO-ACEITE</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.toggleState, { color: on ? colors.onBrandPrimary : colors.onSurface }]} testID="auto-accept-state">
                {on ? "LIGADO" : "DESLIGADO"}
              </Text>
              <Text style={[styles.toggleHint, { color: on ? colors.onBrandPrimary : colors.muted }]}>
                {on ? "Aceitando corridas dentro dos filtros" : "Toque para começar a aceitar"}
              </Text>
            </View>
          </Pressable>
        </Animated.View>

        <Pressable testID="filters-summary-button" onPress={() => router.push("/filtros")} style={styles.summary}>
          <SummaryItem label="Mín R$/km" value={brl(s.min_price_per_km)} testID="summary-min-ppk" />
          <View style={styles.vDivider} />
          <SummaryItem label="Mín corrida" value={brl(s.min_fare)} testID="summary-min-fare" />
          <View style={styles.vDivider} />
          <SummaryItem label="Busca até" value={`${num(s.max_pickup_km)} km`} testID="summary-max-pickup" />
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>

        <View style={[styles.syncCard, s.sync_99_enabled && { borderColor: colors.brandPrimary }]} testID="sync-99-card">
          <View style={styles.syncHead}>
            <Ionicons name="swap-horizontal" size={20} color={s.sync_99_enabled ? colors.brandPrimary : colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.syncTitle}>Integração 99</Text>
              <Text style={styles.syncText} testID="sync-99-status">
                {!s.sync_99_enabled
                  ? "Desligada: o RapidoCar não muda quando você está na 99"
                  : !nativeAvailable
                    ? "Ligada: funciona no APK Android"
                    : syncState?.busy_99
                      ? "Em corrida na 99: RapidoCar offline"
                      : "Livre: RapidoCar online"}
              </Text>
            </View>
            <Pressable
              testID="sync-99-toggle"
              accessibilityRole="switch"
              accessibilityState={{ checked: s.sync_99_enabled }}
              disabled={update.isPending}
              hitSlop={10}
              onPress={() => update.mutate({ sync_99_enabled: !s.sync_99_enabled })}
              style={[styles.switchTrack, s.sync_99_enabled && styles.switchTrackOn]}
            >
              <View style={[styles.switchThumb, s.sync_99_enabled && styles.switchThumbOn]} />
            </Pressable>
          </View>
          {nativeAvailable && s.sync_99_enabled && syncState?.busy_99 ? (
            <Pressable
              testID="reset-99-button"
              onPress={() => {
                resetBusy99();
                setSyncState(getSyncState());
              }}
              style={styles.resetBtn}
            >
              <Text style={styles.resetText}>A corrida da 99 já acabou? Liberar</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.section}>HOJE</Text>
        <View style={styles.metricBig}>
          <Text style={styles.metricLabel}>Ganhos do dia</Text>
          <Text style={styles.metricHuge} testID="today-earnings">{brl(stats.data?.today_earnings ?? 0)}</Text>
        </View>
        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Taxa de aceite</Text>
            <Text style={styles.metricValue} testID="accept-rate">{num(stats.data?.accept_rate ?? 0)}%</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Ofertas lidas</Text>
            <Text style={styles.metricValue} testID="today-total">
              {stats.data?.today_accepted ?? 0}
              <Text style={styles.metricSmall}>/{stats.data?.today_total ?? 0}</Text>
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SummaryItem({ label, value, testID }: { label: string; value: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} testID={testID}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surface },
  content: { padding: 16, gap: 16 },
  banner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  bannerTitle: { fontFamily: fonts.bodySemi, fontSize: 14 },
  bannerText: { fontFamily: fonts.body, fontSize: 12, color: c.onSurfaceSecondary, marginTop: 2 },
  bannerBtn: { height: 44, paddingHorizontal: 16, borderRadius: 8, justifyContent: "center" },
  bannerBtnText: { fontFamily: fonts.bodySemi, color: c.onError, fontSize: 14 },
  toggle: { minHeight: 168, borderRadius: 12, padding: 20, flexDirection: "row", alignItems: "center", gap: 20, borderWidth: 1 },
  toggleOn: { backgroundColor: c.brandPrimary, borderColor: c.brandSecondary },
  toggleOff: { backgroundColor: c.surfaceTertiary, borderColor: c.border },
  powerRing: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  toggleLabel: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 2 },
  toggleState: { fontFamily: fonts.display, fontSize: 38, lineHeight: 44 },
  toggleHint: { fontFamily: fonts.body, fontSize: 12 },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: c.border,
  },
  summaryLabel: { fontFamily: fonts.body, fontSize: 11, color: c.onSurfaceSecondary },
  summaryValue: { fontFamily: fonts.display, fontSize: 20, color: c.onSurface },
  vDivider: { width: 1, alignSelf: "stretch", backgroundColor: c.border },
  syncCard: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, gap: 8 },
  syncHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  syncTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: c.onSurface },
  syncText: { fontFamily: fonts.body, fontSize: 12, color: c.onSurfaceSecondary, marginTop: 2 },
  switchTrack: { width: 52, height: 30, borderRadius: 15, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.borderStrong, padding: 3 },
  switchTrackOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: c.onSurfaceSecondary },
  switchThumbOn: { backgroundColor: c.onBrandPrimary, transform: [{ translateX: 22 }] },
  resetBtn: { height: 44, borderRadius: 8, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  resetText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: c.onSurfaceTertiary },
  section: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 2, color: c.muted, marginTop: 8 },
  metricBig: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 16, borderLeftWidth: 4, borderLeftColor: c.success },
  metricHuge: { fontFamily: fonts.display, fontSize: 56, lineHeight: 60, color: c.success },
  metricRow: { flexDirection: "row", gap: 12 },
  metric: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 16 },
  metricLabel: { fontFamily: fonts.body, fontSize: 13, color: c.onSurfaceSecondary },
  metricValue: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: c.onSurface },
  metricSmall: { fontFamily: fonts.display, fontSize: 22, color: c.muted },
}));
