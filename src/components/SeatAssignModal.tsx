import Colors from "@/constants/Colors";
import { NAME_TO_CODE, Seat, SeatMap } from "@/utils/seatAssign";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

const SEAT_SIZE = 30;
const SEAT_GAP = 4;

// Cabin/suite taken-berth colours by occupant gender (muted, so they still read
// as unavailable and stay distinct from the "Selected" tint).
const TAKEN_MALE = "#8FA9CE";
const TAKEN_FEMALE = "#D79BAA";

interface SeatAssignModalProps {
  visible: boolean;
  seatMap: SeatMap | null;
  /** Accommodation class display name (e.g. "Economy"). */
  className: string;
  /** Seat names already taken/held — not selectable. */
  unavailableSeats: string[];
  /** Taken cabin/suite berth -> occupant gender, for colour-coding. */
  seatGenders?: Record<string, "Male" | "Female">;
  /** Number of seats that must be chosen (one per seat-occupying passenger). */
  maxSeats: number;
  /** The current (auto) assignment, so the agent overrides rather than starts blank. */
  initialSelected?: string[];
  title?: string;
  onConfirm: (seats: string[]) => void;
  onClose: () => void;
}

const SeatAssignModal: React.FC<SeatAssignModalProps> = ({
  visible,
  seatMap,
  className,
  unavailableSeats,
  seatGenders = {},
  maxSeats,
  initialSelected = [],
  title,
  onConfirm,
  onClose,
}) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [selected, setSelected] = useState<string[]>([]);

  const classCode = NAME_TO_CODE[className] ?? className;
  const isRoomClass = classCode === "CAB" || classCode === "SUI";
  const takenSet = new Set(unavailableSeats);

  // Muted colour for a taken cabin/suite berth by occupant gender; else neutral.
  const takenColor = (name: string): string => {
    if (isRoomClass) {
      if (seatGenders[name] === "Male") return TAKEN_MALE;
      if (seatGenders[name] === "Female") return TAKEN_FEMALE;
    }
    return theme.greyText + "55";
  };

  const classSeatNames = new Set(
    (seatMap?.decks ?? [])
      .flatMap((d) => d.seats)
      .filter((s) => s.class_code === classCode)
      .map((s) => s.name)
  );

  // Re-seed the working selection from the auto-assignment each time it opens.
  useEffect(() => {
    if (visible) {
      setSelected(initialSelected.filter((n) => classSeatNames.has(n)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggleSeat = (seat: Seat) => {
    setSelected((prev) => {
      if (prev.includes(seat.name)) return prev.filter((s) => s !== seat.name);
      if (prev.length >= maxSeats) return prev; // at capacity
      return [...prev, seat.name];
    });
  };

  const renderDeck = (deck: { name: string; seats: Seat[] }, idx: number) => {
    const classSeats = deck.seats.filter((s) => s.class_code === classCode);
    if (classSeats.length === 0) return null;

    const maxX = Math.max(...classSeats.map((s) => s.x));
    const maxY = Math.max(...classSeats.map((s) => s.y));
    const minX = Math.min(...classSeats.map((s) => s.x));
    const minY = Math.min(...classSeats.map((s) => s.y));

    const lookup: Record<string, Seat> = {};
    classSeats.forEach((s) => {
      lookup[`${s.x},${s.y}`] = s;
    });

    return (
      <View key={idx} style={styles.deck}>
        <Text style={[styles.deckName, { color: theme.text }]}>{deck.name}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {Array.from({ length: maxY - minY + 1 }, (_, rowIdx) => {
              const y = minY + rowIdx;
              return (
                <View key={y} style={styles.row}>
                  {Array.from({ length: maxX - minX + 1 }, (_, colIdx) => {
                    const x = minX + colIdx;
                    const seat = lookup[`${x},${y}`];
                    if (!seat) return <View key={x} style={styles.seatSpacer} />;

                    const isTaken = takenSet.has(seat.name);
                    const isSelected = selected.includes(seat.name);
                    return (
                      <Pressable
                        key={x}
                        disabled={isTaken}
                        onPress={() => toggleSeat(seat)}
                        style={[
                          styles.seat,
                          {
                            backgroundColor: theme.cardBackground,
                            borderColor: theme.greyText + "55",
                          },
                          isTaken && {
                            backgroundColor: takenColor(seat.name),
                            borderColor: takenColor(seat.name),
                          },
                          isSelected && {
                            backgroundColor: theme.tint,
                            borderColor: theme.tint,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.seatLabel,
                            { color: theme.fadedText },
                            isSelected && { color: "#fff", fontWeight: "700" },
                          ]}
                          numberOfLines={1}
                        >
                          {seat.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  };

  const remaining = maxSeats - selected.length;
  const canConfirm = selected.length === maxSeats;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          {/* Header */}
          <View
            style={[
              styles.header,
              { backgroundColor: theme.cardBackground, borderBottomColor: theme.greyText + "33" },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: theme.text }]}>
                {title ?? "Assign seats"}
              </Text>
              <Text style={[styles.headerSub, { color: theme.greyText }]}>
                {className} ·{" "}
                {remaining > 0
                  ? `Choose ${remaining} more seat${remaining > 1 ? "s" : ""}`
                  : "All seats selected"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <FontAwesome name="close" size={20} color={theme.text} />
            </Pressable>
          </View>

          {/* Legend */}
          <View style={[styles.legend, { backgroundColor: theme.cardBackground }]}>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: theme.cardBackground, borderColor: theme.greyText + "55", borderWidth: 1 },
                ]}
              />
              <Text style={[styles.legendLabel, { color: theme.greyText }]}>Available</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: theme.tint }]} />
              <Text style={[styles.legendLabel, { color: theme.greyText }]}>Selected</Text>
            </View>
            {isRoomClass ? (
              <>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: TAKEN_MALE }]} />
                  <Text style={[styles.legendLabel, { color: theme.greyText }]}>Taken (M)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: TAKEN_FEMALE }]} />
                  <Text style={[styles.legendLabel, { color: theme.greyText }]}>Taken (F)</Text>
                </View>
              </>
            ) : (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: theme.greyText + "55" }]} />
                <Text style={[styles.legendLabel, { color: theme.greyText }]}>Taken</Text>
              </View>
            )}
          </View>

          {/* Seat grid */}
          <ScrollView style={styles.grid} contentContainerStyle={{ paddingBottom: 12 }}>
            {seatMap?.decks?.length ? (
              seatMap.decks.map((deck, i) => renderDeck(deck, i))
            ) : (
              <Text style={[styles.emptyText, { color: theme.greyText }]}>
                No seat map available for this vessel.
              </Text>
            )}
          </ScrollView>

          {/* Footer */}
          <View
            style={[
              styles.footer,
              { backgroundColor: theme.cardBackground, borderTopColor: theme.greyText + "33" },
            ]}
          >
            <Text style={[styles.footerSeats, { color: theme.text }]} numberOfLines={1}>
              {selected.length > 0 ? selected.join(", ") : "No seats selected"}
            </Text>
            <Pressable
              style={[
                styles.confirmBtn,
                { backgroundColor: canConfirm ? theme.tint : theme.greyText },
              ]}
              disabled={!canConfirm}
              onPress={() => onConfirm(selected)}
            >
              <Text style={styles.confirmBtnText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default SeatAssignModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 720,
    maxHeight: "90%",
    borderRadius: 14,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 20, fontWeight: "800", fontFamily: "Lato" },
  headerSub: { fontSize: 14, fontFamily: "Lato", marginTop: 2 },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  legend: { flexDirection: "row", gap: 18, paddingHorizontal: 20, paddingVertical: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 4 },
  legendLabel: { fontSize: 13, fontFamily: "Lato" },

  grid: { paddingHorizontal: 20, paddingTop: 16 },
  deck: { marginBottom: 20 },
  deckName: { fontSize: 15, fontWeight: "700", fontFamily: "Lato", marginBottom: 10 },
  row: { flexDirection: "row", marginBottom: SEAT_GAP },
  seat: {
    width: SEAT_SIZE,
    height: SEAT_SIZE,
    borderRadius: 5,
    marginRight: SEAT_GAP,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  seatSpacer: { width: SEAT_SIZE, height: SEAT_SIZE, marginRight: SEAT_GAP },
  seatLabel: { fontSize: 9, fontFamily: "Lato" },

  emptyText: { fontStyle: "italic", textAlign: "center", paddingVertical: 40, fontFamily: "Lato" },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
  },
  footerSeats: { flex: 1, fontSize: 14, fontWeight: "600", fontFamily: "Lato" },
  confirmBtn: { paddingVertical: 12, paddingHorizontal: 28, borderRadius: 8 },
  confirmBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Lato" },
});
