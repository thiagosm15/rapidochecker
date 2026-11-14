import { Ionicons } from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { brl, num, useSettings, useSimulate } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { fonts } from "@/src/fonts";
import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, useTheme } from "@/src/theme";

const BG =
  "https://images.unsplash.com/photo-1518783211485-10fd3bfb2ce2?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=1200";

export default function Simulador() {
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { colors } = useTheme();
  const styles = useStyles();
  const sim = useSimulate();
  const settings = useSettings();
  const ride = sim.data;

  const generate = () => {
    sim.mutate(undefined, {
      onSuccess: (r) => {
        if (Platform.OS !== "web" && settings.data?.alert_enabled)
          Haptics.notificationAsync(r.accepted ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
      },
    });
  };

  return (
    <View style={styles.screen} testID="simulador-screen">
      <Image source={{ uri: BG }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient colors={[colors.scrimClear, colors.scrim, colors.surface]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <ScreenHeader title="Simulador" subtitle="Teste seus filtros com ofertas aleatórias" />

      <View style={styles.body}>
        {sim.isPending && !ride ? (
          <ActivityIndicator color={colors.brandPrimary} testID="simulate-loading" />
        ) : sim.isError ? (
          <View style={styles.empty} testID="simulate-error">
            <Text style={styles.emptyText}>Não foi possível gerar a corrida.</Text>
          </View>
        ) : !ride ? (
          <View style={styles.empty} testID="simulate-empty">
            <View style={styles.emptyIcon}>
              <Ionicons name="car-sport-outline" size={48} color={colors.brandPrimary} />
            </View>
            <Text style={styles.emptyText}>Toque para simular uma corrida</Text>
            {settings.data ? (
              <Text style={styles.emptySub}>
                Filtro atual: mín {brl(settings.data.min_price_per_km)}/km, mín {brl(settings.data.min_fare)}, busca até {num(settings.data.max_pickup_km)} km
              </Text>
            ) : null}
          </View>
        ) : (
          <Animated.View key={ride.id} entering={FadeInDown.duration(300)} style={styles.card} testID="ride-offer-card">
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.offerTag}>NOVA OFERTA · RAPIDOCAR</Text>
                <Text style={styles.price} testID="ride-price" numberOfLines={1} adjustsFontSizeToFit>{brl(ride.price)}</Text>
              </View>
              <Animated.View entering={ZoomIn.springify().delay(200)}>
                <View style={[styles.stamp, { borderColor: ride.accepted ? colors.success : colors.error }]} testID="ride-decision-stamp">
                  <Text style={[styles.stampText, { color: ride.accepted ? colors.success : colors.error }]}>
                    {ride.accepted ? "ACEITO" : "RECUSADO"}
                  </Text>
                </View>
              </Animated.View>
            </View>
            <View style={styles.route}>
              <RoutePoint icon="radio-button-on" color={colors.success} label="Embarque" value={ride.pickup ?? "-"} extra={`${num(ride.pickup_km)} km até você`} />
              <View style={styles.routeLine} />
              <RoutePoint icon="location" color={colors.brandPrimary} label="Destino" value={ride.dropoff ?? "-"} extra={`${num(ride.trip_km)} km de corrida`} />
            </View>
            <View style={styles.ppkRow}>
              <Text style={styles.ppkLabel}>Preço por km</Text>
              <Text style={[styles.ppk, { color: ride.accepted ? colors.success : colors.error }]} testID="ride-price-per-km">
                {brl(ride.price_per_km)}/km
              </Text>
            </View>
            {ride.reasons.length ? (
              <View style={styles.reasons}>
                {ride.reasons.map((r) => (
                  <View key={r} style={styles.reasonChip}>
                    <Text style={styles.reasonText}>{r}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Animated.View>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: bottomChrome + 16 }]}>
        <Pressable
          testID="generate-ride-button"
          onPress={generate}
          disabled={sim.isPending}
          style={({ pressed }) => [styles.btn, (pressed || sim.isPending) && { opacity: 0.85 }]}
        >
          <Ionicons name="shuffle" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.btnText}>{sim.isPending ? "Gerando..." : "Gerar Nova Corrida"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RoutePoint({ icon, color, label, value, extra }: { icon: "radio-button-on" | "location"; color: string; label: string; value: string; extra: string }) {
  const styles = useStyles();
  return (
    <View style={styles.point}>
      <Ionicons name={icon} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={styles.pointLabel}>{label}</Text>
        <Text style={styles.pointValue} numberOfLines={1}>{value}</Text>
      </View>
      <Text style={styles.pointExtra}>{extra}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surface },
  body: { flex: 1, justifyContent: "center", padding: 16 },
  empty: { alignItems: "center", gap: 12, paddingHorizontal: 24 },
  emptyIcon: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: c.brandPrimary, alignItems: "center", justifyContent: "center", backgroundColor: c.brandTertiary },
  emptyText: { fontFamily: fonts.bodySemi, fontSize: 16, color: c.onSurface, textAlign: "center" },
  emptySub: { fontFamily: fonts.body, fontSize: 13, color: c.onSurfaceSecondary, textAlign: "center" },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  cardTop: { padding: 16, borderBottomWidth: 1, borderBottomColor: c.divider, flexDirection: "row", alignItems: "center", gap: 12 },
  offerTag: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 1.5, color: c.brandPrimary },
  price: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: c.onSurface },
  route: { padding: 16, gap: 4 },
  routeLine: { width: 2, height: 16, backgroundColor: c.borderStrong, marginLeft: 8 },
  point: { flexDirection: "row", alignItems: "center", gap: 12 },
  pointLabel: { fontFamily: fonts.body, fontSize: 11, color: c.muted },
  pointValue: { fontFamily: fonts.bodyMedium, fontSize: 15, color: c.onSurface },
  pointExtra: { fontFamily: fonts.displaySemi, fontSize: 16, color: c.onSurfaceTertiary },
  ppkRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.surfaceTertiary },
  ppkLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: c.onSurfaceSecondary },
  ppk: { fontFamily: fonts.display, fontSize: 30 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12 },
  reasonChip: { backgroundColor: c.brandTertiary, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 },
  reasonText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: c.onBrandTertiary },
  stamp: { borderWidth: 3, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 2, transform: [{ rotate: "-8deg" }], backgroundColor: c.surface },
  stampText: { fontFamily: fonts.display, fontSize: 20, letterSpacing: 1 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
  btn: { height: 56, borderRadius: 12, backgroundColor: c.brandPrimary, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  btnText: { fontFamily: fonts.bodySemi, fontSize: 16, color: c.onBrandPrimary },
}));
