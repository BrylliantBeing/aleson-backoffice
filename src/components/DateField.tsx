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
 * The year is typed in full. It used to be two digits, expanded to 19YY/20YY by
 * comparing against today — which silently guessed the century and could not
 * express a date the guess got wrong. A birthdate is checked against the
 * government ID at the gate, so the clerk has to be able to enter 1998 and see
 * 1998. `mode` no longer picks a century; it only bounds a plausible year, so a
 * slipped digit ("0198") reads as incomplete rather than as a real date.
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

const displayToIso = (display: string, mode: "future" | "past"): string => {
  const digits = display.replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const mm = parseInt(digits.slice(0, 2), 10);
  const dd = parseInt(digits.slice(2, 4), 10);
  const year = parseInt(digits.slice(4, 8), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
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

  return (
    <View style={style}>
      {label ? <Text style={[styles.label, { color: theme.greyText }]}>{label}</Text> : null}
      <TextInput
        ref={ref}
        value={text}
        onChangeText={handleChange}
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
