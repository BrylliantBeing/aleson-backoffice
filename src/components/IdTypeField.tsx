import Colors from "@/constants/Colors";
import { ID_TYPES, PINNED_ID_TYPES } from "@/constants/idTypes";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
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

const PINNED = new Set<string>(PINNED_ID_TYPES);

/**
 * ID-type combobox for the passenger table row: typed, not tapped.
 *
 * The value still comes from a fixed list — the manifest is read by the coast
 * guard and by Malaysian immigration on the Sandakan run, so one name per
 * document matters more than letting the cashier type anything — but reaching
 * for a modal cost a mouse trip per passenger. Here the clerk types and the
 * field completes: "pas" fills in "Passport" with the added letters selected,
 * Tab (or Enter) takes it and moves on, so a whole passenger row stays on the
 * keyboard. Anything typed that resolves to nothing clears on blur rather than
 * riding onto the manifest as free text.
 */
interface IdTypeFieldProps {
  value: string;
  onChange: (idType: string) => void;
  /** Sizing for the field's wrapper (the row's flex basis). */
  style?: ViewStyle | ViewStyle[];
  /** Box/text styling for the input itself, matching the row's other cells. */
  inputStyle?: TextStyle | TextStyle[];
  placeholder?: string;
  /**
   * Fires as the suggestion list opens and closes. A row sets its own stacking
   * order, so the list can only escape it if the row it lives in is raised
   * while it's open — which only the row's owner can do.
   */
  onOpenChange?: (open: boolean) => void;
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
  returnKeyType?: TextInputProps["returnKeyType"];
  blurOnSubmit?: boolean;
}

/** How close a list entry is to what was typed; -1 when it isn't a match. */
const rank = (item: string, query: string): number => {
  const s = item.toLowerCase();
  if (s.startsWith(query)) return 0;
  // Word starts, so "phil" reaches "National ID (PhilSys)" and "sirb" the
  // seaman's book — the part of the name the clerk says out loud is often not
  // the first word.
  if (s.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(query))) return 1;
  if (s.includes(query)) return 2;
  return -1;
};

const matchesFor = (typed: string): string[] => {
  const query = typed.trim().toLowerCase();
  if (!query) return ID_TYPES;
  return ID_TYPES.map((item, i) => ({ item, r: rank(item, query), i }))
    .filter((m) => m.r >= 0)
    // Ties keep the list's own order, which already puts the counter's three
    // commonest documents first.
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((m) => m.item);
};

const exactMatch = (typed: string): string | undefined => {
  const q = typed.trim().toLowerCase();
  return ID_TYPES.find((item) => item.toLowerCase() === q);
};

const ROW_HEIGHT = 30;
const LIST_MAX = ROW_HEIGHT * 5;

/**
 * Which side of the field the list can open on, and how tall it may be.
 *
 * The passenger table scrolls in its own box, so the thing that would cut the
 * list off is that scroller, not the window — on the last visible row the list
 * has to open upward. Web reads the real clipping ancestors; elsewhere the
 * window is the only bound available synchronously, which is the right answer
 * on a phone anyway.
 */
const measureDrop = (node: unknown): { flip: boolean; max: number } => {
  const el = node as HTMLElement | null;
  if (Platform.OS !== "web" || !el?.getBoundingClientRect) {
    return { flip: false, max: LIST_MAX };
  }
  const rect = el.getBoundingClientRect();
  let ceiling = 0;
  let floor = window.innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = window.getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") {
      const box = p.getBoundingClientRect();
      ceiling = Math.max(ceiling, box.top);
      floor = Math.min(floor, box.bottom);
    }
  }
  const below = floor - rect.bottom - 8;
  const above = rect.top - ceiling - 8;
  const flip = below < LIST_MAX && above > below;
  return {
    flip,
    // Never taller than the room it has, so the last row shows whole entries
    // instead of a list sliced through the middle.
    max: Math.max(ROW_HEIGHT * 2, Math.min(LIST_MAX, flip ? above : below)),
  };
};

const IdTypeField = React.forwardRef<TextInput, IdTypeFieldProps>(({
  value,
  onChange,
  style,
  inputStyle,
  placeholder = "ID type",
  onOpenChange,
  onSubmitEditing,
  returnKeyType,
  blurOnSubmit,
}, ref) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  // `typed` is what the clerk actually keyed; `text` is what the field shows,
  // which is `typed` plus the completed tail while a suggestion is standing.
  const [typed, setTyped] = useState(value);
  const [text, setText] = useState(value);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [drop, setDrop] = useState<{ flip: boolean; max: number }>({
    flip: false,
    max: LIST_MAX,
  });

  const wrapRef = useRef<View>(null);
  // Mirrors `typed` so a keystroke sees the previous prefix even if React has
  // not re-rendered between two fast ones.
  const typedRef = useRef(typed);
  const keyed = (next: string) => {
    typedRef.current = next;
    setTyped(next);
  };
  // Last value this field sent up, so the round trip back through `value` isn't
  // mistaken for someone else setting the field. Half-typed text reports itself
  // as "" — without this the echo of that "" wipes the row mid-word.
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
  // Set while focus is handed back after a click, so the list doesn't spring
  // straight back open on the choice the clerk just made.
  const justPicked = useRef(false);
  const innerRef = useRef<TextInput | null>(null);
  const attachRef = (el: TextInput | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<TextInput | null>).current = el;
  };

  const matches = useMemo(() => matchesFor(typed), [typed]);

  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  useEffect(() => {
    openChange.current?.(open);
  }, [open]);

  const emit = (next: string) => {
    emitted.current = next;
    onChange(next);
  };

  // External resets (clearing the form, or a value set elsewhere) without
  // clobbering what is being typed.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(value);
    keyed(value);
    setSelection(undefined);
  }, [value]);

  /**
   * Fill the field with `pick`, leaving the part the clerk didn't type selected
   * so the next keystroke replaces it. Only for a pick that starts with what
   * was keyed — anything else would have to throw their letters away to show
   * itself, so those stay in the list and wait for Tab.
   */
  const complete = (pick: string, prefix: string) => {
    setText(pick);
    setSelection({ start: prefix.length, end: pick.length });
    emit(pick);
  };

  const handleChange = (raw: string) => {
    // Backspace has to be able to shorten the field, so a change that only
    // walks back the prefix already keyed doesn't complete again. Typing over
    // the selected tail also shortens the box, but replaces the prefix rather
    // than trimming it — that still completes, or every second keystroke would
    // drop the suggestion.
    const prev = typedRef.current;
    const deleting =
      raw.length <= prev.length && prev.toLowerCase().startsWith(raw.toLowerCase());
    keyed(raw);
    setHi(0);
    setOpen(true);
    const best = matchesFor(raw)[0];
    if (!deleting && raw.trim() && best?.toLowerCase().startsWith(raw.toLowerCase())) {
      complete(best, raw);
      return;
    }
    setText(raw);
    setSelection(undefined);
    emit(exactMatch(raw) ?? "");
  };

  /** Walk the suggestion list, dropping each one into the field as it's reached. */
  const move = (delta: number) => {
    if (!matches.length) return;
    const next = (hi + delta + matches.length) % matches.length;
    const pick = matches[next];
    setHi(next);
    if (pick.toLowerCase().startsWith(typedRef.current.toLowerCase())) {
      complete(pick, typedRef.current);
      return;
    }
    // A match that isn't a completion of the query can only be shown by
    // replacing the box, so the box's contents become the pick — but the query
    // behind the list is left alone, or arrowing on would filter the list down
    // to whatever it just landed on.
    setText(pick);
    typedRef.current = pick;
    setSelection({ start: pick.length, end: pick.length });
    emit(pick);
  };

  /** Take the standing suggestion (or `choice`) as the field's final value. */
  const commit = (choice?: string) => {
    const final = typed.trim() ? choice ?? matches[hi] ?? exactMatch(typed) ?? "" : "";
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
      // Take the suggestion and let focus carry on to the ID number — one key
      // for both is the point of typing the field instead of tapping it.
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
      // is what carries the focus chain on to the next field.
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
            if (!pressing.current) commit();
          }, 150);
        }}
        onKeyPress={handleKeyPress}
        placeholder={placeholder}
        placeholderTextColor={theme.greyText}
        autoCorrect={false}
        autoComplete="off"
        selectTextOnFocus
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
            {matches.map((item, index) => {
              const active = index === hi;
              // Hairline under the pinned block so the list reads as "common
              // first, then everyone else" rather than a broken alphabetical run.
              const lastPinned =
                !typed.trim() && PINNED.has(item) && !PINNED.has(matches[index + 1] ?? "");
              return (
                <Pressable
                  key={item}
                  onPressIn={() => {
                    pressing.current = true;
                  }}
                  onPress={() => {
                    cancelBlur();
                    pressing.current = false;
                    commit(item);
                    // Back to the field, so the row can be finished on the
                    // keyboard from here.
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
                    {item}
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

IdTypeField.displayName = "IdTypeField";

export default IdTypeField;

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  // Sits above the fields that follow it in the row while the list is open;
  // equal z-indexes let the next sibling bury it.
  wrapOpen: { zIndex: 50 },
  list: {
    position: "absolute",
    left: 0,
    minWidth: 190,
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
