import Colors from "@/constants/Colors";
import { Voyage } from "@/types/voyage";
import { apiFetch, API_BASE } from "@/utils/api";
import { Category, CATEGORY_TO_DB, peso } from "@/utils/passengerRules";
import { quickCashOptions } from "@/utils/payment";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import CustomCalendar from "./CustomCalendar";
import CustomSelectList from "./CustomSelectList";
import SeatAssignModal from "./SeatAssignModal";
import VoyageLegPicker from "./VoyageLegPicker";

// DB-canonical passenger_type (as stored on tickets) → UI category slug, the
// inverse of CATEGORY_TO_DB — needed to price a ticket's existing passenger
// against a newly-picked voyage's per-category fares.
const DB_TO_CATEGORY: Record<string, Category> = Object.fromEntries(
  Object.entries(CATEGORY_TO_DB).map(([k, v]) => [v, k])
) as Record<string, Category>;

export interface RebookableTicket {
  id: number;
  price: number;
  passenger_type: string; // DB value, e.g. "Adult"
  accommodation_class: string;
  origin: string;
  destination: string;
}

interface RebookModalProps {
  visible: boolean;
  ticket: RebookableTicket | null;
  onClose: () => void;
  onSuccess: () => void;
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const RebookModal = ({ visible, ticket, onClose, onSuccess }: RebookModalProps) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [origins, setOrigins] = useState<string[]>([]);
  const [destsByOrigin, setDestsByOrigin] = useState<Record<string, string[]>>({});
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState(todayISO());

  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [loadingVoyages, setLoadingVoyages] = useState(false);
  const [voyageId, setVoyageId] = useState<number | null>(null);
  const [selectedClass, setSelectedClass] = useState("");
  const [seat, setSeat] = useState<string | null>(null);
  const [seatModalVisible, setSeatModalVisible] = useState(false);

  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the ticket's current route each time the modal opens.
  useEffect(() => {
    if (visible && ticket) {
      setOrigin(ticket.origin);
      setDestination(ticket.destination);
      setDate(todayISO());
      setVoyageId(null);
      setSelectedClass("");
      setSeat(null);
      setMethod("cash");
      setTendered("");
      setError(null);
    }
  }, [visible, ticket]);

  useEffect(() => {
    if (!visible) return;
    fetch(`${API_BASE}/api/v1/routes`)
      .then((r) => r.json())
      .then((rows: { origin: string; destination: string }[]) => {
        const oset = new Set<string>();
        const map: Record<string, string[]> = {};
        rows.forEach((r) => {
          oset.add(r.origin);
          (map[r.origin] ??= []).push(r.destination);
        });
        setOrigins([...oset]);
        setDestsByOrigin(map);
      })
      .catch(console.error);
  }, [visible]);

  useEffect(() => {
    if (!origin || !destination || !date) {
      setVoyages([]);
      return;
    }
    setLoadingVoyages(true);
    fetch(
      `${API_BASE}/api/v1/voyages/available_seats/${encodeURIComponent(origin)}/${encodeURIComponent(destination)}/${date}`
    )
      .then((r) => r.json())
      .then((data: Record<string, Voyage>) => setVoyages(Object.values(data)))
      .catch(console.error)
      .finally(() => setLoadingVoyages(false));
    setVoyageId(null);
    setSelectedClass("");
    setSeat(null);
  }, [origin, destination, date]);

  const voyage = voyages.find((v) => v.voyage_id === voyageId);

  const newFare = useMemo(() => {
    if (!voyage || !selectedClass || !ticket) return null;
    const cls = voyage.class_name?.[selectedClass];
    if (!cls) return null;
    const category = DB_TO_CATEGORY[ticket.passenger_type];
    const t = cls.ticket_type.find((x) => x.type === category);
    return t ? t.price : null;
  }, [voyage, selectedClass, ticket]);

  const delta = newFare != null && ticket ? Math.round((newFare - ticket.price) * 100) / 100 : null;
  const owesMore = (delta ?? 0) > 0.01;

  const tenderedNum = parseFloat(tendered) || 0;
  const change = method === "cash" && owesMore ? tenderedNum - (delta ?? 0) : null;
  const quickTenders = owesMore ? quickCashOptions(delta ?? 0) : [];

  const paymentOk = !owesMore || (method === "cash" ? tenderedNum >= (delta ?? 0) : method === "card");

  const canConfirm = !!ticket && !!voyageId && !!selectedClass && !!seat && paymentOk && !submitting;

  const handleConfirm = async () => {
    if (!ticket || !canConfirm || !voyage) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/office/tickets/${ticket.id}/rebook`, {
        method: "POST",
        body: JSON.stringify({
          new_trip: {
            schedule_id: voyageId,
            date: `${date}T${voyage.departure_time || "00:00:00"}`,
            accommodation_class: selectedClass,
            seat_number: seat,
          },
          payment: owesMore ? { method, tendered: method === "cash" ? tenderedNum : undefined } : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.detail || "Rebooking failed. Please try again.");
        return;
      }
      onSuccess();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ticket) return null;

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={[styles.header, { borderBottomColor: theme.greyText + "33" }]}>
            <Text style={[styles.title, { color: theme.text }]}>Rebook ticket</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <FontAwesome name="close" size={20} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text style={[styles.subtitle, { color: theme.greyText }]}>
              Currently {ticket.accommodation_class} · {ticket.origin} → {ticket.destination} · {peso(ticket.price)}
            </Text>

            <View style={styles.row2}>
              <View style={{ flex: 1, zIndex: 20 }}>
                <CustomSelectList
                  label="Origin"
                  data={origins.map((o, i) => ({ key: String(i), value: o }))}
                  placeholder={origin || "Select origin"}
                  onSelect={setOrigin}
                />
              </View>
              <View style={{ flex: 1, zIndex: 20 }}>
                <CustomSelectList
                  key={`dest-${origin}`}
                  label="Destination"
                  data={(destsByOrigin[origin] || []).map((d, i) => ({ key: String(i), value: d }))}
                  placeholder={destination || "Select destination"}
                  onSelect={setDestination}
                />
              </View>
            </View>

            <CustomCalendar label="New departure date" defaultDate={date} onDateSelect={setDate} />

            <VoyageLegPicker
              theme={theme}
              label="Voyage"
              loading={loadingVoyages}
              voyages={voyages}
              selectedId={voyageId}
              onSelectVoyage={(id) => {
                setVoyageId(id);
                setSelectedClass("");
                setSeat(null);
              }}
              selectedClass={selectedClass}
              onSelectClass={(c) => {
                setSelectedClass(c);
                setSeat(null);
              }}
              seatPax={1}
              seats={seat ? [seat] : []}
              onEditSeats={() => setSeatModalVisible(true)}
            />

            {newFare != null && delta != null && (
              <View style={[styles.fareBox, { borderColor: theme.border }]}>
                <Text style={{ color: theme.greyText, fontSize: 12 }}>
                  New fare {peso(newFare)} vs. current {peso(ticket.price)}
                </Text>
                <Text style={{ color: owesMore ? "#e5484d" : "#2e9e5b", fontSize: 15, fontWeight: "800" }}>
                  {owesMore ? `Additional payment due: ${peso(delta)}` : "No additional payment due"}
                </Text>
              </View>
            )}

            {owesMore && (
              <View style={{ gap: 8 }}>
                <View style={styles.pillRow}>
                  {(["cash", "card"] as const).map((m) => {
                    const active = method === m;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => setMethod(m)}
                        style={[
                          styles.pill,
                          { backgroundColor: active ? theme.tint : "transparent", borderColor: active ? theme.tint : theme.border },
                        ]}
                      >
                        <Text style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
                          {m.toUpperCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {method === "cash" && (
                  <View style={{ gap: 8 }}>
                    {quickTenders.length > 0 && (
                      <View style={styles.quickCashRow}>
                        {quickTenders.map((amt) => {
                          const on = tenderedNum === amt;
                          return (
                            <Pressable
                              key={amt}
                              onPress={() => setTendered(String(amt))}
                              style={[styles.quickCashBtn, { backgroundColor: on ? theme.tint : "transparent", borderColor: on ? theme.tint : theme.border }]}
                            >
                              <Text style={{ color: on ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
                                ₱{amt.toLocaleString("en-PH")}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <TextInput
                        style={[inputStyle, { flex: 1 }]}
                        value={tendered}
                        onChangeText={setTendered}
                        placeholder="Tendered"
                        keyboardType="numeric"
                        placeholderTextColor={theme.greyText}
                      />
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: theme.greyText, fontSize: 10 }}>CHANGE</Text>
                        <Text style={{ fontSize: 17, fontWeight: "800", color: (change ?? 0) < 0 ? "#e5484d" : "#2e9e5b" }}>
                          {peso(change ?? 0)}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.greyText + "33" }]}>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm}
              style={[styles.confirmBtn, { backgroundColor: canConfirm ? theme.tint : theme.greyText }]}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Confirm Rebook</Text>}
            </Pressable>
          </View>
        </View>
      </View>

      <SeatAssignModal
        visible={seatModalVisible}
        seatMap={voyage?.seat_map ?? null}
        className={selectedClass}
        unavailableSeats={voyage?.unavailable_seats || []}
        seatGenders={voyage?.seat_genders}
        maxSeats={1}
        initialSelected={seat ? [seat] : []}
        title="Choose the new seat"
        onConfirm={(seats) => {
          setSeat(seats[0] ?? null);
          setSeatModalVisible(false);
        }}
        onClose={() => setSeatModalVisible(false)}
      />
    </Modal>
  );
};

export default RebookModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "90%", borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: "800", fontFamily: "Lato" },
  body: { padding: 18, gap: 14 },
  subtitle: { fontSize: 13, fontFamily: "Lato" },
  row2: { flexDirection: "row", gap: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Lato",
  },
  fareBox: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  pillRow: { flexDirection: "row", gap: 8 },
  pill: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, alignItems: "center" },
  quickCashRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quickCashBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  errorText: { color: "#e5484d", fontSize: 13 },
  footer: { padding: 16, borderTopWidth: 1 },
  confirmBtn: { paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  confirmText: { color: "#fff", fontSize: 15, fontWeight: "800", fontFamily: "Lato" },
});
