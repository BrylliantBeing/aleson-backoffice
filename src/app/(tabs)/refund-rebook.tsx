import Background from "@/components/Background";
import CancelModal, { CancellableTicket } from "@/components/CancelModal";
import GroupRebookModal from "@/components/GroupRebookModal";
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
  /** Where the rebook date picker opens. Not a whitelist — any future sailing
   *  on the ticket's own route is allowed. */
  rebook_default_date: string;
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
  /** Whether this booking can be broken into two references. False for a
   *  website sale (its gateway order can only belong to one booking) and for a
   *  party of one (a split has to leave somebody behind). */
  splittable: boolean;
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

  // ── Working on several passengers at once ─────────────────────────────────
  // Off by default and entered deliberately: the per-ticket buttons are what
  // this screen is normally for, and a permanent checkbox column would make
  // every visit look like a bulk operation. Both multi-passenger actions share
  // one selection, so a cashier who ticks the wrong four does not have to
  // re-tick them after changing their mind about which action they wanted.
  const [selectMode, setSelectMode] = useState<null | "split" | "group">(null);
  const [splitPicked, setSplitPicked] = useState<number[]>([]);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitMsg, setSplitMsg] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [groupOpen, setGroupOpen] = useState(false);

  const selecting = selectMode !== null;

  const toggleSplitPick = (id: number) =>
    setSplitPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const leaveSplitMode = () => {
    setSelectMode(null);
    setSplitPicked([]);
  };

  const pickedTickets = tickets.filter((t) => splitPicked.includes(t.id));

  // A split has to leave someone behind — moving everybody is just the same
  // booking under a new number, and the server refuses it.
  const splitReady = splitPicked.length > 0 && splitPicked.length < tickets.length;

  // A group rebook moves passengers off ONE sailing onto another, so a
  // selection spanning an outbound and a return leg is not a thing that can be
  // done in one move. Said here rather than discovered at the server.
  const groupTrips = new Set(pickedTickets.map((t) => t.trip_fk));
  const groupAllBooked = pickedTickets.every((t) => t.status === "Booked");
  const groupReady =
    pickedTickets.length > 0 && groupTrips.size === 1 && groupAllBooked;
  const groupBlocker =
    pickedTickets.length === 0
      ? "Tick the passengers who are moving to another sailing."
      : !groupAllBooked
        ? "Some of these tickets are already refunded, voided or moved."
        : groupTrips.size > 1
          ? "These passengers are on different sailings — move one sailing at a time."
          : `${pickedTickets.length} moving together. Each still pays their own rebooking fee.`;

  const runSplit = async () => {
    if (!booking || !splitReady || splitBusy) return;
    setSplitBusy(true);
    setSplitMsg(null);
    try {
      const res = await apiFetch(
        `/api/v1/office/bookings/${encodeURIComponent(booking.booking_reference)}/split`,
        { method: "POST", body: JSON.stringify({ ticket_ids: splitPicked }) }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSplitMsg({ kind: "err", text: data?.detail || "Could not split this booking." });
        return;
      }
      // The new reference is the whole point of the operation and the counter
      // has to write it down or quote it, so it stays on screen rather than
      // flashing past — the refresh below reloads the half that remains.
      setSplitMsg({
        kind: "ok",
        text:
          `${splitPicked.length} passenger${splitPicked.length === 1 ? "" : "s"} moved to ` +
          `booking ${data.new_booking_reference} (${money(data.new_total_price, data.currency)}).`,
      });
      leaveSplitMode();
      runSearch(booking.booking_reference);
    } catch {
      setSplitMsg({ kind: "err", text: "Could not reach the server." });
    } finally {
      setSplitBusy(false);
    }
  };

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
    setGroupOpen(false);
    leaveSplitMode();
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

            {tickets.length > 1 && (
              <View style={[styles.splitBar, { borderColor: theme.border }]}>
                {!selecting ? (
                  <>
                    <Text style={{ color: theme.greyText, fontSize: 12.5, flex: 1, lineHeight: 17, minWidth: 200 }}>
                      Working on several passengers at once: move a group to another
                      sailing in one charge, or give part of the party a booking
                      reference of their own.
                    </Text>
                    <Pressable
                      onPress={() => {
                        setSelectMode("group");
                        setSplitMsg(null);
                      }}
                      style={[styles.actionBtn, { borderColor: theme.tint }]}
                    >
                      <Text style={{ color: theme.tint, fontSize: 12, fontWeight: "700" }}>
                        Rebook together
                      </Text>
                    </Pressable>
                    {/* Only a counter sale can be split — a website booking
                        settles against a gateway order that cannot belong to
                        two bookings. The server decides; this just follows. */}
                    {booking.splittable && (
                      <Pressable
                        onPress={() => {
                          setSelectMode("split");
                          setSplitMsg(null);
                        }}
                        style={[styles.actionBtn, { borderColor: theme.tint }]}
                      >
                        <Text style={{ color: theme.tint, fontSize: 12, fontWeight: "700" }}>
                          Split booking
                        </Text>
                      </Pressable>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={{ color: theme.text, fontSize: 12.5, flex: 1, lineHeight: 17, minWidth: 200 }}>
                      {selectMode === "split"
                        ? splitPicked.length === 0
                          ? "Tick the passengers who are moving to a new booking reference."
                          : splitPicked.length >= tickets.length
                            ? "A split has to leave someone behind — untick at least one passenger."
                            : `${splitPicked.length} of ${tickets.length} moving to a new reference. ` +
                              "Nothing is charged and nothing is refunded."
                        : groupBlocker}
                    </Text>
                    <Pressable
                      onPress={leaveSplitMode}
                      style={[styles.actionBtn, { borderColor: theme.border }]}
                    >
                      <Text style={{ color: theme.greyText, fontSize: 12, fontWeight: "700" }}>
                        Cancel
                      </Text>
                    </Pressable>
                    {selectMode === "split" ? (
                      <Pressable
                        onPress={runSplit}
                        disabled={!splitReady || splitBusy}
                        style={[
                          styles.actionBtn,
                          {
                            borderColor: splitReady ? theme.tint : theme.border,
                            opacity: splitReady && !splitBusy ? 1 : 0.5,
                          },
                        ]}
                      >
                        {splitBusy ? (
                          <ActivityIndicator color={theme.tint} />
                        ) : (
                          <Text
                            style={{
                              color: splitReady ? theme.tint : theme.greyText,
                              fontSize: 12,
                              fontWeight: "700",
                            }}
                          >
                            Move {splitPicked.length > 0 ? splitPicked.length : ""}
                          </Text>
                        )}
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => setGroupOpen(true)}
                        disabled={!groupReady}
                        style={[
                          styles.actionBtn,
                          {
                            borderColor: groupReady ? theme.tint : theme.border,
                            opacity: groupReady ? 1 : 0.5,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: groupReady ? theme.tint : theme.greyText,
                            fontSize: 12,
                            fontWeight: "700",
                          }}
                        >
                          Choose sailing
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            )}
            {splitMsg && (
              <Text
                style={{
                  color: splitMsg.kind === "ok" ? "#2e9e5b" : "#e5484d",
                  fontSize: 12.5,
                  lineHeight: 18,
                  marginTop: 10,
                }}
              >
                {splitMsg.text}
              </Text>
            )}

            <View style={{ gap: 10, marginTop: 14 }}>
              {tickets.map((t) => (
                <View key={t.id} style={[styles.ticketRow, { borderColor: theme.border }]}>
                  {/* Only while splitting: the per-ticket buttons are what this
                      screen is normally for, and a permanent checkbox column
                      would make every visit look like a bulk operation. */}
                  {selecting && (
                    <Pressable
                      onPress={() => toggleSplitPick(t.id)}
                      style={[
                        styles.splitBox,
                        {
                          borderColor: splitPicked.includes(t.id) ? theme.tint : theme.border,
                          backgroundColor: splitPicked.includes(t.id) ? theme.tint : "transparent",
                        },
                      ]}
                    >
                      {splitPicked.includes(t.id) && (
                        <FontAwesome name="check" size={11} color="#fff" />
                      )}
                    </Pressable>
                  )}
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
                              rebook_default_date: t.rebook_default_date ?? "",
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
      <GroupRebookModal
        visible={groupOpen}
        bookingReference={booking?.booking_reference ?? null}
        tickets={pickedTickets.map((t) => ({
          id: t.id,
          passenger_name: t.passenger_name,
          passenger_type: t.passenger_type,
          price: t.price,
          currency: t.currency,
          seat_number: t.seat_number,
          cancellation_fee: t.cancellation_fee,
        }))}
        origin={pickedTickets[0]?.origin ?? ""}
        destination={pickedTickets[0]?.destination ?? ""}
        defaultDate={pickedTickets[0]?.rebook_default_date ?? ""}
        onClose={() => setGroupOpen(false)}
        onSuccess={(message) => {
          setSplitMsg({ kind: "ok", text: message });
          refresh();
        }}
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
  splitBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  splitBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
});
