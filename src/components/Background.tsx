import Colors from "@/constants/Colors";
import React from "react";
import { useColorScheme, View } from "react-native";

interface BackgroundProps {
  children?: React.ReactNode;
}

const Background = ({ children }: BackgroundProps) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? "light"] ?? Colors.light;
  return (
    <View style={{ backgroundColor: theme.background, flex: 1, padding: 20 }}>
      {children}
    </View>
  );
};

export default Background;
