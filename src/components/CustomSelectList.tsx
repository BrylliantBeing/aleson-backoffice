import Colors from "@/constants/Colors";
import { FontAwesome } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, useColorScheme, View, ViewStyle } from "react-native";
import { SelectList } from "react-native-dropdown-select-list";

interface CustomSelectListProps {
  data?: any;
  children?: React.ReactNode;
  style?: ViewStyle;
  label?: string;
  placeholder?: string;
  onSelect?: (value: string) => void;
}

const CustomSelectList = ({
  data,
  style,
  label,
  placeholder,
  onSelect,
}: CustomSelectListProps) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <Text style={[styles.label, { color: theme.greyText }]}>{label}</Text>
      ) : null}

      <SelectList
        setSelected={(val: string) => onSelect?.(val)}
        data={data}
        save="value"
        fontFamily="Lato"
        placeholder={placeholder ?? "Select"}
        searchPlaceholder="Search"
        boxStyles={{
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
          backgroundColor: theme.control,
          alignItems: "center",
        }}
        inputStyles={{
          color: theme.text,
          fontSize: 16,
          fontFamily: "Lato",
          // Let the search field shrink instead of pushing the close icon out.
          flexShrink: 1,
          minWidth: 0,
        }}
        // Float the list over the fields below instead of pushing them down, with a
        // solid background + shadow + high zIndex/elevation so it stays on top and
        // clickable (matches the customer website's dropdown).
        dropdownStyles={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: 4,
          zIndex: 1000,
          elevation: 16,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 12,
          backgroundColor: theme.cardBackground,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.16,
          shadowRadius: 18,
          maxHeight: 240,
        }}
        dropdownTextStyles={{
          color: theme.text,
          fontSize: 16,
          fontFamily: "Lato",
        }}
        arrowicon={
          <FontAwesome name="chevron-down" size={14} color={theme.greyText} style={{ marginLeft: 10 }} />
        }
        searchicon={
          <FontAwesome name="search" size={14} color={theme.greyText} style={{ marginRight: 10 }} />
        }
        closeicon={<FontAwesome name="close" size={14} color={theme.greyText} />}
      />
    </View>
  );
};

export default CustomSelectList;

const styles = StyleSheet.create({
  // position:relative + zIndex so the absolute dropdown escapes and floats above
  // the fields that follow.
  wrap: {
    position: "relative",
    zIndex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
    fontFamily: "Lato",
  },
});
