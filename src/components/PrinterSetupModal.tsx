/**
 * Printer setup for the counter's Epson TM-T82X.
 *
 * This screen used to be a calibration tool — an alignment grid, a field-position
 * table, copy offsets and fine nudges — because the old ticket was a pre-printed
 * form and values had to land inside its boxes. The thermal printer prints the
 * whole ticket onto blank roll, so none of that exists any more: pick the
 * printer, print a sample, done.
 *
 * Settings live on the machine (see utils/printer.ts), so a cashier who logs in
 * at another counter gets that counter's printer.
 */

import Colors from "@/constants/Colors";
import {
  AgentHealth,
  checkAgent,
  DEFAULT_SETTINGS,
  loadPrinterSettings,
  PrinterSettings,
  printTestTicket,
  PrintResult,
  savePrinterSettings,
} from "@/utils/printer";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Fires with the saved settings so the booking screen prints with them
   *  immediately, without re-reading storage. */
  onSaved: (settings: PrinterSettings) => void;
}

const PrinterSetupModal = ({ visible, onClose, onSaved }: Props) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_SETTINGS);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Re-read storage on open so a change made in another tab is picked up.
  useEffect(() => {
    if (!visible) return;
    setMessage(null);
    loadPrinterSettings().then((s) => {
      setSettings(s);
      probe(s.agentUrl);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const probe = async (url: string) => {
    setChecking(true);
    setHealth(await checkAgent(url));
    setChecking(false);
  };

  const patch = (p: Partial<PrinterSettings>) => setSettings((s) => ({ ...s, ...p }));

  const report = (result: PrintResult, okText: string) =>
    setMessage(
      result.ok
        ? { kind: "ok", text: okText }
        : { kind: "err", text: result.error ?? "Print failed." }
    );

  // The test runs against what is on screen, so a printer can be tried before
  // it is saved over a working one.
  const runTest = async () => {
    setBusy(true);
    setMessage(null);
    report(await printTestTicket(settings), "Sample ticket sent.");
    setBusy(false);
  };

  const save = async () => {
    await savePrinterSettings(settings);
    onSaved(settings);
    setMessage({ kind: "ok", text: "Saved on this PC." });
  };

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
  ];
  const label = (t: string) => (
    <Text style={[styles.label, { color: theme.greyText }]}>{t}</Text>
  );

  const statusColor = health?.ok ? "#2e9e5b" : "#e5484d";
  const printers = health?.printers ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.cardBackground, borderColor: theme.border },
          ]}
        >
          <View style={styles.head}>
            <FontAwesome name="print" size={18} color={theme.tint} />
            <Text style={[styles.title, { color: theme.text }]}>Printer setup</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <FontAwesome name="close" size={16} color={theme.greyText} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
            {/* ── Connection ─────────────────────────────────────────────── */}
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  Print tickets on this PC
                </Text>
                <Text style={[styles.help, { color: theme.greyText }]}>
                  Tickets print automatically when a payment is confirmed.
                </Text>
              </View>
              <Switch
                value={settings.enabled}
                onValueChange={(v) => patch({ enabled: v })}
                trackColor={{ true: theme.tint }}
              />
            </View>

            {label("PRINT AGENT URL")}
            <View style={styles.inline}>
              <TextInput
                style={[...inputStyle, { flex: 1 }]}
                value={settings.agentUrl}
                onChangeText={(v) => patch({ agentUrl: v })}
                autoCapitalize="none"
                placeholder="http://127.0.0.1:9101"
                placeholderTextColor={theme.greyText}
              />
              <Pressable
                onPress={() => probe(settings.agentUrl)}
                style={[styles.btnSm, { borderColor: theme.border }]}
              >
                {checking ? (
                  <ActivityIndicator size="small" color={theme.tint} />
                ) : (
                  <Text style={{ color: theme.text, fontWeight: "700" }}>Test</Text>
                )}
              </Pressable>
            </View>

            {health && (
              <View style={styles.statusRow}>
                <View style={[styles.dot, { backgroundColor: statusColor }]} />
                <Text style={[styles.help, { color: theme.greyText, flex: 1 }]}>
                  {health.ok
                    ? `Agent ${health.version ?? ""} connected · ${printers.length} printer(s)`
                    : health.error}
                </Text>
              </View>
            )}

            {/* ── Printer ────────────────────────────────────────────────── */}
            {label("PRINTER")}
            <View style={styles.chips}>
              {printers.map((name) => {
                const active = settings.printerName === name;
                return (
                  <Pressable
                    key={name}
                    onPress={() => patch({ printerName: name })}
                    style={[
                      styles.chip,
                      { borderColor: active ? theme.tint : theme.border },
                    ]}
                  >
                    <Text
                      style={{
                        color: active ? theme.tint : theme.text,
                        fontSize: 12,
                        fontWeight: active ? "800" : "600",
                      }}
                    >
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
              {printers.length === 0 && (
                <Text style={[styles.help, { color: theme.greyText }]}>
                  No printers reported. Start the print agent, then press Test.
                </Text>
              )}
            </View>
            <Text style={[styles.help, { color: theme.greyText, marginTop: 6 }]}>
              Pick the queue whose driver passes raw data through. A queue on
              Epson&apos;s class driver accepts jobs and prints nothing.
            </Text>

            {/* ── Ticket ─────────────────────────────────────────────────── */}
            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 18 }]}>
              Ticket
            </Text>

            <View style={styles.grid3}>
              <View style={styles.cell}>
                {label("LOGO KEY (NV)")}
                <TextInput
                  style={inputStyle}
                  value={settings.logoKey}
                  onChangeText={(v) => patch({ logoKey: v.slice(0, 2) })}
                  autoCapitalize="characters"
                  placeholder="none"
                  placeholderTextColor={theme.greyText}
                  maxLength={2}
                />
              </View>
              <View style={styles.cell}>
                {label("QR SIZE (DOTS)")}
                <TextInput
                  style={inputStyle}
                  value={String(settings.qrModuleSize)}
                  onChangeText={(v) => {
                    const n = Number(v);
                    if (v.trim() !== "" && !Number.isNaN(n)) {
                      patch({ qrModuleSize: Math.max(1, Math.min(16, n)) });
                    }
                  }}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <Text style={[styles.help, { color: theme.greyText, marginTop: 6 }]}>
              The logo key is the two-character slot it was stored under in the
              printer&apos;s memory — leave blank if none was loaded. QR size 6 is
              about 25mm; raise it if tickets are hard to scan at the gate.
            </Text>

            {message && (
              <Text
                style={[
                  styles.message,
                  { color: message.kind === "ok" ? "#2e9e5b" : "#e5484d" },
                ]}
              >
                {message.text}
              </Text>
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Pressable
              onPress={runTest}
              disabled={busy}
              style={[styles.btn, styles.btnGhost, { borderColor: theme.border }]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <Text style={{ color: theme.text, fontWeight: "700" }}>Test print</Text>
              )}
            </Pressable>
            <Pressable onPress={save} style={[styles.btn, { backgroundColor: theme.tint }]}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default PrinterSetupModal;

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
    maxWidth: 560,
    maxHeight: "92%",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: "800", fontFamily: "Lato" },
  scroll: { flexGrow: 0 },
  scrollBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: "800", fontFamily: "Lato" },
  help: { fontSize: 11, lineHeight: 15 },
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: 10,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: "Lato",
    // On web a bare <input> keeps `min-width: auto`, so it refuses to shrink
    // below its ~20-character intrinsic width and starves whatever shares the
    // row with it. Views get min-width:0 from react-native-web; inputs ask.
    minWidth: 0,
  },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  grid3: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  cell: { flexGrow: 1 },
  message: { fontSize: 12, marginTop: 12, lineHeight: 16 },
  footer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
  },
  btn: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: "center" },
  btnGhost: { borderWidth: 1.5, backgroundColor: "transparent" },
  btnSm: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: "center",
  },
});
