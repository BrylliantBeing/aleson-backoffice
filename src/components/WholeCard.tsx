import Colors from "@/constants/Colors";
import { useLayout } from "@/hooks/useLayout";
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
  const { compact, gutter } = useLayout();
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
          // The card sits inside Background's padding, so its own margin has to
          // shrink with the page gutter or a phone loses half its width to chrome.
          margin: gutter,
          padding: compact ? 16 : 22,
        },
      ]}
    >
      {header ? (
        <Text
          style={[styles.headerText, { color: theme.text, fontSize: compact ? 20 : 24 }]}
        >
          {header}
        </Text>
      ) : null}
      {spacer ? <Spacer height={spacer.height} /> : <></>}
      <View style={style}>{children}</View>
    </View>
  );
};

export default WholeCard;

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    borderWidth: 1,
    // Soft elevated card, matching the website's rounded panels.
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  headerText: {
    fontWeight: "800",
    fontFamily: "Lato",
    marginBottom: 2,
  },
});
