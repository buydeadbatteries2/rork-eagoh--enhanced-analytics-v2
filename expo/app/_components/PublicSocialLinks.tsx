/**
 * PublicSocialLinks — Linktree-style social icon row for public profiles.
 *
 * Renders visible social links as tappable icons in a horizontal wrapping row.
 * Opens the exact saved validated URL via React Native Linking.
 *
 * Used by:
 *   - public-profile.tsx (full public profile page)
 *   - PublicProfileModal.tsx (vendor profile modal)
 *
 * If no links exist or loading fails, renders null (no empty placeholder).
 * Social links are NOT verification — they are just profile URLs visitors can open.
 */
import { palette } from "@/constants/colors";
import React, { memo, useCallback } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  getPublicSocialLinks,
  publicSocialLinksKey,
  type SocialLinkRow,
} from "@/services/socialLinks";
import SocialPlatformIcon from "./SocialPlatformIcon";

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 14,
  },
  iconPressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.65,
    transform: [{ scale: 0.92 }],
  },
});

// ── Component ──────────────────────────────────────────────────────────

export type PublicSocialLinksProps = {
  userId: string;
};

export const PublicSocialLinks = memo(function PublicSocialLinks({
  userId,
}: PublicSocialLinksProps): JSX.Element | null {
  const { data: links } = useQuery<SocialLinkRow[]>({
    queryKey: publicSocialLinksKey(userId),
    queryFn: () => getPublicSocialLinks(userId),
    staleTime: 30_000,
  });

  const handlePress = useCallback(async (url: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert("Could Not Open", "This social profile could not be opened.");
      }
    } catch {
      Alert.alert("Could Not Open", "This social profile could not be opened.");
    }
  }, []);

  if (!links || links.length === 0) return null;

  return (
    <View style={styles.container}>
      {links.map((link) => (
        <Pressable
          key={link.id}
          onPress={() => handlePress(link.profile_url)}
          style={({ pressed }) => [
            styles.iconPressable,
            pressed && styles.pressed,
          ]}
          accessibilityLabel={`Open ${link.platform} profile`}
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <SocialPlatformIcon platform={link.platform} size="small" />
        </Pressable>
      ))}
    </View>
  );
});

export default PublicSocialLinks;
