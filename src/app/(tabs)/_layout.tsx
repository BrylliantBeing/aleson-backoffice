import Colors from "@/constants/Colors";
import { useAuth } from "@/context/AuthContext";
import { FontAwesome } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, useColorScheme, View } from "react-native";

// The whole back office is for ticketing agents, so the entire tab group is
// gated behind the agent login.
export default function TabsLayout() {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  const { agent, loading } = useAuth();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }
  if (!agent) return <Redirect href={"/login" as any} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.greyText,
        tabBarStyle: {
          backgroundColor: theme.cardBackground,
          borderTopColor: theme.greyText + "33",
        },
        tabBarLabelStyle: { fontFamily: "Lato" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Booking Office",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="ticket" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="performance"
        options={{
          title: "Sales Performance",
          href: null,
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="line-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="refund-rebook"
        options={{
          title: "Refund & Rebooking",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="exchange" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="shift"
        options={{
          title: "Till",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="money" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
