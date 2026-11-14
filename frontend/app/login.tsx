import { Ionicons } from "@react-native-vector-icons/ionicons";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiLogin, apiRegister, PRIVACY_URL } from "@/src/api";
import { useAuth } from "@/src/auth";
import { fonts } from "@/src/fonts";
import { makeStyles, useTheme } from "@/src/theme";

type Mode = "login" | "register";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    const e = email.trim();
    if (!e || !password || (mode === "register" && !name.trim())) {
      setError("Preencha todos os campos.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const res = mode === "login" ? await apiLogin(e, password) : await apiRegister(name.trim(), e, password);
      await signIn(res.access_token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen} testID="login-screen">
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
      >
        <Animated.View entering={FadeIn.duration(400)} style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="flash" size={32} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.title}>AutoCorrida</Text>
          <Text style={styles.subtitle}>Seu bot de corridas do RapidoCar, com seus filtros e seu histórico.</Text>
        </Animated.View>

        <View style={styles.segment}>
          {(["login", "register"] as const).map((m) => (
            <Pressable
              key={m}
              testID={`auth-mode-${m}`}
              onPress={() => {
                setMode(m);
                setError(null);
              }}
              style={[styles.segBtn, mode === m && styles.segBtnActive]}
            >
              <Text style={[styles.segText, mode === m && styles.segTextActive]}>{m === "login" ? "Entrar" : "Criar conta"}</Text>
            </Pressable>
          ))}
        </View>

        <Animated.View key={mode} entering={FadeInDown.duration(250)} style={styles.form}>
          {mode === "register" ? (
            <Field label="Nome">
              <TextInput
                testID="auth-name-input"
                value={name}
                onChangeText={setName}
                placeholder="Seu nome"
                placeholderTextColor={colors.muted}
                style={styles.input}
                autoComplete="name"
              />
            </Field>
          ) : null}
          <Field label="E-mail">
            <TextInput
              testID="auth-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="voce@email.com"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
            />
          </Field>
          <Field label="Senha">
            <View style={styles.passRow}>
              <TextInput
                testID="auth-password-input"
                value={password}
                onChangeText={setPassword}
                placeholder={mode === "register" ? "Mínimo 8 caracteres" : "Sua senha"}
                placeholderTextColor={colors.muted}
                style={[styles.input, { flex: 1, borderWidth: 0 }]}
                secureTextEntry={!showPass}
                autoCapitalize="none"
                onSubmitEditing={submit}
              />
              <Pressable testID="auth-toggle-password" onPress={() => setShowPass((v) => !v)} style={styles.eye} hitSlop={6}>
                <Ionicons name={showPass ? "eye-off" : "eye"} size={20} color={colors.onSurfaceSecondary} />
              </Pressable>
            </View>
          </Field>

          {error ? (
            <Text style={styles.error} testID="auth-error">
              {error}
            </Text>
          ) : null}

          <Pressable testID="auth-submit-button" onPress={submit} disabled={loading} style={({ pressed }) => [styles.submit, (pressed || loading) && { opacity: 0.85 }]}>
            {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>{mode === "login" ? "Entrar" : "Criar conta"}</Text>}
          </Pressable>
        </Animated.View>

        <Pressable testID="login-privacy-link" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} style={styles.privacy}>
          <Text style={styles.privacyText}>
            Ao continuar você concorda com a <Text style={styles.link}>Política de Privacidade</Text>
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 24, gap: 24, flexGrow: 1 },
  brand: { gap: 8 },
  logo: { width: 64, height: 64, borderRadius: 12, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontFamily: fonts.display, fontSize: 44, lineHeight: 48, color: c.onSurface },
  subtitle: { fontFamily: fonts.body, fontSize: 15, color: c.onSurfaceSecondary },
  segment: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: 8, padding: 4, gap: 4 },
  segBtn: { flex: 1, height: 44, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segBtnActive: { backgroundColor: c.surfaceTertiary },
  segText: { fontFamily: fonts.bodySemi, fontSize: 14, color: c.muted },
  segTextActive: { color: c.onSurface },
  form: { gap: 16 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, color: c.onSurfaceTertiary },
  input: { height: 52, borderRadius: 8, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, color: c.onSurface, fontFamily: fonts.body, fontSize: 16 },
  passRow: { flexDirection: "row", alignItems: "center", borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  eye: { width: 48, height: 52, alignItems: "center", justifyContent: "center" },
  error: { fontFamily: fonts.bodyMedium, fontSize: 14, color: c.error },
  submit: { height: 56, borderRadius: 12, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 4 },
  submitText: { fontFamily: fonts.bodySemi, fontSize: 16, color: c.onBrandPrimary },
  privacy: { minHeight: 44, justifyContent: "center" },
  privacyText: { fontFamily: fonts.body, fontSize: 12, color: c.muted, textAlign: "center" },
  link: { color: c.brandSecondary, textDecorationLine: "underline" },
}));
