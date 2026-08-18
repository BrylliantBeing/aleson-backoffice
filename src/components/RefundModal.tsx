import Colors from "@/constants/Colors";
import { apiFetch } from "@/utils/api";
import { money } from "@/utils/currency";
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

export interface RefundableTicket {
  id: number;
  price: number;
  /** The refund is paid back in the currency the ticket was sold in. */
  currency: string;
  passenger_name: string;
  /** Fare less the cancellation fee — the most this ticket can be refunded for. */
  max_refund: number;
  cancellation_fee: number;
  /** How the booking was paid: 'cash' | 'card' | 'qr' | 'gcash' | 'grabpay' | null. */
  payment_method: string | null;
  /**
   * Whether AUB can return this money automatically. False for cash sales and
   * for bookings taken before the gateway cutover, which have no payment on
   * record to refund against — those are paid back by hand.
   */
  gateway_refundable: boolean;
}

// How the money actually goes back, shown before staff commit to the refund.
const payoutLabel = (ticket: RefundableTicket): string => {
  if (!ticket.gateway_refundable) {
    return (ticket.payment_method ?? "").toLowerCase() === "cash"
      ? "Paid in cash — hand the refund back from the till."
      : "No gateway payment on record — pay this back by hand and record it here.";
  }
  switch ((ticket.payment_method ?? "").toLowerCase()) {
    case "card":
      return "Returns to the card used to pay, via AUB.";
    case "gcash":
      return "Returns to the customer's GCash wallet, via AUB.";
    case "grabpay":
      return "Returns to the customer's GrabPay wallet, via AUB.";
    default:
      return "Returns to the account used to pay, via AUB.";
  }
};

interface RefundModalProps {
  visible: boolean;
  ticket: RefundableTicket | null;
  onClose: () => void;
  onSuccess: () => void;
}

const RefundModal = ({ visible, ticket, onClose, onSuccess }: RefundModalProps) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form from the ticket each time the modal opens. The refundable
  // amount — fare less the cancellation fee — is the default, not the fare.
  useEffect(() => {
    if (visible && ticket) {
      setAmount(ticket.max_refund.toFixed(2));
      setReason("");
      setError(null);
    }
  }, [visible, ticket]);

  const amountNum = parseFloat(amount) || 0;
  const validAmount = !!ticket && amountNum > 0 && amountNum <= ticket.max_refund;
  const canConfirm = !!ticket && validAmount && reason.trim().length > 0 && !submitting;

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
  ];

  const handleConfirm = async () => {
    if (!ticket || !canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/office/tickets/${ticket.id}/refund`, {
        method: "POST",
        body: JSON.stringify({
          amount: amountNum,
          reason: reason.trim(),
          // Records the refund without calling AUB. The backend rejects a
          // gateway refund it cannot perform rather than silently doing this.
          manual: !ticket.gateway_refundable,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data?.detail;
        setError(
          (typeof detail === "object" ? detail?.message : detail) ||
            "Refund failed. Please try again."
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
        <View style={[styles.sheet, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>Refund ticket</Text>
          <Text style={[styles.subtitle, { color: theme.greyText }]}>
            {ticket.passenger_name} · Paid {money(ticket.price, ticket.currency)}
          </Text>

          <View style={[styles.breakdown, { borderColor: theme.border }]}>
            <View style={styles.breakdownRow}>
              <Text style={{ color: theme.greyText, fontSize: 13 }}>Fare paid</Text>
              <Text style={{ color: theme.text, fontSize: 13 }}>{money(ticket.price, ticket.currency)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={{ color: theme.greyText, fontSize: 13 }}>Cancellation fee (20%)</Text>
              <Text style={{ color: "#e5484d", fontSize: 13 }}>−{money(ticket.cancellation_fee, ticket.currency)}</Text>
            </View>
            <View style={[styles.breakdownRow, { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 6 }]}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>Refundable</Text>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>{money(ticket.max_refund, ticket.currency)}</Text>
            </View>
          </View>

          <View
            style={[
              styles.payout,
              {
                borderColor: theme.border,
                backgroundColor: ticket.gateway_refundable ? theme.control : "#fff8e6",
              },
            ]}
          >
            <Text style={{ color: theme.text, fontSize: 12.5, lineHeight: 18 }}>
              {payoutLabel(ticket)}
            </Text>
          </View>

          <Text style={[styles.label, { color: theme.greyText }]}>REFUND AMOUNT</Text>
          <TextInput
            style={inputStyle}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor={theme.greyText}
          />
          {!validAmount && amount.length > 0 && (
            <Text style={styles.errorText}>Amount must be between 0 and {money(ticket.max_refund, ticket.currency)}.</Text>
          )}

          <Text style={[styles.label, { color: theme.greyText, marginTop: 12 }]}>REASON</Text>
          <TextInput
            style={[inputStyle, { height: 72, textAlignVertical: "top" }]}
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="Why is this ticket being refunded?"
            placeholderTextColor={theme.greyText}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={[styles.btn, styles.btnGhost, { borderColor: theme.border }]}>
              <Text style={{ color: theme.text, fontWeight: "700" }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm}
              style={[styles.btn, { backgroundColor: canConfirm ? "#e5484d" : theme.greyText }]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "800" }}>Refund {money(amountNum || 0, ticket.currency)}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default RefundModal;

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
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Lato",
  },
  errorText: { color: "#e5484d", fontSize: 12, marginTop: 6 },
  breakdown: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14, gap: 6 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  payout: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 14 },
  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  btnGhost: { borderWidth: 1.5, backgroundColor: "transparent" },
});
