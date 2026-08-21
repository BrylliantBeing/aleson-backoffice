import Colors from "@/constants/Colors";
import { useLayout } from "@/hooks/useLayout";
import React from "react";
import { useColorScheme, View } from "react-native";

interface BackgroundProps {
  children?: React.ReactNode;
}

const Background = ({ children }: BackgroundProps) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? "light"] ?? Colors.light;
  const { gutter } = useLayout();
  return (
    <View style={{ backgroundColor: theme.background, flex: 1, padding: gutter }}>
      {children}
    </View>
  );
};

export default Background;
