import { Ionicons } from "@react-native-vector-icons/ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Settings, useSettings, useUpdateSettings } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { ErrorState, LoadingState } from "@/src/components/StateViews";
import { fonts } from "@/src/fonts";
import { pushConfig } from "@/src/native/rideFilter";
import { usesNativeTabs } from "@/src/navigation";
import { DAY_NAMES, isValidTime } from "@/src/schedule";
import { makeStyles, useTheme } from "@/src/theme";

type Form = {
  min_price_per_km: string;
  min_fare: string;
  max_pickup_km: string;
  accept_texts: string;
  target_package: string;
  sync_99_enabled: boolean;
  ninety_nine_package: string;
  ride_active_texts: string;
  ride_end_texts: string;
  offline_texts: string;
  online_texts: string;
  schedule_enabled: boolean;
  schedule_start: string;
  schedule_end: string;
  schedule_days: number[];
  alert_enabled: boolean;
};
type TextKey = Exclude<keyof Form, "sync_99_enabled" | "schedule_enabled" | "schedule_days" | "alert_enabled">;

const LIST_KEYS = ["accept_texts", "ride_active_texts", "ride_end_texts", "offline_texts", "online_texts"] as const;
const splitList = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

const toStr = (n: number) => String(n).replace(".", ",");
const toNum = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? v : NaN;
};

function fromSettings(s: Settings): Form {
  return {
    min_price_per_km: toStr(s.min_price_per_km),
    min_fare: toStr(s.min_fare),
    max_pickup_km: toStr(s.max_pickup_km),
    accept_texts: s.accept_texts.join(", "),
    target_package: s.target_package,
    sync_99_enabled: s.sync_99_enabled,
    ninety_nine_package: s.ninety_nine_package,
    ride_active_texts: s.ride_active_texts.join(", "),
    ride_end_texts: s.ride_end_texts.join(", "),
    offline_texts: s.offline_texts.join(", "),
    online_texts: s.online_texts.join(", "),
    schedule_enabled: s.schedule_enabled,
    schedule_start: s.schedule_start,
    schedule_end: s.schedule_end,
    schedule_days: s.schedule_days,
    alert_enabled: s.alert_enabled,
  };
}

export default function Filtros() {
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [form, setForm] = useState<Form | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Re-sync with server settings when the tab gains focus (Painel/Aprender may have changed them),
  // but keep the user's unsaved edits.
  const synced = useRef<string>("");
  const formRef = useRef<Form | null>(null);
  formRef.current = form;
  useFocusEffect(
    useCallback(() => {
      if (!settings.data) return;
      const cur = formRef.current;
      if (cur && JSON.stringify(cur) !== synced.current) return; // dirty: keep edits
      const next = fromSettings(settings.data);
      synced.current = JSON.stringify(next);
      setForm(next);
    }, [settings.data]),
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  if (settings.isLoading || (!form && !settings.isError))
    return <View style={styles.screen}><ScreenHeader title="Filtros" /><LoadingState label="Carregando filtros..." /></View>;
  if (settings.isError || !form)
    return <View style={styles.screen}><ScreenHeader title="Filtros" /><ErrorState onRetry={() => settings.refetch()} /></View>;

  const set = (k: TextKey) => (v: string) => setForm({ ...form, [k]: v });
  const step = (k: "min_price_per_km" | "min_fare" | "max_pickup_km", delta: number, decimals: number) => {
    const cur = toNum(form[k]);
    const next = Math.max(0, (Number.isFinite(cur) ? cur : 0) + delta);
    set(k)(toStr(Number(next.toFixed(decimals))));
  };

  const save = () => {
    const ppk = toNum(form.min_price_per_km);
    const fare = toNum(form.min_fare);
    const pickup = toNum(form.max_pickup_km);
    if ([ppk, fare, pickup].some((v) => Number.isNaN(v))) {
      setToast({ ok: false, msg: "Preencha valores numéricos válidos." });
      return;
    }
    const lists = Object.fromEntries(LIST_KEYS.map((k) => [k, splitList(form[k])])) as Record<(typeof LIST_KEYS)[number], string[]>;
    if (!lists.accept_texts.length) {
      setToast({ ok: false, msg: "Informe ao menos um texto do botão Aceitar." });
      return;
    }
    if (form.sync_99_enabled && (!lists.ride_active_texts.length || !lists.ride_end_texts.length || !lists.offline_texts.length || !lists.online_texts.length)) {
      setToast({ ok: false, msg: "Preencha todos os textos da integração 99." });
      return;
    }
    if (form.schedule_enabled && (!isValidTime(form.schedule_start) || !isValidTime(form.schedule_end))) {
      setToast({ ok: false, msg: "Horário inválido. Use o formato HH:MM, ex.: 06:00" });
      return;
    }
    if (form.schedule_enabled && !form.schedule_days.length) {
      setToast({ ok: false, msg: "Escolha ao menos um dia de trabalho." });
      return;
    }
    update.mutate(
      {
        min_price_per_km: ppk,
        min_fare: fare,
        max_pickup_km: pickup,
        ...lists,
        target_package: form.target_package.trim(),
        sync_99_enabled: form.sync_99_enabled,
        ninety_nine_package: form.ninety_nine_package.trim(),
        schedule_enabled: form.schedule_enabled,
        schedule_start: isValidTime(form.schedule_start) ? form.schedule_start : undefined,
        schedule_end: isValidTime(form.schedule_end) ? form.schedule_end : undefined,
        schedule_days: form.schedule_days,
        alert_enabled: form.alert_enabled,
      },
      {
        onSuccess: (s) => {
          pushConfig(s);
          const next = fromSettings(s);
          synced.current = JSON.stringify(next);
          setForm(next);
          setToast({ ok: true, msg: "Filtros salvos" });
        },
        onError: () => setToast({ ok: false, msg: "Erro ao salvar. Tente novamente." }),
      },
    );
  };

  return (
    <View style={styles.screen} testID="filtros-screen">
      <ScreenHeader title="Filtros" subtitle="Regras para aceitar uma corrida" />
      <KeyboardAwareScrollView bottomOffset={96} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>CRITÉRIOS</Text>
        <NumberField
          id="min-price-per-km"
          label="Preço mínimo por km"
          unit="R$/km"
          value={form.min_price_per_km}
          onChange={set("min_price_per_km")}
          onStep={(d) => step("min_price_per_km", d * 0.1, 2)}
          hint="Ex.: 2,00 aceita só corridas que pagam R$ 2,00 ou mais por km."
          highlight
        />
        <NumberField
          id="min-fare"
          label="Valor mínimo da corrida"
          unit="R$"
          value={form.min_fare}
          onChange={set("min_fare")}
          onStep={(d) => step("min_fare", d, 0)}
        />
        <NumberField
          id="max-pickup-km"
          label="Distância máxima até o passageiro"
          unit="km"
          value={form.max_pickup_km}
          onChange={set("max_pickup_km")}
          onStep={(d) => step("max_pickup_km", d * 0.5, 1)}
        />

        <Text style={[styles.section, { marginTop: 8 }]}>HORÁRIO DE TRABALHO</Text>
        <SwitchRow
          id="schedule-switch"
          label="Aceitar só no meu horário"
          hint="Fora do horário o bot não aceita nenhuma corrida."
          value={form.schedule_enabled}
          onToggle={() => setForm({ ...form, schedule_enabled: !form.schedule_enabled })}
        />
        {form.schedule_enabled ? (
          <View style={styles.field}>
            <View style={styles.timeRow}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Início</Text>
                <TextInput
                  testID="schedule-start-input"
                  value={form.schedule_start}
                  onChangeText={(v) => setForm({ ...form, schedule_start: maskTime(v) })}
                  keyboardType="number-pad"
                  maxLength={5}
                  placeholder="06:00"
                  placeholderTextColor={colors.muted}
                  style={styles.timeInput}
                />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Fim</Text>
                <TextInput
                  testID="schedule-end-input"
                  value={form.schedule_end}
                  onChangeText={(v) => setForm({ ...form, schedule_end: maskTime(v) })}
                  keyboardType="number-pad"
                  maxLength={5}
                  placeholder="22:00"
                  placeholderTextColor={colors.muted}
                  style={styles.timeInput}
                />
              </View>
            </View>
            <Text style={styles.label}>Dias</Text>
            <View style={styles.daysRow}>
              {DAY_NAMES.map((d, i) => {
                const active = form.schedule_days.includes(i);
                return (
                  <Pressable
                    key={i}
                    testID={`schedule-day-${i}`}
                    accessibilityLabel={DAY_NAMES[i]}
                    onPress={() =>
                      setForm({
                        ...form,
                        schedule_days: active ? form.schedule_days.filter((x) => x !== i) : [...form.schedule_days, i].sort(),
                      })
                    }
                    style={[styles.dayChip, active && styles.dayChipActive]}
                  >
                    <Text style={[styles.dayText, active && styles.dayTextActive]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>Se o fim for antes do início (ex.: 18:00 às 02:00), o horário passa da meia-noite.</Text>
          </View>
        ) : null}

        <Text style={[styles.section, { marginTop: 8 }]}>ALERTA</Text>
        <SwitchRow
          id="alert-switch"
          label="Som e vibração ao aceitar"
          hint="Toca um bipe e vibra o celular sempre que o bot aceita uma corrida."
          value={form.alert_enabled}
          onToggle={() => setForm({ ...form, alert_enabled: !form.alert_enabled })}
        />

        <Text style={[styles.section, { marginTop: 8 }]}>LEITURA DA TELA (ANDROID)</Text>
        <Pressable testID="open-learning-button" onPress={() => router.push("/aprender")} style={[styles.field, styles.switchRow]}>
          <Ionicons name="scan-outline" size={24} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Modo aprendizado</Text>
            <Text style={styles.hint}>Leia a tela real do RapidoCar e da 99 e toque nos textos para configurar os botões.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <TextField
          id="accept-texts"
          label="Textos do botão Aceitar"
          value={form.accept_texts}
          onChange={set("accept_texts")}
          hint="Separe por vírgula. O app toca no primeiro botão com um desses textos."
        />
        <TextField
          id="target-package"
          label="Pacote do app alvo (contém)"
          value={form.target_package}
          onChange={set("target_package")}
          hint="Parte do nome do pacote Android do RapidoCar. Padrão: rapido"
        />

        <Text style={[styles.section, { marginTop: 8 }]}>INTEGRAÇÃO 99</Text>
        <Pressable
          testID="sync-99-switch"
          accessibilityRole="switch"
          accessibilityState={{ checked: form.sync_99_enabled }}
          onPress={() => setForm({ ...form, sync_99_enabled: !form.sync_99_enabled })}
          style={[styles.field, styles.switchRow, form.sync_99_enabled && styles.fieldHighlight]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Ficar offline no RapidoCar durante corrida da 99</Text>
            <Text style={styles.hint}>Ao aceitar na 99, o bot desconecta o RapidoCar. Quando a corrida acabar, reconecta.</Text>
          </View>
          <View style={[styles.switchTrack, form.sync_99_enabled && styles.switchTrackOn]}>
            <View style={[styles.switchThumb, form.sync_99_enabled && styles.switchThumbOn]} />
          </View>
        </Pressable>
        {form.sync_99_enabled ? (
          <>
            <TextField id="ninety-nine-package" label="Pacote do app 99 (contém)" value={form.ninety_nine_package} onChange={set("ninety_nine_package")} hint="Padrão: app99 (99 Motorista)" />
            <TextField id="ride-active-texts" label="Textos que indicam corrida em andamento na 99" value={form.ride_active_texts} onChange={set("ride_active_texts")} hint="Separe por vírgula." />
            <TextField id="ride-end-texts" label="Textos que indicam fim da corrida na 99" value={form.ride_end_texts} onChange={set("ride_end_texts")} hint="Separe por vírgula." />
            <TextField id="offline-texts" label="Botão para ficar offline no RapidoCar" value={form.offline_texts} onChange={set("offline_texts")} hint="Separe por vírgula." />
            <TextField id="online-texts" label="Botão para ficar online no RapidoCar" value={form.online_texts} onChange={set("online_texts")} hint="Separe por vírgula." />
          </>
        ) : null}
      </KeyboardAwareScrollView>

      {toast ? (
        <Animated.View entering={FadeInDown} exiting={FadeOutDown} style={[styles.toast, { bottom: bottomChrome + 88 }, !toast.ok && styles.toastErr]} testID="filters-toast">
          <Text style={styles.toastText}>{toast.msg}</Text>
        </Animated.View>
      ) : null}

      <View style={[styles.footer, { paddingBottom: bottomChrome + 12 }]}>
        <Pressable testID="save-filters-button" onPress={save} disabled={update.isPending} style={({ pressed }) => [styles.saveBtn, (pressed || update.isPending) && { opacity: 0.8 }]}>
          <Text style={styles.saveText}>{update.isPending ? "Salvando..." : "Salvar Filtros"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function maskTime(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function SwitchRow(props: { id: string; label: string; hint: string; value: boolean; onToggle: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      testID={props.id}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value }}
      onPress={props.onToggle}
      style={[styles.field, styles.switchRow, props.value && styles.fieldHighlight]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{props.label}</Text>
        <Text style={styles.hint}>{props.hint}</Text>
      </View>
      <View style={[styles.switchTrack, props.value && styles.switchTrackOn]}>
        <View style={[styles.switchThumb, props.value && styles.switchThumbOn]} />
      </View>
    </Pressable>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  onStep: (dir: 1 | -1) => void;
  hint?: string;
  highlight?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.field, props.highlight && styles.fieldHighlight]}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.numRow}>
        <Pressable testID={`${props.id}-decrease`} onPress={() => props.onStep(-1)} style={styles.stepBtn}>
          <Ionicons name="remove" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={styles.numBox}>
          <TextInput
            testID={`${props.id}-input`}
            value={props.value}
            onChangeText={props.onChange}
            keyboardType="decimal-pad"
            style={styles.numInput}
            selectionColor={colors.brandPrimary}
          />
          <Text style={styles.unit}>{props.unit}</Text>
        </View>
        <Pressable testID={`${props.id}-increase`} onPress={() => props.onStep(1)} style={styles.stepBtn}>
          <Ionicons name="add" size={24} color={colors.onSurface} />
        </Pressable>
      </View>
      {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
    </View>
  );
}

function TextField(props: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        testID={`${props.id}-input`}
        value={props.value}
        onChangeText={props.onChange}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.textInput}
        placeholderTextColor={colors.muted}
        selectionColor={colors.brandPrimary}
      />
      {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surface },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  section: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 2, color: c.muted },
  field: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 12, gap: 8, borderWidth: 1, borderColor: c.border },
  fieldHighlight: { borderColor: c.brandPrimary },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, color: c.onSurfaceTertiary },
  numRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: { width: 52, height: 52, borderRadius: 8, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  numBox: { flex: 1, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  numInput: { fontFamily: fonts.display, fontSize: 30, color: c.onSurface, minWidth: 60, textAlign: "center", padding: 0 },
  unit: { fontFamily: fonts.bodyMedium, fontSize: 13, color: c.onSurfaceSecondary },
  textInput: { height: 48, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, color: c.onSurface, fontFamily: fonts.body, fontSize: 15 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: c.muted },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  timeRow: { flexDirection: "row", gap: 12 },
  timeInput: { height: 52, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, color: c.onSurface, fontFamily: fonts.display, fontSize: 28, textAlign: "center", padding: 0 },
  daysRow: { flexDirection: "row", justifyContent: "space-between", gap: 4 },
  dayChip: { flex: 1, minWidth: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  dayChipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  dayText: { fontFamily: fonts.bodySemi, fontSize: 12, color: c.onSurfaceSecondary },
  dayTextActive: { color: c.onBrandPrimary },
  switchTrack: { width: 52, height: 30, borderRadius: 15, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.borderStrong, padding: 3 },
  switchTrackOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: c.onSurfaceSecondary },
  switchThumbOn: { backgroundColor: c.onBrandPrimary, transform: [{ translateX: 22 }] },
  footer: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider },
  saveBtn: { height: 56, borderRadius: 12, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  saveText: { fontFamily: fonts.bodySemi, fontSize: 16, color: c.onBrandPrimary },
  toast: { position: "absolute", left: 16, right: 16, backgroundColor: c.success, borderRadius: 8, padding: 12 },
  toastErr: { backgroundColor: c.error },
  toastText: { fontFamily: fonts.bodySemi, color: c.onSuccess, fontSize: 14, textAlign: "center" },
}));
