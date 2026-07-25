import { Tabs } from "expo-router";
import { ArrowRightLeft, Hammer, Home, MessageCircle, UserRound } from "lucide-react-native";
import React from "react";
import { Platform } from "react-native";
import { palette } from "@/constants/colors";
import { startupLog } from "@/utils/startupLogger";

/**
 * Standard native mobile tab bar anchored to the bottom of the screen.
 * Five tabs: Home, Forge, Sessions, Exchange, Profile.
 * Forge is visually emphasized as the primary action tab.
 * Labels always display fully.
 */
export default function TabLayout(): JSX.Element {
  startupLog("TabLayout_render", "start");
  startupLog("TabLayout_render", "success");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.cyan,
        tabBarInactiveTintColor: palette.muted,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: palette.obsidian,
          borderTopWidth: 1,
          borderTopColor: palette.line,
          height: Platform.OS === "ios" ? 88 : 68,
          paddingTop: 10,
          paddingBottom: Platform.OS === "ios" ? 28 : 10,
          elevation: 10,
          shadowColor: "#000",
          shadowOpacity: 0.5,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -3 },
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "800",
          letterSpacing: 0.2,
          marginTop: 3,
        },
        tabBarItemStyle: {
          paddingVertical: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="forge"
        options={{
          title: "Forge",
          tabBarIcon: ({ color, size }) => <Hammer color={color} size={size} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: "Sessions",
          tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="marketplace"
        options={{
          title: "Exchange",
          tabBarIcon: ({ color, size }) => <ArrowRightLeft color={color} size={size} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
