import Colors from "@/constants/Colors";
import { apiFetch } from "@/utils/api";
import { money } from "@/utils/currency";
import { seatNumberLabel } from "@/utils/seatLabel";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

/**
 * Voiding a ticket the counter issued in error.
 *
 * Deliberately not the Refund dialog with a different label. A refund is the
 * passenger changing their mind and costs them a cancellation fee; a void is
 * this counter correcting its own mistake, returns the whole fare, and is
 * reported in its own column. Presenting them as one action is how a cashier
 * ends up charging someone a fee for a mis-typed surname.
 */

export interface CancellableTicket {
  id: number;
  price: number;
  /** The fare is reversed in the currency it was sold in — nothing converts. */
  currency: string;
  passenger_name: string;
  seat_number: string;
  ticket_number: string | null;
  origin: string;
  destination: string;
  /** How the sale was paid: 'cash' | 'card' | 'qr' | 'gcash' | 'grabpay' | null. */
  payment_method: string | null;
  /** Whether AUB has a payment on record it can reverse automatically. */
  gateway_refundable: boolean;
}

/** What actually happens to the money, said before staff commit to the void. */
const settlementLabel = (ticket: CancellableTicket): string => {
  if ((ticket.payment_method ?? "").toLowerCase() === "cash") {
    return "Paid in cash — hand the full fare back from the till. Your drawer will be expected to hold that much less.";
  }
  if (!ticket.gateway_refundable) {
    return "No gateway payment on record — return the full fare by hand and record it here.";
  }
  return "The full fare is reversed to the account used to pay, via AUB, before the ticket is voided.";
};

interface CancelModalProps {
  visible: boolean;
  ticket: CancellableTicket | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CancelModal = ({ visible, ticket, onClose, onSuccess }: CancelModalProps) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setReason("");
      setError(null);
    }
  }, [visible]);

  // A void erases a sale and frees a seat, so it always carries a written
  // reason — the audit log and the cashier's own end-of-day both show it.
  const canConfirm = !!ticket && reason.trim().length > 0 && !submitting;

  const handleConfirm = async () => {
    if (!ticket || !canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/office/tickets/${ticket.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data?.detail;
        setError(
          (typeof detail === "object" ? detail?.message : detail) ||
            "The ticket could not be voided. Please try again."
        );
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.cardBackground, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.title, { color: theme.text }]}>Void ticket</Text>
          <Text style={[styles.subtitle, { color: theme.greyText }]}>
            {ticket.passenger_name} · {ticket.origin} → {ticket.destination}
          </Text>

          <View style={[styles.breakdown, { borderColor: theme.border }]}>
            {ticket.ticket_number ? (
              <View style={styles.breakdownRow}>
                <Text style={{ color: theme.greyText, fontSize: 13 }}>Ticket no.</Text>
                <Text style={{ color: theme.text, fontSize: 13 }}>{ticket.ticket_number}</Text>
              </View>
            ) : null}
            <View style={styles.breakdownRow}>
              <Text style={{ color: theme.greyText, fontSize: 13 }}>Seat</Text>
              <Text style={{ color: theme.text, fontSize: 13 }}>
                {seatNumberLabel(ticket.seat_number)}
              </Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={{ color: theme.greyText, fontSize: 13 }}>Fare paid</Text>
              <Text style={{ color: theme.text, fontSize: 13 }}>
                {money(ticket.price, ticket.currency)}
              </Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={{ color: theme.greyText, fontSize: 13 }}>Cancellation fee</Text>
              <Text style={{ color: "#2e9e5b", fontSize: 13, fontWeight: "700" }}>None</Text>
            </View>
            <View
              style={[
                styles.breakdownRow,
                { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 6 },
              ]}
            >
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>
                Returned in full
              </Text>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>
                {money(ticket.price, ticket.currency)}
              </Text>
            </View>
          </View>

          <View
            style={[styles.payout, { borderColor: theme.border, backgroundColor: theme.control }]}
          >
            <Text style={{ color: theme.text, fontSize: 12.5, lineHeight: 18 }}>
              {settlementLabel(ticket)}
            </Text>
          </View>

          <View style={[styles.payout, { borderColor: "#e5a00d", backgroundColor: "#fff8e6" }]}>
            <Text style={{ color: "#0D1B2A", fontSize: 12.5, lineHeight: 18 }}>
              Voiding releases the seat back on sale and cannot be undone. The ticket
              number is used up and stays on the cancellations report — issue a new
              ticket for the corrected sale.
            </Text>
          </View>

          <Text style={[styles.label, { color: theme.greyText }]}>REASON</Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
              { height: 72, textAlignVertical: "top" },
            ]}
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="e.g. wrong sailing selected, name mis-keyed, duplicate issued"
            placeholderTextColor={theme.greyText}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              style={[styles.btn, styles.btnGhost, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text, fontWeight: "700" }}>Keep ticket</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm}
              style={[styles.btn, { backgroundColor: canConfirm ? "#e5484d" : theme.greyText }]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "800" }}>
                  Void and return {money(ticket.price, ticket.currency)}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default CancelModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: { width: "100%", maxWidth: 420, borderRadius: 16, borderWidth: 1, padding: 20, gap: 4 },
  title: { fontSize: 18, fontWeight: "800", fontFamily: "Lato" },
  subtitle: { fontSize: 13, fontFamily: "Lato", marginBottom: 10 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Lato",
    // On web a bare <input> keeps `min-width: auto`, so it refuses to shrink
    // below its ~20-character intrinsic width and starves whatever shares the
    // row with it. Views get min-width:0 from react-native-web; inputs ask.
    minWidth: 0,
  },
  errorText: { color: "#e5484d", fontSize: 12, marginTop: 6 },
  breakdown: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14, gap: 6 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  payout: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 14 },
  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  btnGhost: { borderWidth: 1.5, backgroundColor: "transparent" },
});
