import Colors from "@/constants/Colors";
import React from "react";
import {
    StyleSheet,
    Text,
    useColorScheme,
    View,
    ViewStyle,
} from "react-native";
import Spacer from "./Spacer";

interface BackgroundProps {
  children?: React.ReactNode;
  style?: ViewStyle;
  header?: string;
  spacer?: { height?: number; width?: number };
}

const WholeCard = ({
  header,
  style,
  children,
  spacer,
  ...props
}: BackgroundProps) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
        },
      ]}
    >
      {header ? (
        <Text style={[styles.headerText, { color: theme.text }]}>{header}</Text>
      ) : null}
      {spacer ? <Spacer height={spacer.height} /> : <></>}
      <View style={style}>{children}</View>
    </View>
  );
};

export default WholeCard;

const styles = StyleSheet.create({
  container: {
    margin: 20,
    padding: 22,
    borderRadius: 20,
    borderWidth: 1,
    // Soft elevated card, matching the website's rounded panels.
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  headerText: {
    fontSize: 24,
    fontWeight: "800",
    fontFamily: "Lato",
    marginBottom: 2,
  },
});
