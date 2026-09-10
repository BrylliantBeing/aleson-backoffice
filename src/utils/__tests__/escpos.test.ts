/**
 * The bytes that go down the wire to the counter's TM-T82X.
 *
 * Nothing here talks to a printer. These are byte builders, and asserting on
 * the bytes is the only way to catch the failures this module actually has:
 * a command that stops resetting the printer between jobs, a column count that
 * silently shifts every fare one character right, a QR length prefix that
 * makes the printer read the payload as commands.
 *
 * The whole ticket is printed on blank roll, so there is no alignment to
 * calibrate — but there IS a fixed line width, and pair()/wrap() are the only
 * things keeping a document inside it.
 */

import {
  EscposWriter,
  FONT_A_COLS,
  FONT_B_COLS,
  bytesToBase64,
  concatBytes,
  pair,
  rule,
  toPrintable,
  wrap,
} from "@/utils/escpos";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const bytes = (build: (w: EscposWriter) => unknown): number[] => {
  const w = new EscposWriter();
  build(w);
  return Array.from(w.toUint8Array());
};

// ── Folding text onto an 8-bit code page ────────────────────────────────────
// The printer runs PC437, not UTF-8. Anything outside printable ASCII comes
// out as a garbage glyph, so it is folded before it is ever queued.

describe("toPrintable", () => {
  it("prints the peso sign the way the operator's own tickets read", () => {
    expect(toPrintable("₱1,234.50")).toBe("P1,234.50");
  });

  it("keeps a route arrow readable instead of falling through to a question mark", () => {
    // Routes arrive from the API as "Zamboanga → Sandakan"; without the
    // mapping the roll reads "Zamboanga ? Sandakan".
    expect(toPrintable("Zamboanga → Sandakan")).toBe("Zamboanga -> Sandakan");
  });

  it("strips accents rather than replacing the whole letter", () => {
    // A name has to stay readable: "Peña" is useful, "Pe?a" is not.
    expect(toPrintable("Peña")).toBe("Pena");
    expect(toPrintable("José Ramón")).toBe("Jose Ramon");
  });

  it("folds the punctuation a word processor substitutes", () => {
    expect(toPrintable("“quoted” — it’s 25…")).toBe('"quoted" - it\'s 25...');
  });

  it("turns a tab into a space rather than dropping the gap", () => {
    expect(toPrintable("A\tB")).toBe("A B");
  });

  it("drops control characters that would be read as commands", () => {
    // A stray ESC inside a passenger name would reconfigure the printer
    // mid-ticket. Note only the control byte goes: the "@" that follows an
    // ESC in a real command is ordinary printable ASCII and stays.
    expect(toPrintable("A\x1bB\x00C")).toBe("ABC");
    expect(toPrintable("A\x1b@B")).toBe("A@B");
  });

  it("replaces anything still non-ASCII with a placeholder", () => {
    expect(toPrintable("符号")).toBe("??");
  });

  it("survives an empty or missing string", () => {
    expect(toPrintable("")).toBe("");
    expect(toPrintable(undefined as unknown as string)).toBe("");
  });
});

// ── Commands ────────────────────────────────────────────────────────────────

describe("EscposWriter commands", () => {
  it("resets the printer so a leftover job cannot bleed settings in", () => {
    expect(bytes((w) => w.init())).toEqual([ESC, 0x40]);
  });

  it("emits the three alignments", () => {
    expect(bytes((w) => w.align("left"))).toEqual([ESC, 0x61, 0]);
    expect(bytes((w) => w.align("center"))).toEqual([ESC, 0x61, 1]);
    expect(bytes((w) => w.align("right"))).toEqual([ESC, 0x61, 2]);
  });

  it("selects each font", () => {
    expect(bytes((w) => w.font("A"))).toEqual([ESC, 0x4d, 0]);
    expect(bytes((w) => w.font("B"))).toEqual([ESC, 0x4d, 1]);
  });

  it("packs the width and height multipliers into one byte", () => {
    expect(bytes((w) => w.size(1, 1))).toEqual([GS, 0x21, 0x00]);
    expect(bytes((w) => w.size(2, 3))).toEqual([GS, 0x21, 0x12]);
  });

  it("clamps a size the printer cannot honour", () => {
    // 1-8 each way; out of range would set reserved bits in the same byte.
    expect(bytes((w) => w.size(0, 0))).toEqual([GS, 0x21, 0x00]);
    expect(bytes((w) => w.size(99, 99))).toEqual([GS, 0x21, 0x77]);
  });

  it("toggles emphasis and underline", () => {
    expect(bytes((w) => w.bold(true))).toEqual([ESC, 0x45, 1]);
    expect(bytes((w) => w.bold(false))).toEqual([ESC, 0x45, 0]);
    expect(bytes((w) => w.underline(2))).toEqual([ESC, 0x2d, 2]);
    expect(bytes((w) => w.underline(0))).toEqual([ESC, 0x2d, 0]);
  });

  it("writes text as ASCII and ends a line with a feed", () => {
    expect(bytes((w) => w.line("Hi"))).toEqual([0x48, 0x69, LF]);
    expect(bytes((w) => w.line())).toEqual([LF]);
  });

  it("folds text through the transliterator on its way into the buffer", () => {
    // Every byte must be <= 0xff; an unfolded ₱ would be multi-byte UTF-8.
    const out = bytes((w) => w.text("₱100"));
    expect(out).toEqual([0x50, 0x31, 0x30, 0x30]);
    expect(out.every((b) => b <= 0xff)).toBe(true);
  });

  it("feeds and cuts within the range the command allows", () => {
    expect(bytes((w) => w.feed(3))).toEqual([ESC, 0x64, 3]);
    expect(bytes((w) => w.feed(999))).toEqual([ESC, 0x64, 255]);
    expect(bytes((w) => w.cut())).toEqual([GS, 0x56, 0x42, 0x50]);
    expect(bytes((w) => w.cut(999))).toEqual([GS, 0x56, 0x42, 255]);
  });

  it("asks for a stored logo by key code without sending a bitmap", () => {
    // The logo lives in the printer's NV flash. A printer that never had it
    // loaded prints nothing and still produces a usable ticket.
    expect(bytes((w) => w.nvGraphic("A", "L", 1, 1))).toEqual([
      GS, 0x28, 0x4c, 0x06, 0x00, 0x30, 0x45, 0x41, 0x4c, 1, 1,
    ]);
  });

  it("chains commands in the order they were written", () => {
    expect(bytes((w) => w.init().align("center").bold(true))).toEqual([
      ESC, 0x40, ESC, 0x61, 1, ESC, 0x45, 1,
    ]);
  });
});

// ── The QR the printer draws itself ─────────────────────────────────────────
// No bitmap crosses the wire, so there is no dpi or scaling to get wrong. The
// payload is the bare qr_token the boarding gate posts to the verification
// server.

describe("qr", () => {
  it("selects the model, sizes it, sets correction, stores and prints", () => {
    expect(bytes((w) => w.qr("AB", 6, "M"))).toEqual([
      GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,   // model 2
      GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 6,            // module size
      GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 49,           // error correction M
      GS, 0x28, 0x6b, 5, 0, 0x31, 0x50, 0x30, 0x41, 0x42,   // store "AB"
      GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,         // print
    ]);
  });

  it("counts the three header bytes in the stored length", () => {
    // Get this wrong and the printer reads part of the payload as commands.
    const token = "3f1c2b7a-9d4e-4c88-b0a1-77e2f5c6d900";   // a real token width
    const out = bytes((w) => w.qr(token));
    const marker = out.indexOf(0x50, out.indexOf(0x45));     // the store command
    expect(out[marker - 3]).toBe((token.length + 3) & 0xff);
    expect(out[marker - 2]).toBe(((token.length + 3) >> 8) & 0xff);
  });

  it("encodes a long payload length across both length bytes", () => {
    const long = "x".repeat(300);
    const out = bytes((w) => w.qr(long));
    expect(out).toContain(((300 + 3) >> 8) & 0xff);
  });

  it("maps each error-correction level to its byte", () => {
    const ecByte = (ec: "L" | "M" | "Q" | "H") =>
      bytes((w) => w.qr("A", 6, ec))[bytes((w) => w.qr("A", 6, ec)).indexOf(0x45) + 1];
    expect(ecByte("L")).toBe(48);
    expect(ecByte("M")).toBe(49);
    expect(ecByte("Q")).toBe(50);
    expect(ecByte("H")).toBe(51);
  });

  it("clamps the module size to what the command accepts", () => {
    // The size byte is the one immediately after the 0x43 selector.
    const sizeByte = (requested: number) => {
      const out = bytes((w) => w.qr("A", requested));
      return out[out.indexOf(0x43) + 1];
    };
    expect(sizeByte(99)).toBe(16);
    expect(sizeByte(0)).toBe(1);
    expect(sizeByte(6)).toBe(6);
  });
});

// ── Line layout ─────────────────────────────────────────────────────────────

describe("line helpers", () => {
  it("knows each font's line width", () => {
    // 203 dpi over 72mm printable: Font A is 12 dots wide, Font B is 9.
    expect(FONT_A_COLS).toBe(48);
    expect(FONT_B_COLS).toBe(64);
  });

  it("rules the full width of the line", () => {
    expect(rule(FONT_A_COLS)).toHaveLength(48);
    expect(rule(8, "=")).toBe("========");
  });

  it("rules nothing rather than throwing on a negative width", () => {
    expect(rule(-5)).toBe("");
  });

  it("pushes a value to the right margin", () => {
    const line = pair("FARE", "P1,500.00", FONT_A_COLS);
    expect(line).toHaveLength(48);
    expect(line.startsWith("FARE")).toBe(true);
    expect(line.endsWith("P1,500.00")).toBe(true);
  });

  it("fills the gap with whatever the caller asked for", () => {
    expect(pair("A", "B", 10, ".")).toBe("A........B");
  });

  it("never truncates the value to save the label", () => {
    // A fare or a ticket number matters more than its caption, so an
    // over-long pair drops the filler and wraps naturally.
    const line = pair("A VERY LONG CAPTION INDEED", "P1,234,567.00", 20);
    expect(line).toContain("P1,234,567.00");
    expect(line).toBe("A VERY LONG CAPTION INDEED P1,234,567.00");
  });

  it("folds both halves of a pair through the transliterator", () => {
    expect(pair("TOTAL", "₱50.00", 20)).toContain("P50.00");
  });

  it("breaks text at word boundaries inside the line width", () => {
    const lines = wrap("The quick brown fox jumps over the lazy dog", 16);
    expect(lines.every((l) => l.length <= 16)).toBe(true);
    expect(lines.join(" ")).toBe("The quick brown fox jumps over the lazy dog");
  });

  it("collapses the whitespace a pasted value carries", () => {
    expect(wrap("  spaced   out  ", 40)).toEqual(["spaced out"]);
  });

  it("gives a word longer than the line a line of its own", () => {
    // Better one over-long line than an infinite loop or a dropped word.
    expect(wrap("SUPERCALIFRAGILISTIC", 8)).toEqual(["SUPERCALIFRAGILISTIC"]);
  });

  it("wraps nothing into no lines", () => {
    expect(wrap("", 40)).toEqual([]);
    expect(wrap("   ", 40)).toEqual([]);
  });
});

// ── Getting the job to the agent ────────────────────────────────────────────

describe("base64 and concatenation", () => {
  it("encodes bytes the way btoa would", () => {
    // Hand-rolled because btoa is web-only and Buffer is native-only, and this
    // module runs in both halves of the Expo build.
    expect(bytesToBase64(Uint8Array.from([72, 101, 108, 108, 111]))).toBe("SGVsbG8=");
  });

  it("pads a length that is not a multiple of three", () => {
    expect(bytesToBase64(Uint8Array.from([77]))).toBe("TQ==");
    expect(bytesToBase64(Uint8Array.from([77, 97]))).toBe("TWE=");
    expect(bytesToBase64(Uint8Array.from([77, 97, 110]))).toBe("TWFu");
  });

  it("encodes nothing as nothing", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });

  it("round-trips the full byte range", () => {
    // Decoded by hand rather than with Buffer or atob: this module is
    // hand-rolled precisely because neither is available in both halves of
    // the Expo build, and the test should not assume more than it does.
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const decode = (b64: string): number[] => {
      const out: number[] = [];
      const clean = b64.replace(/=+$/, "");
      let bits = 0;
      let acc = 0;
      for (const ch of clean) {
        acc = (acc << 6) | ALPHABET.indexOf(ch);
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          out.push((acc >> bits) & 0xff);
        }
      }
      return out;
    };

    const all = Array.from({ length: 256 }, (_, i) => i);
    expect(decode(bytesToBase64(Uint8Array.from(all)))).toEqual(all);
  });

  it("joins several rendered tickets into one spooler job", () => {
    const joined = concatBytes([
      Uint8Array.from([1, 2]),
      Uint8Array.from([3]),
      Uint8Array.from([4, 5]),
    ]);
    expect(Array.from(joined)).toEqual([1, 2, 3, 4, 5]);
  });

  it("joins an empty batch without failing", () => {
    expect(concatBytes([])).toHaveLength(0);
    expect(Array.from(concatBytes([new Uint8Array(), Uint8Array.from([7])]))).toEqual([7]);
  });
});
