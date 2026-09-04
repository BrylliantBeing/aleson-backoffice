import Colors from "@/constants/Colors";
import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  useColorScheme,
  View,
  ViewStyle,
} from "react-native";

/**
 * Compact typed date entry in MM-DD-YYYY form (fast keyboard entry, no calendar
 * popover). Emits an ISO `YYYY-MM-DD` string via onChange, or "" while
 * incomplete/invalid.
 *
 * The year takes two digits or four. Four is unambiguous; two is what a clerk
 * at a busy counter actually types, so a 6-digit entry picks the century that
 * makes the date possible for `mode` ("09-04-98" is a 1998 birthdate, because
 * nobody was born in 2098) and then rewrites itself in full on blur. That last
 * step is the point: the century is a guess, and a guess the clerk cannot see is
 * one they cannot correct against the government ID in their hand. `mode` also
 * bounds a plausible year, so a slipped digit ("0198") reads as incomplete
 * rather than as a real date.
 */
interface DateFieldProps {
  value?: string; // ISO YYYY-MM-DD (optional — enables external reset sync)
  onChange: (iso: string) => void;
  mode?: "future" | "past";
  label?: string;
  placeholder?: string;
  inputStyle?: TextStyle | TextStyle[];
  style?: ViewStyle;
  error?: boolean;
  // Forwarded to the inner TextInput so the field can join a focus chain.
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
  returnKeyType?: TextInputProps["returnKeyType"];
  blurOnSubmit?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

const isoToDisplay = (iso?: string): string => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return `${m[2]}-${m[3]}-${m[1]}`;
};

// digits (up to 8) -> "MM-DD-YYYY" progressively
const formatDigits = (digits: string): string => {
  const d = digits.slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
};

/** Widest year a typed date may carry, so a transposed digit is caught here. */
const MIN_YEAR = 1900;
const maxYear = (mode: "future" | "past") =>
  new Date().getFullYear() + (mode === "future" ? 10 : 0);

/** Midnight today, so "is this in the future" ignores the time of day. */
const startOfToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

/**
 * Century for a 2-digit year: 20YY or 19YY, whichever lands the date on the
 * side of today that `mode` allows. A birthdate can't be in the future, so
 * "12-31-27" keyed in 2026 is 1927 rather than next year.
 */
const expandYear = (
  yy: number,
  mm: number,
  dd: number,
  mode: "future" | "past"
): number => {
  const limit = maxYear(mode);
  const candidates = [2000 + yy, 1900 + yy].filter(
    (y) => y >= MIN_YEAR && y <= limit
  );
  const fits = (y: number) => {
    const dt = new Date(y, mm - 1, dd);
    return mode === "past" ? dt <= startOfToday() : dt >= startOfToday();
  };
  return candidates.find(fits) ?? candidates[0] ?? 2000 + yy;
};

const displayToIso = (display: string, mode: "future" | "past"): string => {
  const digits = display.replace(/\D/g, "");
  if (digits.length !== 6 && digits.length !== 8) return "";
  const mm = parseInt(digits.slice(0, 2), 10);
  const dd = parseInt(digits.slice(2, 4), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  const year =
    digits.length === 8
      ? parseInt(digits.slice(4, 8), 10)
      : expandYear(parseInt(digits.slice(4, 6), 10), mm, dd, mode);
  if (year < MIN_YEAR || year > maxYear(mode)) return "";
  // Reject impossible calendar dates (e.g. 02-31).
  const dt = new Date(year, mm - 1, dd);
  if (dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return "";
  return `${year}-${pad(mm)}-${pad(dd)}`;
};

const DateField = React.forwardRef<TextInput, DateFieldProps>(({
  value,
  onChange,
  mode = "future",
  label,
  placeholder = "MM-DD-YYYY",
  inputStyle,
  style,
  error,
  onSubmitEditing,
  returnKeyType,
  blurOnSubmit,
}, ref) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  const [text, setText] = useState(isoToDisplay(value));

  // Sync external changes/resets (e.g. clearing the form) without clobbering
  // what the user is mid-typing.
  useEffect(() => {
    if (value === undefined) return;
    const ext = isoToDisplay(value);
    setText((cur) => (displayToIso(cur, mode) === value ? cur : ext));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (raw: string) => {
    const formatted = formatDigits(raw.replace(/\D/g, ""));
    setText(formatted);
    onChange(displayToIso(formatted, mode));
  };

  // Rewrite a 2-digit year in full once the clerk leaves the field, so the
  // century this component guessed is on screen to be checked against the ID.
  const handleBlur = () => {
    const iso = displayToIso(text, mode);
    if (iso) setText(isoToDisplay(iso));
  };

  return (
    <View style={style}>
      {label ? <Text style={[styles.label, { color: theme.greyText }]}>{label}</Text> : null}
      <TextInput
        ref={ref}
        value={text}
        onChangeText={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        placeholderTextColor={theme.greyText}
        keyboardType="number-pad"
        maxLength={10}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        blurOnSubmit={blurOnSubmit}
        style={[
          {
            borderColor: error ? "#e5484d" : theme.border,
            color: theme.text,
            backgroundColor: theme.control,
          },
          inputStyle,
        ]}
      />
    </View>
  );
});

DateField.displayName = "DateField";

export default DateField;

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
    fontFamily: "Lato",
  },
});
