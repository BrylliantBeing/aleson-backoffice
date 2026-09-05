import Colors from "@/constants/Colors";
import { useLayout } from "@/hooks/useLayout";
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
  const { compact } = useLayout();

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
        // Five labels have to share a phone's width — "Refund & Rebooking" is
        // the one that decides how small they need to get.
        tabBarLabelStyle: {
          fontFamily: "Lato",
          fontSize: compact ? 10 : 12,
        },
        tabBarItemStyle: { paddingHorizontal: compact ? 2 : 8 },
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
        name="transactions"
        options={{
          title: "Transactions",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="history" size={size} color={color} />
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
      {/* Sits after Till because that is the order of the work: count the
          drawer, then print the report that accounts for it. */}
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="file-text-o" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
