import Colors from "@/constants/Colors";
import { useAuth } from "@/context/AuthContext";
import { FontAwesome } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

const Login = () => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  const router = useRouter();
  const { agent, login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in — the counter agent goes straight to the booking screen.
  if (agent) return <Redirect href="/" />;

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await login(email.trim(), password);
    setSubmitting(false);
    if (res.ok) router.replace("/");
    else setError(res.error ?? "Login failed.");
  };

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, color: theme.text, backgroundColor: theme.control },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.primary }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: theme.cardBackground, shadowColor: theme.shadowColor },
        ]}
      >
        <View style={styles.brandRow}>
          <FontAwesome name="ship" size={28} color={theme.tint} />
          <Text style={[styles.brand, { color: theme.text }]}>Ticketing Office</Text>
        </View>
        <Text style={[styles.subtitle, { color: theme.greyText }]}>
          Sign in to book and attribute counter sales.
        </Text>

        <Text style={[styles.label, { color: theme.text }]}>Email</Text>
        <TextInput
          style={inputStyle}
          value={email}
          onChangeText={setEmail}
          placeholder="agent@example.com"
          placeholderTextColor={theme.greyText}
          autoCapitalize="none"
          keyboardType="email-address"
          onSubmitEditing={handleLogin}
        />

        <Text style={[styles.label, { color: theme.text, marginTop: 16 }]}>
          Password
        </Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[inputStyle, { flex: 1 }]}
            value={password}
            onChangeText={setPassword}
            placeholder="Enter password"
            placeholderTextColor={theme.greyText}
            secureTextEntry={!showPassword}
            onSubmitEditing={handleLogin}
          />
          <Pressable
            onPress={() => setShowPassword((s) => !s)}
            style={styles.eyeBtn}
            hitSlop={8}
          >
            <FontAwesome
              name={showPassword ? "eye-slash" : "eye"}
              size={18}
              color={theme.greyText}
            />
          </Pressable>
        </View>

        {error && (
          <Text style={[styles.error, { color: "#e5484d" }]}>{error}</Text>
        )}

        <Pressable
          onPress={handleLogin}
          disabled={submitting}
          style={({ hovered }) => [
            styles.button,
            {
              backgroundColor: theme.tint,
              opacity: submitting ? 0.7 : hovered ? 0.9 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};

export default Login;

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%",
    maxWidth: 420,
    padding: 32,
    borderRadius: 22,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.28,
    shadowRadius: 30,
    elevation: 10,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brand: { fontSize: 26, fontFamily: "Lato", fontWeight: "700" },
  subtitle: { fontSize: 15, fontFamily: "Lato", marginTop: 6, marginBottom: 24 },
  label: { fontSize: 16, fontFamily: "Lato", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 17,
    fontFamily: "Lato",
  },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn: { padding: 10 },
  error: { fontSize: 14, fontFamily: "Lato", marginTop: 14 },
  button: {
    marginTop: 24,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  buttonText: { color: "#fff", fontSize: 17, fontFamily: "Lato", fontWeight: "700" },
});
