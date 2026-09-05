import Background from "@/components/Background";
import CustomCalendar from "@/components/CustomCalendar";
import PrinterSetupModal from "@/components/PrinterSetupModal";
import WholeCard from "@/components/WholeCard";
import Colors from "@/constants/Colors";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/utils/api";
import { money } from "@/utils/currency";
import {
  DEFAULT_SETTINGS,
  loadPrinterSettings,
  PrinterSettings,
  printTickets,
} from "@/utils/printer";
import { seatNumberLabel } from "@/utils/seatLabel";
import { buildReprintTickets, ReprintBooking } from "@/utils/ticketLayout";
import { FontAwesome } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Past transactions — every sale this counter has taken, newest first.
 *
 * Answers the two questions a cashier actually has after the customer has
 * walked away: "what did I sell today?" (the per-currency totals, which the
 * Till tab reconciles against) and "what was that booking's reference?" (the
 * search, which accepts a reference, a printed ticket number or a passenger
 * name). Acting on a sale — refund or rebook — hands off to that tab rather
 * than duplicating it here.
 */

interface TxnTicket {
  id: number;
  ticket_number: string | null;
  passenger_name: string;
  passenger_type: string;
  seat_number: string;
  status: string;
  price: number;
  /** Ticket's own currency — a refund is paid back in it, never converted. */
  currency: string;
  refund_amount: number | null;
  accommodation_class: string;
  scheduled_departure: string | null;
  origin: string;
  destination: string;
}

interface Transaction {
  id: number;
  booking_reference: string;
  purchased_at: string | null;
  total_price: number;
  currency: string;
  payment_status: string;
  payment_method: string | null;
  order_id: string | null;
  agent_id: number | null;
  agent_name: string;
  passenger_count: number;
  refunded_amount: number;
  refunded_count: number;
  /** First leg of the sale; `tickets` carries the rest. */
  origin: string | null;
  destination: string | null;
  scheduled_departure: string | null;
  tickets: TxnTicket[];
}

/** Takings for one currency over the whole filtered range, never summed with
 *  another currency's — PHP and MYR do not convert. */
interface CurrencyTotal {
  currency: string;
  bookings: number;
  gross: number;
  refunded: number;
  net: number;
  by_method: Record<string, number>;
}

const PAGE_SIZE = 25;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

const RANGES = [
  { key: "today", label: "Today", start: () => iso(new Date()) },
  { key: "7d", label: "Last 7 days", start: () => daysAgo(6) },
  { key: "30d", label: "Last 30 days", start: () => daysAgo(29) },
] as const;

const STATUSES = [
  { key: "settled", label: "Settled" },
  { key: "paid", label: "Paid" },
  { key: "refunded", label: "Refunded" },
  { key: "all", label: "All" },
] as const;

const METHODS = [
  { key: "", label: "Any method" },
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "qr", label: "QR" },
] as const;

const STATUS_COLOR: Record<string, string> = {
  Paid: "#2e9e5b",
  Refunded: "#e5484d",
  Pending: "#c08a00",
  Failed: "#5a6b7b",
  Booked: "#2e9e5b",
  Boarded: "#028cef",
  Cancelled: "#5a6b7b",
};

/** Ticket statuses that are still a valid boarding document, and so still
 *  reprintable. A refunded ticket — or one rebooked away, which is Cancelled —
 *  must not be handed back to a passenger; its replacement prints instead. */
const LIVE_TICKET = new Set(["Booked", "Boarded"]);

const METHOD_ICON: Record<string, keyof typeof FontAwesome.glyphMap> = {
  cash: "money",
  card: "credit-card",
  qr: "qrcode",
};

const formatWhen = (isoStr: string | null) => {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDeparture = (isoStr: string | null) => {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const Transactions = () => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  const router = useRouter();
  const { agent } = useAuth();

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // submitted search term
  const [rangeKey, setRangeKey] = useState<string>("7d");
  const [start, setStart] = useState(daysAgo(6));
  const [end, setEnd] = useState(iso(new Date()));
  const [status, setStatus] = useState<string>("settled");
  const [method, setMethod] = useState<string>("");
  // Admins can widen to every counter; an agent only ever sees their own sales
  // (the server enforces this, the toggle is just hidden).
  const [allCounters, setAllCounters] = useState(false);

  const [items, setItems] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState<CurrencyTotal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  // The printer belongs to the counter, not to the cashier, so its settings
  // come from this machine's storage (see utils/printer.ts).
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(DEFAULT_SETTINGS);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [reprinting, setReprinting] = useState<number | null>(null);
  // Keyed by booking so the outcome stays on the row it belongs to.
  const [reprintMsg, setReprintMsg] =
    useState<{ id: number; ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadPrinterSettings().then(setPrinterSettings);
  }, []);

  /**
   * Print a past sale's tickets again — a jammed roll, a printer that was off
   * when the sale settled, a passenger who lost the paper.
   *
   * Nothing is re-issued: the server rebuilds the same document from Postgres
   * (same serials, same boarding tokens, same issuing counter and date as the
   * original sale) and audits the duplicate. This only formats and sends it.
   */
  const reprint = async (t: Transaction) => {
    if (!printerSettings.enabled) {
      setReprintMsg({
        id: t.id,
        ok: false,
        text: "Printing is switched off on this PC. Turn it on in Printer setup.",
      });
      return;
    }
    setReprintMsg(null);
    setReprinting(t.id);
    try {
      const res = await apiFetch(
        `/api/v1/office/bookings/${encodeURIComponent(t.booking_reference)}/reprint`,
        { method: "POST", body: JSON.stringify({}) }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Could not load this sale's tickets.");
      const tickets = buildReprintTickets(data as ReprintBooking);
      const result = await printTickets(
        tickets,
        printerSettings,
        `Aleson reprint ${t.booking_reference}`
      );
      setReprintMsg(
        result.ok
          ? {
              id: t.id,
              ok: true,
              text: `Reprinted ${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}.`,
            }
          : { id: t.id, ok: false, text: `Did not print: ${result.error}` }
      );
    } catch (e: any) {
      setReprintMsg({ id: t.id, ok: false, text: e?.message ?? "Could not reach the server." });
    } finally {
      setReprinting(null);
    }
  };

  // Only the newest request may write to state: changing a filter mid-flight
  // would otherwise let a slower earlier response overwrite the new results.
  const requestId = useRef(0);

  const load = useCallback(
    async (nextPage: number) => {
      const mine = ++requestId.current;
      if (nextPage === 1) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          start,
          end,
          status,
          scope: allCounters ? "all" : "mine",
          page: String(nextPage),
          page_size: String(PAGE_SIZE),
        });
        if (query.trim()) params.set("q", query.trim());
        if (method) params.set("method", method);
        const res = await apiFetch(`/api/v1/office/transactions?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (mine !== requestId.current) return;
        if (!res.ok) throw new Error(data?.detail || "Could not load transactions.");
        const rows: Transaction[] = Array.isArray(data.items) ? data.items : [];
        setItems((prev) => (nextPage === 1 ? rows : [...prev, ...rows]));
        setTotals(Array.isArray(data.totals) ? data.totals : []);
        setTotal(data.total ?? 0);
        setPage(nextPage);
      } catch (e: any) {
        if (mine !== requestId.current) return;
        setError(e?.message ?? "Could not reach the server.");
        if (nextPage === 1) {
          setItems([]);
          setTotals([]);
          setTotal(0);
        }
      } finally {
        if (mine === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [start, end, status, method, query, allCounters]
  );

  useEffect(() => {
    setExpanded(null);
    setReprintMsg(null);
    load(1);
  }, [load]);

  const applyRange = (key: string) => {
    const preset = RANGES.find((r) => r.key === key);
    if (!preset) return;
    setRangeKey(key);
    setStart(preset.start());
    setEnd(iso(new Date()));
  };

  const chip = (label: string, active: boolean, onPress: () => void, key?: string) => (
    <Pressable
      key={key ?? label}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.tint : "transparent",
          borderColor: active ? theme.tint : theme.border,
        },
      ]}
    >
      <Text style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Background>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ zIndex: 30 }}>
          <WholeCard header="Past Transactions" spacer={{ height: 16 }}>
            <Text style={{ color: theme.greyText, fontSize: 13, marginBottom: 10 }}>
              Sales taken at this counter, newest first. Search by booking reference,
              printed ticket number or passenger name.
            </Text>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={() => setQuery(search)}
                placeholder="Reference, ticket number or name"
                autoCapitalize="characters"
                placeholderTextColor={theme.greyText}
                style={[
                  styles.input,
                  { flex: 1, borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
                ]}
              />
              <Pressable
                onPress={() => setQuery(search)}
                style={[styles.searchBtn, { backgroundColor: theme.tint }]}
              >
                <FontAwesome name="search" size={16} color="#fff" />
              </Pressable>
              {query ? (
                <Pressable
                  onPress={() => {
                    setSearch("");
                    setQuery("");
                  }}
                  style={[styles.searchBtn, { borderWidth: 1, borderColor: theme.border }]}
                >
                  <FontAwesome name="times" size={16} color={theme.greyText} />
                </Pressable>
              ) : null}
            </View>

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {RANGES.map((r) => chip(r.label, rangeKey === r.key, () => applyRange(r.key), r.key))}
            </View>

            {/* CustomCalendar seeds its selection from defaultDate once, so the
                range chips above would leave it showing a stale date — keying
                it on the value remounts it whenever the range changes. */}
            <View style={{ flexDirection: "row", gap: 20, flexWrap: "wrap", marginTop: 12, zIndex: 20 }}>
              <View style={{ flex: 1, minWidth: 220, zIndex: 20 }}>
                <CustomCalendar
                  key={`from-${start}`}
                  label="From"
                  defaultDate={start}
                  maxDate={end}
                  onDateSelect={(d) => {
                    setRangeKey("custom");
                    setStart(d);
                  }}
                />
              </View>
              <View style={{ flex: 1, minWidth: 220, zIndex: 20 }}>
                <CustomCalendar
                  key={`to-${end}`}
                  label="To"
                  defaultDate={end}
                  onDateSelect={(d) => {
                    setRangeKey("custom");
                    setEnd(d);
                  }}
                />
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              {STATUSES.map((s) => chip(s.label, status === s.key, () => setStatus(s.key), s.key))}
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {METHODS.map((m) =>
                chip(m.label, method === m.key, () => setMethod(m.key), `m-${m.key}`)
              )}
              {agent?.role === "admin"
                ? chip("All counters", allCounters, () => setAllCounters((v) => !v), "scope")
                : null}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </WholeCard>
        </View>

        {totals.length > 0 && (
          <WholeCard header="Takings" spacer={{ height: 12 }}>
            <View style={styles.kpiRow}>
              {totals.map((t) => (
                <View
                  key={t.currency}
                  style={[styles.kpi, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}
                >
                  <Text style={[styles.kpiValue, { color: theme.text }]}>
                    {money(t.net, t.currency)}
                  </Text>
                  <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                    Net takings ({t.currency}) · {t.bookings}{" "}
                    {t.bookings === 1 ? "sale" : "sales"}
                  </Text>
                  <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                    Gross {money(t.gross, t.currency)}
                    {t.refunded > 0 ? ` · Refunded ${money(t.refunded, t.currency)}` : ""}
                  </Text>
                  {Object.keys(t.by_method ?? {}).length > 0 && (
                    <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                      {Object.entries(t.by_method)
                        .map(([m, amount]) => `${m.toUpperCase()} ${money(amount, t.currency)}`)
                        .join(" · ")}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </WholeCard>
        )}

        {loading ? (
          <ActivityIndicator size="large" color={theme.tint} style={{ marginTop: 30 }} />
        ) : items.length === 0 ? (
          <Text style={{ color: theme.greyText, textAlign: "center", marginTop: 24 }}>
            No transactions in this range.
          </Text>
        ) : (
          <WholeCard spacer={{ height: 4 }}>
            <View style={{ gap: 10 }}>
              {items.map((t) => {
                const open = expanded === t.id;
                const methodKey = (t.payment_method ?? "").toLowerCase();
                // A sale whose every ticket has been refunded or rebooked away
                // has no boarding document left to hand over.
                const canReprint = t.tickets.some((tk) => LIVE_TICKET.has(tk.status));
                const printing = reprinting === t.id;
                const msg = reprintMsg?.id === t.id ? reprintMsg : null;
                return (
                  <View key={t.id} style={[styles.row, { borderColor: theme.border }]}>
                    <Pressable
                      onPress={() => {
                        setExpanded(open ? null : t.id);
                        setReprintMsg(null);
                      }}
                      style={styles.rowHead}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: theme.text, fontSize: 15, fontWeight: "800" }}>
                          {t.booking_reference}
                        </Text>
                        <Text style={{ color: theme.greyText, fontSize: 12 }}>
                          {formatWhen(t.purchased_at)} · {t.passenger_count}{" "}
                          {t.passenger_count === 1 ? "passenger" : "passengers"}
                          {allCounters && t.agent_name ? ` · ${t.agent_name}` : ""}
                        </Text>
                        {t.origin && (
                          <Text style={{ color: theme.greyText, fontSize: 12 }} numberOfLines={1}>
                            {t.origin} → {t.destination} · {formatDeparture(t.scheduled_departure)}
                          </Text>
                        )}
                        {t.refunded_amount > 0 && (
                          <Text style={{ color: "#e5484d", fontSize: 11 }}>
                            Refunded {money(t.refunded_amount, t.currency)} on {t.refunded_count}{" "}
                            {t.refunded_count === 1 ? "ticket" : "tickets"}
                          </Text>
                        )}
                      </View>

                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        <Text style={{ color: theme.text, fontSize: 15, fontWeight: "800" }}>
                          {money(t.total_price, t.currency)}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          {METHOD_ICON[methodKey] && (
                            <FontAwesome
                              name={METHOD_ICON[methodKey]}
                              size={13}
                              color={theme.greyText}
                            />
                          )}
                          <View
                            style={[
                              styles.badge,
                              { borderColor: STATUS_COLOR[t.payment_status] ?? theme.greyText },
                            ]}
                          >
                            <Text
                              style={{
                                color: STATUS_COLOR[t.payment_status] ?? theme.greyText,
                                fontWeight: "700",
                                fontSize: 11,
                              }}
                            >
                              {t.payment_status}
                            </Text>
                          </View>
                          <FontAwesome
                            name={open ? "chevron-up" : "chevron-down"}
                            size={12}
                            color={theme.greyText}
                          />
                        </View>
                      </View>
                    </Pressable>

                    {open && (
                      <View style={{ gap: 8, marginTop: 10 }}>
                        {t.tickets.map((tk) => (
                          <View key={tk.id} style={[styles.ticket, { borderColor: theme.border }]}>
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>
                                {tk.passenger_name} · {tk.passenger_type}
                              </Text>
                              <Text style={{ color: theme.greyText, fontSize: 12 }}>
                                {tk.accommodation_class} · Seat {seatNumberLabel(tk.seat_number)} ·{" "}
                                {money(tk.price, tk.currency)}
                              </Text>
                              <Text style={{ color: theme.greyText, fontSize: 12 }}>
                                {tk.origin} → {tk.destination} ·{" "}
                                {formatDeparture(tk.scheduled_departure)}
                              </Text>
                              {tk.ticket_number && (
                                <Text style={{ color: theme.greyText, fontSize: 12 }}>
                                  Ticket # {tk.ticket_number}
                                </Text>
                              )}
                              {tk.refund_amount != null && (
                                <Text style={{ color: "#e5484d", fontSize: 11 }}>
                                  Refunded {money(tk.refund_amount, tk.currency)}
                                </Text>
                              )}
                            </View>
                            <View
                              style={[
                                styles.badge,
                                { borderColor: STATUS_COLOR[tk.status] ?? theme.greyText },
                              ]}
                            >
                              <Text
                                style={{
                                  color: STATUS_COLOR[tk.status] ?? theme.greyText,
                                  fontWeight: "700",
                                  fontSize: 11,
                                }}
                              >
                                {tk.status}
                              </Text>
                            </View>
                          </View>
                        ))}

                        <View style={styles.actionRow}>
                          {/* Refunding and rebooking live in one place — this
                              hands the reference over rather than repeating it. */}
                          <Pressable
                            onPress={() =>
                              router.push({
                                pathname: "/(tabs)/refund-rebook",
                                params: { ref: t.booking_reference },
                              } as any)
                            }
                            style={[styles.actionBtn, { borderColor: theme.tint }]}
                          >
                            <Text style={{ color: theme.tint, fontSize: 12, fontWeight: "700" }}>
                              Open in Refund &amp; Rebooking
                            </Text>
                          </Pressable>

                          {canReprint && (
                            <Pressable
                              onPress={() => reprint(t)}
                              disabled={printing}
                              style={[
                                styles.actionBtn,
                                styles.actionBtnIcon,
                                { borderColor: theme.tint, opacity: printing ? 0.6 : 1 },
                              ]}
                            >
                              {printing ? (
                                <ActivityIndicator size="small" color={theme.tint} />
                              ) : (
                                <FontAwesome name="print" size={12} color={theme.tint} />
                              )}
                              <Text style={{ color: theme.tint, fontSize: 12, fontWeight: "700" }}>
                                {printing ? "Printing…" : "Reprint tickets"}
                              </Text>
                            </Pressable>
                          )}

                          {/* Offered only when the printer is the thing in the
                              way, so the row stays about the sale otherwise. */}
                          {((canReprint && !printerSettings.enabled) || (msg && !msg.ok)) && (
                            <Pressable
                              onPress={() => setPrinterOpen(true)}
                              style={[styles.actionBtn, styles.actionBtnIcon, { borderColor: theme.border }]}
                            >
                              <FontAwesome name="cog" size={12} color={theme.greyText} />
                              <Text style={{ color: theme.greyText, fontSize: 12, fontWeight: "700" }}>
                                Printer setup
                              </Text>
                            </Pressable>
                          )}
                        </View>

                        {msg && (
                          <Text style={{ color: msg.ok ? "#2e9e5b" : "#e5484d", fontSize: 12 }}>
                            {msg.text}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {items.length < total && (
              <Pressable
                onPress={() => load(page + 1)}
                disabled={loadingMore}
                style={[styles.loadMore, { borderColor: theme.border }]}
              >
                {loadingMore ? (
                  <ActivityIndicator color={theme.tint} />
                ) : (
                  <Text style={{ color: theme.tint, fontWeight: "700", fontSize: 13 }}>
                    Load more ({items.length} of {total})
                  </Text>
                )}
              </Pressable>
            )}
          </WholeCard>
        )}

        <View style={{ height: 50 }} />
      </ScrollView>

      <PrinterSetupModal
        visible={printerOpen}
        onClose={() => setPrinterOpen(false)}
        onSaved={setPrinterSettings}
      />
    </Background>
  );
};

export default Transactions;

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
  chip: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  error: { color: "#e5484d", fontFamily: "Lato", fontSize: 13, marginTop: 12 },
  kpiRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  kpi: {
    flex: 1,
    minWidth: 220,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  kpiValue: { fontSize: 20, fontWeight: "800" },
  kpiLabel: { fontSize: 12 },
  row: { borderWidth: 1, borderRadius: 12, padding: 12 },
  rowHead: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "flex-start" },
  ticket: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  badge: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  actionBtn: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignSelf: "flex-start",
  },
  actionBtnIcon: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadMore: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
});
