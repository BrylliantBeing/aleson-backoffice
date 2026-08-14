import Background from "@/components/Background";
import WholeCard from "@/components/WholeCard";
import Colors from "@/constants/Colors";
import { apiFetch } from "@/utils/api";
import { peso } from "@/utils/passengerRules";
import { FontAwesome } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

interface OpenShift {
  id: number;
  opened_at: string;
  opening_float: number;
  expected_cash_so_far: number;
}

interface ClosedShiftSummary {
  expected_cash: number;
  counted_cash: number;
  variance: number;
}

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const Shift = () => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [shift, setShift] = useState<OpenShift | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openingFloat, setOpeningFloat] = useState("");
  const [opening, setOpening] = useState(false);

  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [closing, setClosing] = useState(false);
  const [closedSummary, setClosedSummary] = useState<ClosedShiftSummary | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch("/api/v1/office/shift/current")
      .then((r) => r.json())
      .then((data) => setShift(data.shift))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  const handleOpen = async () => {
    const value = parseFloat(openingFloat);
    if (isNaN(value) || value < 0) {
      setError("Enter a valid opening float.");
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/office/shift/open", {
        method: "POST",
        body: JSON.stringify({ opening_float: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to open shift");
      setOpeningFloat("");
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOpening(false);
    }
  };

  const handleClose = async () => {
    const value = parseFloat(countedCash);
    if (isNaN(value) || value < 0) {
      setError("Enter the counted cash amount.");
      return;
    }
    setClosing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/office/shift/close", {
        method: "POST",
        body: JSON.stringify({ counted_cash: value, notes: notes.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to close shift");
      setClosedSummary({
        expected_cash: data.expected_cash,
        counted_cash: data.counted_cash,
        variance: data.variance,
      });
      setCountedCash("");
      setNotes("");
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setClosing(false);
    }
  };

  return (
    <Background>
      <ScrollView showsVerticalScrollIndicator={false}>
        <WholeCard header="Till" spacer={{ height: 16 }}>
          {loading || shift === undefined ? (
            <ActivityIndicator size="large" color={theme.tint} />
          ) : shift === null ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.greyText, fontFamily: "Lato" }}>
                No open shift. Enter the starting cash in the drawer to open one.
              </Text>
              <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <View style={{ minWidth: 200 }}>
                  <Text style={[styles.label, { color: theme.greyText }]}>Opening Float</Text>
                  <TextInput
                    value={openingFloat}
                    onChangeText={setOpeningFloat}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={theme.greyText}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}
                  />
                </View>
                <Pressable
                  onPress={handleOpen}
                  disabled={opening}
                  style={[styles.button, { backgroundColor: theme.tint, opacity: opening ? 0.6 : 1 }]}
                >
                  {opening ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Open Shift</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              <View style={styles.kpiRow}>
                <View style={[styles.kpi, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
                  <FontAwesome name="clock-o" size={20} color={theme.tint} />
                  <Text style={[styles.kpiValue, { color: theme.text }]}>{formatWhen(shift.opened_at)}</Text>
                  <Text style={[styles.kpiLabel, { color: theme.greyText }]}>Opened</Text>
                </View>
                <View style={[styles.kpi, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
                  <FontAwesome name="money" size={20} color={theme.tint} />
                  <Text style={[styles.kpiValue, { color: theme.text }]}>{peso(shift.opening_float)}</Text>
                  <Text style={[styles.kpiLabel, { color: theme.greyText }]}>Opening Float</Text>
                </View>
                <View style={[styles.kpi, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
                  <FontAwesome name="calculator" size={20} color={theme.tint} />
                  <Text style={[styles.kpiValue, { color: theme.text }]}>{peso(shift.expected_cash_so_far)}</Text>
                  <Text style={[styles.kpiLabel, { color: theme.greyText }]}>Expected Cash Now</Text>
                </View>
              </View>

              <View style={{ gap: 12 }}>
                <Text style={{ color: theme.text, fontFamily: "Lato", fontWeight: "700" }}>Close Shift</Text>
                <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <View style={{ minWidth: 200 }}>
                    <Text style={[styles.label, { color: theme.greyText }]}>Counted Cash</Text>
                    <TextInput
                      value={countedCash}
                      onChangeText={setCountedCash}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={theme.greyText}
                      style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}
                    />
                  </View>
                  <View style={{ minWidth: 240, flex: 1 }}>
                    <Text style={[styles.label, { color: theme.greyText }]}>Notes (optional)</Text>
                    <TextInput
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="e.g. short due to a torn bill"
                      placeholderTextColor={theme.greyText}
                      style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}
                    />
                  </View>
                  <Pressable
                    onPress={handleClose}
                    disabled={closing}
                    style={[styles.button, { backgroundColor: "#e5484d", opacity: closing ? 0.6 : 1 }]}
                  >
                    {closing ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Close Shift</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
        </WholeCard>

        {closedSummary && (
          <WholeCard header="Shift Closed" spacer={{ height: 16 }}>
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.text, fontFamily: "Lato" }}>
                Expected: {peso(closedSummary.expected_cash)} · Counted: {peso(closedSummary.counted_cash)}
              </Text>
              <Text
                style={{
                  color: closedSummary.variance === 0 ? theme.tint : "#e5484d",
                  fontFamily: "Lato",
                  fontWeight: "700",
                }}
              >
                Variance: {closedSummary.variance > 0 ? "+" : ""}
                {peso(closedSummary.variance)}
              </Text>
            </View>
          </WholeCard>
        )}
        <View style={{ height: 50 }} />
      </ScrollView>
    </Background>
  );
};

export default Shift;

const styles = StyleSheet.create({
  label: { fontSize: 13, fontFamily: "Lato", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Lato",
  },
  button: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontFamily: "Lato", fontWeight: "700" },
  error: { color: "#e5484d", fontFamily: "Lato", marginTop: 12 },
  kpiRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  kpi: {
    flex: 1,
    minWidth: 160,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  kpiValue: { fontSize: 18, fontWeight: "800" },
  kpiLabel: { fontSize: 13 },
});
