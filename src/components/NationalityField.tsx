import Colors from "@/constants/Colors";
import { NATIONALITIES, PINNED_NATIONALITIES } from "@/constants/nationalities";
import { FontAwesome } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  ViewStyle,
} from "react-native";

const PINNED = new Set<string>(PINNED_NATIONALITIES);

/**
 * Compact nationality dropdown sized for the passenger table row.
 *
 * A fixed list rather than free text: the manifest is read by the coast guard
 * and by Malaysian immigration on the Sandakan run, so one spelling per country
 * matters more than letting the cashier type anything. Filipino and Malaysian
 * are pinned to the top of the list — between them they cover nearly every sale.
 */
interface NationalityFieldProps {
  value: string;
  onChange: (nationality: string) => void;
  style?: ViewStyle | ViewStyle[];
  placeholder?: string;
}

const NationalityField = ({
  value,
  onChange,
  style,
  placeholder = "Nationality",
}: NationalityFieldProps) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NATIONALITIES;
    return NATIONALITIES.filter((n) => n.toLowerCase().includes(q));
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[
          styles.box,
          { borderColor: theme.border, backgroundColor: theme.control },
          style,
        ]}
      >
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontSize: 14, fontFamily: "Lato", color: value ? theme.text : theme.greyText }}
        >
          {value || placeholder}
        </Text>
        <FontAwesome name="chevron-down" size={10} color={theme.greyText} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.cardBackground, borderColor: theme.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHead, { borderBottomColor: theme.border }]}>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "800", fontFamily: "Lato" }}>
                Nationality
              </Text>
              <Pressable onPress={close} hitSlop={8}>
                <FontAwesome name="close" size={16} color={theme.greyText} />
              </Pressable>
            </View>

            <View style={[styles.searchWrap, { borderColor: theme.border, backgroundColor: theme.control }]}>
              <FontAwesome name="search" size={13} color={theme.greyText} />
              <TextInput
                style={[styles.search, { color: theme.text }]}
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={theme.greyText}
                autoCorrect={false}
                autoFocus
              />
            </View>

            <FlatList
              data={results}
              keyExtractor={(n) => n}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={{ color: theme.greyText, padding: 18, textAlign: "center", fontFamily: "Lato" }}>
                  No match for "{query.trim()}"
                </Text>
              }
              renderItem={({ item, index }) => {
                const selected = item === value;
                // Hairline under the pinned block so it reads as "common first,
                // then everyone else" rather than a broken alphabetical list.
                const lastPinned =
                  !query.trim() && PINNED.has(item) && !PINNED.has(results[index + 1] ?? "");
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item);
                      close();
                    }}
                    style={[
                      styles.row,
                      lastPinned && { borderBottomWidth: 1, borderBottomColor: theme.border },
                    ]}
                  >
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 14,
                        fontFamily: "Lato",
                        color: selected ? theme.tint : theme.text,
                        fontWeight: selected ? "700" : "400",
                      }}
                    >
                      {item}
                    </Text>
                    {selected && <FontAwesome name="check" size={12} color={theme.tint} />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

export default NationalityField;

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderBottomWidth: 1,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 10,
  },
  search: { flex: 1, paddingVertical: 8, fontSize: 14, fontFamily: "Lato", outlineStyle: "none" } as any,
  list: { maxHeight: 320 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
});
