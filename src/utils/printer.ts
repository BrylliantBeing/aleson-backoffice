/**
 * Client for the counter's local print agent, plus the per-machine printer
 * settings it needs.
 *
 * The back office is served over HTTPS from the cluster, but the TM-T82X hangs
 * off the counter PC by USB, and a browser cannot open a printer. So a small
 * agent runs on that PC (see print-agent/) and this module POSTs raw ESC/POS to
 * it on localhost. Browsers treat http://localhost as a trustworthy origin, so
 * this is not blocked as mixed content from an HTTPS page.
 *
 * Settings are per-machine because the Windows printer name belongs to the
 * counter, not to the cashier. They used to also carry a whole ticket layout —
 * rows, columns, copies, offsets — which the thermal printer makes unnecessary:
 * nothing is overprinted into pre-printed boxes, so there is nothing to align.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { ZReport } from "@/types/reports";
import { bytesToBase64 } from "@/utils/escpos";
import { renderZReport } from "@/utils/reportDoc";
import { TicketData } from "@/utils/ticketLayout";
import { TicketDocOptions, renderTickets, sampleTicket } from "@/utils/ticketDoc";

const SETTINGS_KEY = "aleson.office.printer";

export const DEFAULT_AGENT_URL = "http://127.0.0.1:9101";

export interface PrinterSettings {
  /** Off by default so a counter without an agent installed is never blocked
   *  by failed print attempts — it is switched on during setup. */
  enabled: boolean;
  agentUrl: string;
  /** Windows printer name. Empty = the agent's default printer. */
  printerName: string;
  /** Two-character NV key of the logo loaded into this printer, if any. */
  logoKey: string;
  /** QR module size in dots; raise it if tickets come back hard to scan. */
  qrModuleSize: number;
}

export const DEFAULT_SETTINGS: PrinterSettings = {
  enabled: false,
  agentUrl: DEFAULT_AGENT_URL,
  printerName: "",
  logoKey: "",
  qrModuleSize: 6,
};

const hydrate = (raw: unknown): PrinterSettings => ({
  ...DEFAULT_SETTINGS,
  ...((raw ?? {}) as Partial<PrinterSettings>),
});

export async function loadPrinterSettings(): Promise<PrinterSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return hydrate(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — the session keeps working on in-memory settings */
  }
}

/** Turn the stored settings into the render options the ticket doc expects. */
const docOptions = (settings: PrinterSettings): TicketDocOptions => ({
  logoKeyCodes:
    settings.logoKey.length >= 2
      ? [settings.logoKey[0], settings.logoKey[1]]
      : null,
  qrModuleSize: settings.qrModuleSize,
});

// ── Agent transport ─────────────────────────────────────────────────────────

export interface AgentHealth {
  ok: boolean;
  version?: string;
  defaultPrinter?: string;
  printers?: string[];
  error?: string;
}

const AGENT_TIMEOUT_MS = 6000;

async function agentFetch(url: string, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    return await fetch(`${url.replace(/\/+$/, "")}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Probe the agent — backs the status pill on the printer setup screen. */
export async function checkAgent(agentUrl: string): Promise<AgentHealth> {
  try {
    const res = await agentFetch(agentUrl, "/healthz");
    if (!res.ok) return { ok: false, error: `Agent returned HTTP ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      version: data.version,
      defaultPrinter: data.default_printer ?? undefined,
      printers: Array.isArray(data.printers) ? data.printers : [],
    };
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.name === "AbortError"
          ? "Print agent did not respond."
          : "Print agent unreachable. Is it running on this PC?",
    };
  }
}

export interface PrintResult {
  ok: boolean;
  error?: string;
}

async function sendToAgent(
  settings: PrinterSettings,
  bytes: Uint8Array,
  jobName: string
): Promise<PrintResult> {
  if (bytes.length === 0) return { ok: false, error: "Nothing to print." };
  try {
    const res = await agentFetch(settings.agentUrl, "/print", {
      method: "POST",
      body: JSON.stringify({
        printer: settings.printerName || null,
        job_name: jobName,
        data_base64: bytesToBase64(bytes),
      }),
    });
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      return { ok: false, error: body?.detail || `Print agent returned HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.name === "AbortError"
          ? "Print agent did not respond."
          : "Could not reach the print agent on this PC.",
    };
  }
}

/**
 * Print one ticket per passenger, in the order the serials were issued, as a
 * single spooler job — so a multi-passenger sale cannot be interleaved with
 * another counter's job on a shared printer.
 */
export async function printTickets(
  tickets: TicketData[],
  settings: PrinterSettings,
  jobName = "Aleson passage ticket"
): Promise<PrintResult> {
  return sendToAgent(settings, renderTickets(tickets, docOptions(settings)), jobName);
}

/**
 * Print the cashier's end-of-day report on the till roll.
 *
 * Goes to the same printer as the tickets, because that is where a Z-report
 * belongs — it is counted against the drawer at the counter and filed with the
 * cash, not circulated. The passenger manifest is the opposite case and prints
 * A4 through the browser (see manifestDoc.ts).
 */
export async function printZReport(
  report: ZReport,
  settings: PrinterSettings
): Promise<PrintResult> {
  return sendToAgent(
    settings,
    renderZReport(report),
    `Aleson end of day shift ${report.shift.id}`
  );
}

/** One sample ticket, for checking the printer and the loaded logo. */
export async function printTestTicket(settings: PrinterSettings): Promise<PrintResult> {
  return sendToAgent(
    settings,
    renderTickets([sampleTicket()], docOptions(settings)),
    "Aleson printer test"
  );
}
