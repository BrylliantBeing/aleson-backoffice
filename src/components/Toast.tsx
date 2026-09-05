import Colors from "@/constants/Colors";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

export interface ToastRow {
  label: string;
  value: string;
  /** Renders the value in the success green — used for the change due. */
  accent?: boolean;
}

interface Props {
  visible: boolean;
  title: string;
  /** Big, letter-spaced line under the title (the booking reference). */
  headline?: string;
  rows?: ToastRow[];
  kind?: "success" | "error";
  /** Milliseconds before it fades out on its own. Pass 0 to make it sticky —
   *  it then stays until the caller replaces it or the user closes it. */
  duration?: number;
  /** Optional footnote under the rows — used for a printer problem, which is
   *  worth telling the cashier about without failing the (already paid) sale. */
  note?: string;
  /** Optional secondary action, e.g. reprinting a jammed ticket. */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

const ACCENT = { success: "#2e9e5b", error: "#e5484d" } as const;

// Animated driver is unavailable on react-native-web; keep it native elsewhere.
const NATIVE = Platform.OS !== "web";

const Toast = ({
  visible,
  title,
  headline,
  rows = [],
  kind = "success",
  duration = 10000,
  note,
  actionLabel,
  onAction,
  onDismiss,
}: Props) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: NATIVE,
    }).start();
    if (!visible || duration <= 0) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, duration]);

  if (!visible) return null;

  const accent = ACCENT[kind];

  return (
    <View style={styles.layer} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.toast,
          {
            backgroundColor: theme.cardBackground,
            borderColor: theme.border,
            shadowColor: theme.shadowColor,
            opacity: anim,
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          },
        ]}
      >
        <View style={[styles.stripe, { backgroundColor: accent }]} />
        <View style={styles.body}>
          <View style={styles.headRow}>
            <FontAwesome
              name={kind === "success" ? "check-circle" : "exclamation-circle"}
              size={18}
              color={accent}
            />
            <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
            <Pressable onPress={onDismiss} hitSlop={10} style={styles.close}>
              <FontAwesome name="close" size={14} color={theme.greyText} />
            </Pressable>
          </View>

          {headline ? (
            <Text style={[styles.headline, { color: theme.text }]}>{headline}</Text>
          ) : null}

          {rows.map((r, i) => (
            <View key={`${r.label}-${i}`} style={styles.row}>
              <Text style={[styles.label, { color: theme.greyText }]} numberOfLines={1}>
                {r.label}
              </Text>
              <Text
                style={[styles.value, { color: r.accent ? accent : theme.text }, r.accent && { fontWeight: "800" }]}
                numberOfLines={1}
              >
                {r.value}
              </Text>
            </View>
          ))}

          {note ? <Text style={styles.note}>{note}</Text> : null}

          {actionLabel && onAction ? (
            <Pressable
              onPress={onAction}
              style={[styles.action, { borderColor: theme.border }]}
            >
              <FontAwesome name="print" size={12} color={theme.text} />
              <Text style={[styles.actionText, { color: theme.text }]}>{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
};

export default Toast;

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "flex-end",
    justifyContent: "flex-end",
    padding: 16,
  },
  toast: {
    flexDirection: "row",
    // Fills a narrow screen instead of overflowing it, but never grows past the
    // width the hand-over figures were laid out for.
    width: "100%",
    maxWidth: 330,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  stripe: { width: 4 },
  body: { flex: 1, padding: 12, gap: 4 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: "800", fontFamily: "Lato" },
  close: { padding: 2 },
  headline: { fontSize: 26, fontWeight: "800", letterSpacing: 3, marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 12, flexShrink: 1 },
  value: { fontSize: 13, fontWeight: "600" },
  note: { fontSize: 12, lineHeight: 16, color: "#e5484d", marginTop: 6 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderRadius: 8,
  },
  actionText: { fontSize: 13, fontWeight: "700" },
});
