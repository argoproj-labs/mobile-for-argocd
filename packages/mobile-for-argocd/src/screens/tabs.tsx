import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: {
          backgroundColor: "#0E1226",
          borderTopColor: colors.hairline,
          borderTopWidth: 1,
          paddingTop: 4,
          height: Platform.OS === "ios" ? 82 : 60,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "600",
          letterSpacing: 0.2,
          marginBottom: Platform.OS === "ios" ? 0 : 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Apps",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="user"
        options={{
          title: "User",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
