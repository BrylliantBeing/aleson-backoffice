import Background from "@/components/Background";
import WholeCard from "@/components/WholeCard";
import Colors from "@/constants/Colors";
import { apiFetch } from "@/utils/api";
import { CURRENCIES, money } from "@/utils/currency";
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

/** One currency's balance in the drawer. Nothing converts between currencies,
 *  so each is floated, sold against and counted entirely on its own. */
interface DrawerLine {
  currency: string;
  opening_float: number;
  cash_sales: number;
  expected_cash: number;
}

interface OpenShift {
  id: number;
  opened_at: string;
  opening_float: number;
  expected_cash_so_far: number;
  by_currency: DrawerLine[];
}

interface ClosedLine {
  currency: string;
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

  // One field per currency — a counter selling an international leg for cash
  // takes that currency into the same drawer.
  const emptyAmounts = () =>
    CURRENCIES.reduce((a, c) => ({ ...a, [c]: "" }), {} as Record<string, string>);
  const [openingFloats, setOpeningFloats] = useState<Record<string, string>>(emptyAmounts);
  const [opening, setOpening] = useState(false);

  const [countedCash, setCountedCash] = useState<Record<string, string>>(emptyAmounts);
  const [notes, setNotes] = useState("");
  const [closing, setClosing] = useState(false);
  const [closedSummary, setClosedSummary] = useState<ClosedLine[] | null>(null);

  /** Blank means "no cash of this currency", not an error — a PHP-only counter
   *  should never have to type a zero into the MYR box. */
  const parseAmounts = (raw: Record<string, string>) => {
    const out: Record<string, number> = {};
    for (const code of CURRENCIES) {
      const text = (raw[code] ?? "").trim();
      if (!text) continue;
      const value = parseFloat(text);
      if (isNaN(value) || value < 0) return null;
      out[code] = value;
    }
    return out;
  };

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
    const floats = parseAmounts(openingFloats);
    if (!floats || Object.keys(floats).length === 0) {
      setError("Enter a valid opening float for at least one currency.");
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/office/shift/open", {
        method: "POST",
        body: JSON.stringify({ opening_floats: floats }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to open shift");
      setOpeningFloats(emptyAmounts());
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOpening(false);
    }
  };

  const handleClose = async () => {
    const counted = parseAmounts(countedCash);
    if (!counted) {
      setError("Enter a valid counted amount.");
      return;
    }
    setClosing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/office/shift/close", {
        method: "POST",
        body: JSON.stringify({
          counted_cash_by_currency: counted,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to close shift");
      setClosedSummary(data.by_currency ?? []);
      setCountedCash(emptyAmounts());
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
                Leave a currency blank if the drawer holds none of it.
              </Text>
              <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                {CURRENCIES.map((code) => (
                  <View key={code} style={{ minWidth: 200 }}>
                    <Text style={[styles.label, { color: theme.greyText }]}>
                      Opening Float ({code})
                    </Text>
                    <TextInput
                      value={openingFloats[code] ?? ""}
                      onChangeText={(v) =>
                        setOpeningFloats((prev) => ({ ...prev, [code]: v }))
                      }
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={theme.greyText}
                      style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}
                    />
                  </View>
                ))}
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
                {/* One pair of figures per currency held — never a single total,
                    since PHP and MYR are not interchangeable. */}
                {(shift.by_currency ?? []).map((line) => (
                  <React.Fragment key={line.currency}>
                    <View style={[styles.kpi, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
                      <FontAwesome name="money" size={20} color={theme.tint} />
                      <Text style={[styles.kpiValue, { color: theme.text }]}>
                        {money(line.opening_float, line.currency)}
                      </Text>
                      <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                        Opening Float ({line.currency})
                      </Text>
                    </View>
                    <View style={[styles.kpi, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
                      <FontAwesome name="calculator" size={20} color={theme.tint} />
                      <Text style={[styles.kpiValue, { color: theme.text }]}>
                        {money(line.expected_cash, line.currency)}
                      </Text>
                      <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                        Expected Cash Now ({line.currency})
                      </Text>
                    </View>
                  </React.Fragment>
                ))}
              </View>

              <View style={{ gap: 12 }}>
                <Text style={{ color: theme.text, fontFamily: "Lato", fontWeight: "700" }}>Close Shift</Text>
                <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                  {CURRENCIES.map((code) => (
                    <View key={code} style={{ minWidth: 200 }}>
                      <Text style={[styles.label, { color: theme.greyText }]}>
                        Counted Cash ({code})
                      </Text>
                      <TextInput
                        value={countedCash[code] ?? ""}
                        onChangeText={(v) =>
                          setCountedCash((prev) => ({ ...prev, [code]: v }))
                        }
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={theme.greyText}
                        style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}
                      />
                    </View>
                  ))}
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
            <View style={{ gap: 14 }}>
              {closedSummary.map((line) => (
                <View key={line.currency} style={{ gap: 6 }}>
                  <Text style={{ color: theme.text, fontFamily: "Lato", fontWeight: "700" }}>
                    {line.currency}
                  </Text>
                  <Text style={{ color: theme.text, fontFamily: "Lato" }}>
                    Expected: {money(line.expected_cash, line.currency)} · Counted:{" "}
                    {money(line.counted_cash, line.currency)}
                  </Text>
                  <Text
                    style={{
                      color: line.variance === 0 ? theme.tint : "#e5484d",
                      fontFamily: "Lato",
                      fontWeight: "700",
                    }}
                  >
                    Variance: {line.variance > 0 ? "+" : ""}
                    {money(line.variance, line.currency)}
                  </Text>
                </View>
              ))}
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
    // On web a bare <input> keeps `min-width: auto`, so it refuses to shrink
    // below its ~20-character intrinsic width and starves whatever shares the
    // row with it. Views get min-width:0 from react-native-web; inputs ask.
    minWidth: 0,
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
