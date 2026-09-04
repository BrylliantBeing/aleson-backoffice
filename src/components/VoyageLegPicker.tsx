import { Voyage } from "@/types/voyage";
import { seatNumberLabel } from "@/utils/seatLabel";
import { FontAwesome } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

const formatTime = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.split(":");
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
};

interface LegPickerProps {
  theme: any;
  label: string;
  loading: boolean;
  voyages: Voyage[];
  selectedId: number | null;
  onSelectVoyage: (id: number) => void;
  selectedClass: string;
  onSelectClass: (c: string) => void;
  seatPax: number;
  seats: string[];
  onEditSeats: () => void;
}

// Voyage + class picker for one leg — module scope so it never remounts (a
// component defined inside a render function would remount on every render
// and wipe whatever selection state it holds).
export default function VoyageLegPicker({
  theme,
  label,
  loading,
  voyages,
  selectedId,
  onSelectVoyage,
  selectedClass,
  onSelectClass,
  seatPax,
  seats,
  onEditSeats,
}: LegPickerProps) {
  const selected = voyages.find((v) => v.voyage_id === selectedId);
  return (
    <View>
      <Text style={[styles.legLabel, { color: theme.greyText }]}>{label.toUpperCase()}</Text>
      {loading ? (
        <ActivityIndicator color={theme.tint} style={{ marginVertical: 8 }} />
      ) : voyages.length === 0 ? (
        <Text style={{ color: theme.greyText, fontStyle: "italic", fontSize: 13 }}>
          No voyages for this route/date.
        </Text>
      ) : (
        <View style={{ gap: 6 }}>
          {voyages.map((v) => {
            const active = v.voyage_id === selectedId;
            return (
              <Pressable
                key={v.voyage_id}
                onPress={() => onSelectVoyage(v.voyage_id)}
                style={[
                  styles.voyageOption,
                  { borderColor: active ? theme.tint : theme.border, backgroundColor: active ? theme.tint + "14" : "transparent" },
                ]}
              >
                <FontAwesome
                  name={active ? "dot-circle-o" : "circle-o"}
                  size={15}
                  color={active ? theme.tint : theme.greyText}
                />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                  {v.vessel_name}
                </Text>
                <Text style={{ color: theme.greyText, fontSize: 12 }}>{formatTime(v.departure_time)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Class chips */}
      {selected && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {Object.keys(selected.class_name).map((cls) => {
            const active = cls === selectedClass;
            const remaining = selected.availablility?.[cls] ?? 0;
            return (
              <Pressable
                key={cls}
                onPress={() => onSelectClass(cls)}
                style={[
                  styles.classChip,
                  { borderColor: active ? theme.tint : theme.border, backgroundColor: active ? theme.tint : "transparent" },
                ]}
              >
                <Text style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "600" }}>{cls}</Text>
                <Text style={{ color: active ? "#fff" : theme.greyText, fontSize: 11 }}>{remaining}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Assigned seats + edit */}
      {selected && !!selectedClass && seatPax > 0 && (
        <View style={[styles.seatSummary, { borderColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.greyText, fontSize: 11 }}>Seats</Text>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
              {seats.length ? seats.map(seatNumberLabel).join(", ") : "—"}
            </Text>
          </View>
          <Pressable onPress={onEditSeats} style={[styles.editSeatsBtn, { borderColor: theme.tint }]}>
            <FontAwesome name="th" size={12} color={theme.tint} />
            <Text style={{ color: theme.tint, fontSize: 12, fontWeight: "600" }}>Edit</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 6 },
  voyageOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  classChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  seatSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  editSeatsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
