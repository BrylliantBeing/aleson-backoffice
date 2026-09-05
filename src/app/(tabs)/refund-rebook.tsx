import Background from "@/components/Background";
import CancelModal, { CancellableTicket } from "@/components/CancelModal";
import RebookModal, { RebookableTicket } from "@/components/RebookModal";
import RefundModal, { RefundableTicket } from "@/components/RefundModal";
import WholeCard from "@/components/WholeCard";
import Colors from "@/constants/Colors";
import { apiFetch } from "@/utils/api";
import { money } from "@/utils/currency";
import { seatNumberLabel } from "@/utils/seatLabel";
import { FontAwesome } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
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

interface OfficeTicket {
  id: number;
  trip_fk: number;
  scheduled_departure: string | null;
  origin: string;
  destination: string;
  accommodation_class: string;
  passenger_name: string;
  passenger_type: string;
  seat_number: string;
  price: number;
  /** Currency the ticket was sold in — refunds pay back in the same one. */
  currency: string;
  status: string;
  qr_token: string;
  refunded_by_fk: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  refund_amount: number | null;
  /** 'succeeded' via AUB, 'manual' paid back by hand, or null for older refunds. */
  refund_status: string | null;
  refund_reference: string | null;
  rebooked_from_ticket_fk: number | null;
  rebooked_to_ticket_fk: number | null;
  ticket_number: string | null;
  eligible: boolean;
  refundable: boolean;
  /** Whether this ticket can still be voided as a counter error: only while the
   *  sailing is still to leave and nobody has boarded on it. Decided by the API
   *  so the counter never offers an action the API would refuse. */
  cancellable: boolean;
  cancelled_by_fk: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancellation_fee: number;
  /** Rate behind cancellation_fee, as a fraction — 0.10 before departure, 0.40 after. */
  fee_rate: number;
  /** Whether this ticket's own sailing has already gone. */
  trip_departed: boolean;
  max_refund: number;
  cancellation_deadline: string | null;
  rebook_dates: string[];
}

interface OfficeBooking {
  id: number;
  booking_reference: string;
  payment_status: string;
  total_price: number;
  currency: string;
  purchased_at: string | null;
  /** How the sale was paid: 'cash' | 'card' | 'qr' | 'gcash' | 'grabpay' | null. */
  payment_method: string | null;
  /** Whether AUB can return the money automatically — see RefundModal. */
  gateway_refundable: boolean;
}

interface CancellationPolicy {
  /** Charged on a refund or a rebooking alike, as a fraction of the fare. */
  fee_rate_before_departure: number;
  fee_rate_after_departure: number;
  /** Days after the sailing's departure that a refund can still be claimed. */
  window_days: number;
}

const formatDeparture = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
};

const STATUS_COLOR: Record<string, string> = {
  Booked: "#2e9e5b",
  Boarded: "#028cef",
  Cancelled: "#5a6b7b",
  Refunded: "#e5484d",
};

const RefundRebooking = () => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  const params = useLocalSearchParams<{ ref?: string }>();

  const [reference, setReference] = useState("");
  const [booking, setBooking] = useState<OfficeBooking | null>(null);
  const [tickets, setTickets] = useState<OfficeTicket[]>([]);
  const [policy, setPolicy] = useState<CancellationPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [refundTarget, setRefundTarget] = useState<RefundableTicket | null>(null);
  const [rebookTarget, setRebookTarget] = useState<RebookableTicket | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancellableTicket | null>(null);

  const runSearch = async (ref: string) => {
    const trimmed = ref.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await apiFetch(`/api/v1/office/bookings/lookup/${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        setBooking(null);
        setTickets([]);
        const data = await res.json().catch(() => ({}));
        setError(data?.detail || "Booking not found.");
        return;
      }
      const data = await res.json();
      setBooking(data.booking);
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
      setPolicy(data.cancellation_policy ?? null);
    } catch {
      setBooking(null);
      setTickets([]);
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  // A sale opened from the Transactions tab arrives with its reference, so the
  // cashier lands on the booking already looked up instead of retyping it.
  useEffect(() => {
    const incoming = typeof params.ref === "string" ? params.ref : null;
    if (!incoming) return;
    setReference(incoming);
    runSearch(incoming);
  }, [params.ref]);

  const refresh = () => {
    setRefundTarget(null);
    setRebookTarget(null);
    setCancelTarget(null);
    if (booking) runSearch(booking.booking_reference);
  };

  return (
    <Background>
      <ScrollView showsVerticalScrollIndicator={false}>
        <WholeCard header="Refund & Rebooking" spacer={{ height: 16 }}>
          <Text style={{ color: theme.greyText, fontSize: 13, marginBottom: 10 }}>
            Look up a booking by its reference, or by a single passenger's printed
            ticket number, to refund or rebook a ticket.
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextInput
              value={reference}
              onChangeText={setReference}
              onSubmitEditing={() => runSearch(reference)}
              placeholder="Booking reference or ticket number"
              autoCapitalize="characters"
              placeholderTextColor={theme.greyText}
              style={[
                styles.input,
                { flex: 1, borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
              ]}
            />
            <Pressable
              onPress={() => runSearch(reference)}
              disabled={loading || !reference.trim()}
              style={[styles.searchBtn, { backgroundColor: theme.tint }]}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <FontAwesome name="search" size={16} color="#fff" />}
            </Pressable>
          </View>
          {error ? <Text style={{ color: "#e5484d", fontSize: 13, marginTop: 10 }}>{error}</Text> : null}
        </WholeCard>

        {booking && (
          <WholeCard spacer={{ height: 12 }}>
            <View style={styles.bookingHeader}>
              <View>
                <Text style={[styles.bookingRef, { color: theme.text }]}>{booking.booking_reference}</Text>
                <Text style={{ color: theme.greyText, fontSize: 12 }}>
                  Total {money(booking.total_price, booking.currency)} · Purchased {formatDate(booking.purchased_at)}
                </Text>
                {policy && (
                  <Text style={{ color: theme.greyText, fontSize: 12, marginTop: 2 }}>
                    Refund or rebooking: {Math.round(policy.fee_rate_before_departure * 100)}% fee before
                    departure, {Math.round(policy.fee_rate_after_departure * 100)}% after · refundable up to{" "}
                    {policy.window_days} days after the sailing
                  </Text>
                )}
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { borderColor: STATUS_COLOR[booking.payment_status] ?? theme.greyText },
                ]}
              >
                <Text style={{ color: STATUS_COLOR[booking.payment_status] ?? theme.greyText, fontWeight: "700", fontSize: 12 }}>
                  {booking.payment_status}
                </Text>
              </View>
            </View>

            <View style={{ gap: 10, marginTop: 14 }}>
              {tickets.map((t) => (
                <View key={t.id} style={[styles.ticketRow, { borderColor: theme.border }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: theme.text, fontSize: 14, fontWeight: "700" }} numberOfLines={1}>
                      {t.passenger_name} · {t.passenger_type}
                    </Text>
                    <Text style={{ color: theme.greyText, fontSize: 12 }} numberOfLines={1}>
                      {t.origin} → {t.destination} · {formatDeparture(t.scheduled_departure)}
                    </Text>
                    <Text style={{ color: theme.greyText, fontSize: 12 }}>
                      {t.accommodation_class} · Seat {seatNumberLabel(t.seat_number)} · {money(t.price, t.currency)}
                    </Text>
                    {t.ticket_number && (
                      <Text style={{ color: theme.greyText, fontSize: 12 }}>
                        Ticket # {t.ticket_number}
                      </Text>
                    )}
                    {t.status === "Refunded" && (
                      <Text style={{ color: "#e5484d", fontSize: 11, marginTop: 2 }}>
                        Refunded {money(t.refund_amount ?? 0, t.currency)}
                        {t.refund_status === "manual" ? " by hand" : ""} — {t.refund_reason}
                      </Text>
                    )}
                    {t.eligible && !t.refundable && (
                      <Text style={{ color: theme.greyText, fontSize: 11, marginTop: 2 }}>
                        Cancellation window closed {formatDate(t.cancellation_deadline)} — this ticket is final
                      </Text>
                    )}
                    {t.eligible && t.refundable && (
                      <Text style={{ color: theme.greyText, fontSize: 11, marginTop: 2 }}>
                        {Math.round(t.fee_rate * 100)}% fee ({money(t.cancellation_fee, t.currency)}) —
                        {t.trip_departed ? " sailing has departed" : " sailing has not departed"}
                      </Text>
                    )}
                    {t.status === "Cancelled" && t.rebooked_to_ticket_fk && (
                      <Text style={{ color: theme.greyText, fontSize: 11, fontStyle: "italic", marginTop: 2 }}>
                        Rebooked → new ticket #{t.rebooked_to_ticket_fk}
                      </Text>
                    )}
                    {/* A ticket cancelled away by a rebooking already says so
                        above; this is the counter-error case, where the fare
                        went back in full. */}
                    {t.status === "Cancelled" && t.cancelled_at && (
                      <Text style={{ color: theme.greyText, fontSize: 11, marginTop: 2 }}>
                        Voided {formatDate(t.cancelled_at)} · {money(t.price, t.currency)} returned
                        in full — {t.cancel_reason}
                      </Text>
                    )}
                  </View>

                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <View style={[styles.statusBadge, { borderColor: STATUS_COLOR[t.status] ?? theme.greyText }]}>
                      <Text style={{ color: STATUS_COLOR[t.status] ?? theme.greyText, fontWeight: "700", fontSize: 11 }}>
                        {t.status}
                      </Text>
                    </View>
                    {t.eligible && (
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        {t.refundable && (
                          <Pressable
                            onPress={() =>
                              setRefundTarget({
                                payment_method: booking?.payment_method ?? null,
                                gateway_refundable: !!booking?.gateway_refundable,
                                id: t.id,
                                price: t.price,
                                currency: t.currency,
                                passenger_name: t.passenger_name,
                                max_refund: t.max_refund,
                                cancellation_fee: t.cancellation_fee,
                                fee_rate: t.fee_rate,
                                trip_departed: t.trip_departed,
                              })
                            }
                            style={[styles.actionBtn, { borderColor: "#e5484d" }]}
                          >
                            <Text style={{ color: "#e5484d", fontSize: 12, fontWeight: "700" }}>Refund</Text>
                          </Pressable>
                        )}
                        <Pressable
                          onPress={() =>
                            setRebookTarget({
                              id: t.id,
                              price: t.price,
                              currency: t.currency,
                              passenger_type: t.passenger_type,
                              accommodation_class: t.accommodation_class,
                              origin: t.origin,
                              destination: t.destination,
                              rebook_dates: t.rebook_dates ?? [],
                              cancellation_fee: t.cancellation_fee,
                              fee_rate: t.fee_rate,
                              trip_departed: t.trip_departed,
                            })
                          }
                          style={[styles.actionBtn, { borderColor: theme.tint }]}
                        >
                          <Text style={{ color: theme.tint, fontSize: 12, fontWeight: "700" }}>Rebook</Text>
                        </Pressable>
                        {/* Correcting a ticket this counter issued wrongly. Not
                            a refund: no fee is withheld, so it is a separate
                            action rather than an option inside Refund. */}
                        {t.cancellable && (
                          <Pressable
                            onPress={() =>
                              setCancelTarget({
                                id: t.id,
                                price: t.price,
                                currency: t.currency,
                                passenger_name: t.passenger_name,
                                seat_number: t.seat_number,
                                ticket_number: t.ticket_number,
                                origin: t.origin,
                                destination: t.destination,
                                payment_method: booking?.payment_method ?? null,
                                gateway_refundable: !!booking?.gateway_refundable,
                              })
                            }
                            style={[styles.actionBtn, { borderColor: theme.greyText }]}
                          >
                            <Text style={{ color: theme.greyText, fontSize: 12, fontWeight: "700" }}>
                              Void
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </WholeCard>
        )}

        {searched && !loading && !booking && !error ? (
          <Text style={{ color: theme.greyText, textAlign: "center", marginTop: 20 }}>
            No booking found for that reference.
          </Text>
        ) : null}
      </ScrollView>

      <RefundModal
        visible={!!refundTarget}
        ticket={refundTarget}
        onClose={() => setRefundTarget(null)}
        onSuccess={refresh}
      />
      <RebookModal
        visible={!!rebookTarget}
        ticket={rebookTarget}
        onClose={() => setRebookTarget(null)}
        onSuccess={refresh}
      />
      <CancelModal
        visible={!!cancelTarget}
        ticket={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onSuccess={refresh}
      />
    </Background>
  );
};

export default RefundRebooking;

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Lato",
    // On web a bare <input> keeps `min-width: auto`, so it refuses to shrink
    // below its ~20-character intrinsic width and starves whatever shares the
    // row with it. Views get min-width:0 from react-native-web; inputs ask.
    minWidth: 0,
  },
  searchBtn: {
    width: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  bookingHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  bookingRef: { fontSize: 18, fontWeight: "800", fontFamily: "Lato" },
  statusBadge: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  ticketRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  actionBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
});
