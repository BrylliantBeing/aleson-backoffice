import Colors from "@/constants/Colors";
import { ID_TYPES, PINNED_ID_TYPES } from "@/constants/idTypes";
import { FontAwesome } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  ViewStyle,
} from "react-native";

const PINNED = new Set<string>(PINNED_ID_TYPES);

/**
 * Compact ID-type dropdown sized for the passenger table row.
 *
 * A fixed list rather than free text: the manifest is read by the coast guard
 * and by Malaysian immigration on the Sandakan run, so one name per document
 * matters more than letting the cashier type anything. Passport, PhilSys and
 * driver's licence are pinned — between them they cover nearly every sale.
 * No search box: twenty rows scroll faster than a filter can be typed.
 */
interface IdTypeFieldProps {
  value: string;
  onChange: (idType: string) => void;
  style?: ViewStyle | ViewStyle[];
  placeholder?: string;
}

const IdTypeField = ({
  value,
  onChange,
  style,
  placeholder = "ID type",
}: IdTypeFieldProps) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
                ID type
              </Text>
              <Pressable onPress={close} hitSlop={8}>
                <FontAwesome name="close" size={16} color={theme.greyText} />
              </Pressable>
            </View>

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {ID_TYPES.map((item, index) => {
                const selected = item === value;
                // Hairline under the pinned block so it reads as "common first,
                // then everyone else" rather than a broken alphabetical list.
                const lastPinned = PINNED.has(item) && !PINNED.has(ID_TYPES[index + 1] ?? "");
                return (
                  <Pressable
                    key={item}
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
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

export default IdTypeField;

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
  list: { maxHeight: 360 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
});
