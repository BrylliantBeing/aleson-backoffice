import Colors from "@/constants/Colors";
import { PINNED_EMAIL_DOMAINS } from "@/constants/emailDomains";
import { LIST_MAX, ROW_HEIGHT, measureDrop } from "@/utils/dropdown";
import {
  completeWith,
  completionFor,
  emailMatches,
  isDeletion,
  splitEmail,
} from "@/utils/emailComplete";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  useColorScheme,
  View,
  ViewStyle,
} from "react-native";

const PINNED = new Set<string>(PINNED_EMAIL_DOMAINS);

/**
 * Email field that completes the domain, in the shape of the ID-type combobox.
 *
 * Same gesture as IdTypeField — type, the field fills in the rest with the
 * added letters selected, Tab or Enter takes it — for the same reason: an email
 * address is a dozen keystrokes of which nine sales in ten are the same three
 * domains, and the clerk is standing at a counter with a queue.
 *
 * It differs from IdTypeField in the one way that matters: the vocabulary is
 * OPEN. An ID type that resolves to nothing is cleared on blur, because the
 * manifest may only carry documents the coast guard recognises. An email is
 * whatever the passenger says it is, so anything typed here survives exactly as
 * keyed and the list is only ever a shortcut. Nothing is ever cleared or
 * rewritten behind the clerk.
 *
 * Completion starts only once there is an "@" with something in front of it —
 * before that, every keystroke is the local part and there is nothing to guess.
 */
interface EmailFieldProps {
  value: string;
  onChange: (email: string) => void;
  /** Sizing for the field's wrapper. */
  style?: ViewStyle | ViewStyle[];
  /** Box/text styling for the input itself, matching its neighbours. */
  inputStyle?: TextStyle | TextStyle[];
  placeholder?: string;
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
  returnKeyType?: TextInputProps["returnKeyType"];
  blurOnSubmit?: boolean;
}

const EmailField = React.forwardRef<TextInput, EmailFieldProps>(({
  value,
  onChange,
  style,
  inputStyle,
  placeholder = "Email (optional)",
  onSubmitEditing,
  returnKeyType,
  blurOnSubmit,
}, ref) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  // `typed` is what the clerk actually keyed; `text` is what the field shows,
  // which is `typed` plus the completed domain tail while a suggestion stands.
  const [typed, setTyped] = useState(value);
  const [text, setText] = useState(value);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [drop, setDrop] = useState({ flip: false, max: LIST_MAX });

  const wrapRef = useRef<View>(null);
  // Mirrors `typed` so a keystroke sees the previous prefix even if React has
  // not re-rendered between two fast ones.
  const typedRef = useRef(typed);
  const keyed = (next: string) => {
    typedRef.current = next;
    setTyped(next);
  };
  // Last value this field sent up, so the round trip back through `value` isn't
  // mistaken for someone else setting the field.
  const emitted = useRef(value);
  // Clicking an option blurs the input first, and react-native-web reports the
  // press a tick later — so the blur can't tear the list down on the spot or
  // the click lands on nothing. It waits, and a press cancels the wait.
  const pressing = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
  };
  useEffect(() => cancelBlur, []);
  const justPicked = useRef(false);
  const innerRef = useRef<TextInput | null>(null);
  const attachRef = (el: TextInput | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<TextInput | null>).current = el;
  };

  const matches = useMemo(() => emailMatches(typed), [typed]);

  const emit = (next: string) => {
    emitted.current = next;
    onChange(next);
  };

  // External resets (clearing the form after a sale) without clobbering what is
  // being typed.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(value);
    keyed(value);
    setSelection(undefined);
  }, [value]);

  /**
   * Show `domain` on the end of the address, leaving the part the clerk didn't
   * type selected so the next keystroke replaces it.
   */
  const complete = (domain: string, source: string) => {
    const done = completeWith(source, domain);
    if (!done) return;
    setText(done.text);
    setSelection({ start: done.selectionStart, end: done.text.length });
    emit(done.text);
  };

  const handleChange = (raw: string) => {
    // Backspace has to be able to shorten the field, so a change that only
    // walks back what was already keyed doesn't complete again. Typing over the
    // selected tail also shortens the box, but replaces rather than trims —
    // that still completes, or every second keystroke would drop the suggestion.
    const deleting = isDeletion(typedRef.current, raw);
    keyed(raw);
    setHi(0);
    setOpen(true);
    const done = deleting ? null : completionFor(raw);
    if (done) {
      setText(done.text);
      setSelection({ start: done.selectionStart, end: done.text.length });
      emit(done.text);
      return;
    }
    setText(raw);
    setSelection(undefined);
    // Open vocabulary: whatever is in the box is the answer, match or not.
    emit(raw);
  };

  /** Walk the suggestion list, dropping each one into the field as it's reached. */
  const move = (delta: number) => {
    if (!matches.length) return;
    const next = (hi + delta + matches.length) % matches.length;
    setHi(next);
    complete(matches[next], typedRef.current);
  };

  /** Take the standing suggestion (or `choice`) and stop completing. */
  const commit = (choice?: string) => {
    const final = choice ? `${splitEmail(typedRef.current).local}@${choice}` : text;
    setText(final);
    keyed(final);
    setSelection({ start: final.length, end: final.length });
    setHi(0);
    setOpen(false);
    emit(final);
  };

  const openList = () => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    setHi(0);
    setOpen(true);
    setDrop(measureDrop(wrapRef.current));
  };

  const handleKeyPress = (e: any) => {
    const key = e?.nativeEvent?.key ?? e?.key;
    if (key === "Tab") {
      // Take the completion and let focus carry on — one key for both is the
      // point of typing the field instead of tapping it.
      commit();
    } else if (key === "Escape") {
      setOpen(false);
    } else if (key === "ArrowDown") {
      e.preventDefault?.();
      if (open) move(1);
      else openList();
    } else if (key === "ArrowUp") {
      e.preventDefault?.();
      if (open) move(-1);
    } else if (key === "Enter") {
      // No preventDefault: react-native-web still fires onSubmitEditing, which
      // is what carries the focus chain on.
      commit();
    }
  };

  const listStyle: ViewStyle = drop.flip
    ? { bottom: "100%", marginBottom: 4 }
    : { top: "100%", marginTop: 4 };

  return (
    <View ref={wrapRef} style={[styles.wrap, open ? styles.wrapOpen : null, style]}>
      <TextInput
        ref={attachRef}
        value={text}
        selection={selection}
        onChangeText={handleChange}
        onFocus={() => {
          cancelBlur();
          openList();
        }}
        onBlur={() => {
          cancelBlur();
          blurTimer.current = setTimeout(() => {
            blurTimer.current = null;
            // Only closes the list. Nothing is rewritten on the way out: the
            // address in the box is the passenger's, matched or not.
            if (!pressing.current) setOpen(false);
          }, 150);
        }}
        onKeyPress={handleKeyPress}
        placeholder={placeholder}
        placeholderTextColor={theme.greyText}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="email-address"
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        blurOnSubmit={blurOnSubmit}
        style={[
          { borderColor: theme.border, color: theme.text, backgroundColor: theme.control },
          inputStyle,
        ]}
      />

      {open && matches.length > 0 && (
        <View
          style={[
            styles.list,
            listStyle,
            { backgroundColor: theme.cardBackground, borderColor: theme.border },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: drop.max }}>
            {matches.map((domain, index) => {
              const active = index === hi;
              // Hairline under the pinned block so the list reads as "common
              // first, then everyone else".
              const lastPinned =
                PINNED.has(domain) && !PINNED.has(matches[index + 1] ?? "");
              return (
                <Pressable
                  key={domain}
                  onPressIn={() => {
                    pressing.current = true;
                  }}
                  onPress={() => {
                    cancelBlur();
                    pressing.current = false;
                    commit(domain);
                    justPicked.current = true;
                    innerRef.current?.focus();
                    setTimeout(() => {
                      justPicked.current = false;
                    }, 0);
                  }}
                  style={[
                    styles.row,
                    active && { backgroundColor: theme.tint + "1a" },
                    lastPinned && { borderBottomWidth: 1, borderBottomColor: theme.border },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 13,
                      fontFamily: "Lato",
                      color: active ? theme.tint : theme.text,
                      fontWeight: active ? "700" : "400",
                    }}
                  >
                    @{domain}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
});

EmailField.displayName = "EmailField";

export default EmailField;

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  // Sits above the fields that follow it while the list is open; equal
  // z-indexes let the next sibling bury it.
  wrapOpen: { zIndex: 50 },
  list: {
    position: "absolute",
    left: 0,
    right: 0,
    minWidth: 170,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 50,
    elevation: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  row: {
    height: ROW_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
});
