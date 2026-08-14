import Colors from "@/constants/Colors";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  ViewStyle,
} from "react-native";

// Travel-date control: separate Month / Day / Year boxes, a ±1-day stepper, and
// Today / Tomorrow / Day-after shortcuts. Emits ISO `YYYY-MM-DD` (or "" while
// incomplete/invalid). Two-digit years resolve to 20YY.

const pad = (n: number) => String(n).padStart(2, "0");
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const parseISO = (iso?: string): Date | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
};

interface Fields {
  mm: string;
  dd: string;
  yy: string;
}

const fieldsFromISO = (iso?: string): Fields => {
  const d = parseISO(iso);
  return d
    ? { mm: pad(d.getMonth() + 1), dd: pad(d.getDate()), yy: pad(d.getFullYear() % 100) }
    : { mm: "", dd: "", yy: "" };
};

const fieldsToISO = (f: Fields): string => {
  if (!f.mm || !f.dd || !f.yy) return "";
  const mm = parseInt(f.mm, 10);
  const dd = parseInt(f.dd, 10);
  const yy = parseInt(f.yy, 10);
  if (isNaN(mm) || isNaN(dd) || isNaN(yy)) return "";
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  const d = new Date(2000 + yy, mm - 1, dd);
  if (d.getMonth() !== mm - 1 || d.getDate() !== dd) return "";
  return isoLocal(d);
};

interface Props {
  value?: string; // ISO YYYY-MM-DD
  onChange: (iso: string) => void;
  label?: string;
  showShortcuts?: boolean;
  active?: boolean; // this leg is the shared calendar's current target
  onActivate?: () => void; // ask the parent to point the calendar at this leg
  style?: ViewStyle;
}

const TravelDateField: React.FC<Props> = ({
  value,
  onChange,
  label,
  showShortcuts = true,
  active = false,
  onActivate,
  style,
}) => {
  const scheme = useColorScheme() ?? "light";
  const theme = Colors[scheme] ?? Colors.light;

  const [f, setF] = useState<Fields>(fieldsFromISO(value));

  // Sync external changes / resets without clobbering mid-typing.
  useEffect(() => {
    if (value === undefined) return;
    if (fieldsToISO(f) !== value) setF(fieldsFromISO(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (fields: Fields) => {
    setF(fields);
    onChange(fieldsToISO(fields));
    onActivate?.(); // editing a leg makes it the calendar's target
  };

  const setPart = (k: keyof Fields, v: string) =>
    commit({ ...f, [k]: v.replace(/\D/g, "").slice(0, 2) });

  const setToDate = (d: Date) => commit(fieldsFromISO(isoLocal(d)));

  const shiftDays = (days: number) => {
    // Step from what's currently shown; fall back to the committed value, then today.
    const base = parseISO(fieldsToISO(f)) ?? parseISO(value) ?? new Date();
    base.setDate(base.getDate() + days);
    setToDate(base);
  };

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dayAfter = new Date(today);
  dayAfter.setDate(today.getDate() + 2);
  const currentISO = fieldsToISO(f);

  const inputStyle = [
    styles.box,
    { borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
  ];

  return (
    <View
      style={[
        style,
        active && { borderLeftColor: theme.tint, borderLeftWidth: 3, paddingLeft: 8, marginLeft: -11 },
      ]}
    >
      {label ? (
        <Text
          onPress={onActivate}
          style={[styles.label, { color: active ? theme.tint : theme.greyText }]}
        >
          {label}
          {active ? "  ●" : ""}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          value={f.mm}
          onChangeText={(v) => setPart("mm", v)}
          onFocus={onActivate}
          placeholder="MM"
          placeholderTextColor={theme.greyText}
          keyboardType="number-pad"
          maxLength={2}
          style={inputStyle}
        />
        <Text style={[styles.sep, { color: theme.greyText }]}>/</Text>
        <TextInput
          value={f.dd}
          onChangeText={(v) => setPart("dd", v)}
          onFocus={onActivate}
          placeholder="DD"
          placeholderTextColor={theme.greyText}
          keyboardType="number-pad"
          maxLength={2}
          style={inputStyle}
        />
        <Text style={[styles.sep, { color: theme.greyText }]}>/</Text>
        <TextInput
          value={f.yy}
          onChangeText={(v) => setPart("yy", v)}
          onFocus={onActivate}
          placeholder="YY"
          placeholderTextColor={theme.greyText}
          keyboardType="number-pad"
          maxLength={2}
          style={inputStyle}
        />
        <View style={styles.stepper}>
          <Pressable onPress={() => shiftDays(-1)} style={[styles.stepBtn, { borderColor: theme.border }]}>
            <FontAwesome name="minus" size={11} color={theme.tint} />
          </Pressable>
          <Pressable onPress={() => shiftDays(1)} style={[styles.stepBtn, { borderColor: theme.border }]}>
            <FontAwesome name="plus" size={11} color={theme.tint} />
          </Pressable>
        </View>
      </View>
      {showShortcuts && (
        <View style={styles.chips}>
          {([["Today", today], ["Tomorrow", tomorrow], ["Day after", dayAfter]] as [string, Date][]).map(
            ([lbl, d]) => {
              const active = currentISO === isoLocal(d);
              return (
                <Pressable
                  key={lbl}
                  onPress={() => setToDate(d)}
                  style={[styles.chip, { borderColor: active ? theme.tint : theme.border, backgroundColor: active ? theme.tint : "transparent" }]}
                >
                  <Text style={{ color: active ? "#fff" : theme.text, fontSize: 11, fontWeight: "600" }}>
                    {lbl}
                  </Text>
                </Pressable>
              );
            }
          )}
        </View>
      )}
    </View>
  );
};

export default TravelDateField;

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
    fontFamily: "Lato",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  box: {
    width: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    textAlign: "center",
    fontSize: 14,
    fontFamily: "Lato",
  },
  sep: { fontSize: 15, fontWeight: "700" },
  stepper: { flexDirection: "row", gap: 4, marginLeft: 6 },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
