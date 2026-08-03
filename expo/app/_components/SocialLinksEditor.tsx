/**
 * SocialLinksEditor — Settings section for managing social media profile links.
 *
 * Users can:
 *   - Enter full profile URLs for each supported platform
 *   - Save/update a link (validated against platform's approved domains)
 *   - Remove a saved link
 *   - Toggle visibility of a saved link
 *
 * Uses the shared platform config from socialLinks.ts — no duplicated validation.
 * Social links are NOT verification — they are just profile URLs visitors can open.
 */
import { palette } from "@/constants/colors";
import { useHaptics } from "@/hooks/useHaptics";
import {
  deleteSocialLink,
  getMySocialLinks,
  PLATFORM_CONFIGS,
  PLATFORM_ORDER,
  saveSocialLink,
  SOCIAL_LINKS_QUERY_KEY,
  toggleSocialLinkVisibility,
  validateSocialUrl,
  type SocialLinkPlatform,
  type SocialLinkRow,
} from "@/services/socialLinks";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react-native";
import React, { memo, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import SocialPlatformIcon from "./SocialPlatformIcon";

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  helperText: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  platformList: {
    gap: 8,
  },
  platformRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,20,40,0.45)",
    overflow: "hidden",
  },
  platformHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
  },
  platformInfo: {
    flex: 1,
  },
  platformName: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "800",
  },
  platformStatus: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
  savedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(0,255,178,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,255,178,0.30)",
  },
  savedBadgeText: {
    color: palette.success,
    fontSize: 9,
    fontWeight: "800",
  },
  expandChevron: {
    padding: 4,
  },
  expandedContent: {
    padding: 10,
    paddingTop: 0,
    gap: 8,
  },
  urlInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  urlInput: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(2,4,10,0.55)",
    color: palette.text,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.cyan,
    backgroundColor: "rgba(108,230,255,0.10)",
  },
  saveBtnText: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "800",
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,77,109,0.30)",
    backgroundColor: "rgba(255,77,109,0.06)",
  },
  removeBtnText: {
    color: palette.ember,
    fontSize: 11,
    fontWeight: "800",
  },
  visibilityToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(2,4,10,0.35)",
  },
  visibilityLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  visibilityText: {
    color: palette.text,
    fontSize: 11,
    fontWeight: "700",
  },
  toggleSwitch: {
    width: 36,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  toggleSwitchOn: {
    backgroundColor: palette.cyan,
    borderColor: palette.cyan,
  },
  toggleKnob: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: palette.muted,
  },
  toggleKnobOn: {
    backgroundColor: palette.void,
    transform: [{ translateX: 16 }],
  },
  errorText: {
    color: palette.ember,
    fontSize: 10,
    fontWeight: "700",
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.88,
  },
});

// ── Platform Row ───────────────────────────────────────────────────────

type PlatformRowProps = {
  platform: SocialLinkPlatform;
  savedLink: SocialLinkRow | undefined;
  busy: string | null;
  onSave: (platform: SocialLinkPlatform, url: string) => void;
  onRemove: (linkId: string) => void;
  onToggleVisibility: (linkId: string, isVisible: boolean) => void;
};

const PlatformRow = memo(function PlatformRow({
  platform,
  savedLink,
  busy,
  onSave,
  onRemove,
  onToggleVisibility,
}: PlatformRowProps): JSX.Element {
  const config = PLATFORM_CONFIGS[platform];
  const [expanded, setExpanded] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const h = useHaptics();

  const isBusy = busy !== null;
  const rowBusy = busy === `save:${platform}` || busy === `remove:${savedLink?.id}` || busy === `visibility:${savedLink?.id}`;

  const handleExpand = useCallback(() => {
    h.selection();
    setExpanded((prev) => !prev);
    setError(null);
    setUrlInput(savedLink?.profile_url ?? "");
  }, [h, savedLink]);

  const handleSave = useCallback(() => {
    h.selection();
    setError(null);
    const validation = validateSocialUrl(platform, urlInput);
    if (!validation.ok) {
      setError(validation.error ?? "Enter a valid social profile link.");
      return;
    }
    onSave(platform, urlInput);
  }, [h, platform, urlInput, onSave]);

  const handleRemove = useCallback(() => {
    if (!savedLink) return;
    h.selection();
    Alert.alert(
      "Remove Social Link",
      `Remove your ${config.displayName} link from your public profile?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => onRemove(savedLink.id),
        },
      ],
    );
  }, [h, savedLink, config.displayName, onRemove]);

  const handleToggleVisibility = useCallback(() => {
    if (!savedLink) return;
    h.selection();
    onToggleVisibility(savedLink.id, !savedLink.is_visible);
  }, [h, savedLink, onToggleVisibility]);

  return (
    <View style={styles.platformRow}>
      <Pressable
        onPress={handleExpand}
        disabled={isBusy}
        style={({ pressed }) => [styles.platformHeader, pressed && styles.pressed]}
      >
        <SocialPlatformIcon platform={platform} size="small" />
        <View style={styles.platformInfo}>
          <Text style={styles.platformName}>{config.displayName}</Text>
          <Text style={styles.platformStatus}>
            {savedLink ? savedLink.profile_url : "Not added"}
          </Text>
        </View>
        {savedLink ? (
          <View style={styles.savedBadge}>
            <Check color={palette.success} size={10} />
            <Text style={styles.savedBadgeText}>Saved</Text>
          </View>
        ) : null}
        <View style={styles.expandChevron}>
          {expanded ? (
            <ChevronUp color={palette.muted} size={16} />
          ) : (
            <ChevronDown color={palette.muted} size={16} />
          )}
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.expandedContent}>
          <View style={styles.urlInputRow}>
            <TextInput
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder={config.placeholder}
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.urlInput}
              editable={!rowBusy}
            />
            <Pressable
              onPress={handleSave}
              disabled={rowBusy || !urlInput.trim()}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && styles.pressed,
                (!urlInput.trim() || rowBusy) && { opacity: 0.45 },
              ]}
            >
              {busy === `save:${platform}` ? (
                <ActivityIndicator color={palette.cyan} size={13} />
              ) : (
                <Check color={palette.cyan} size={14} />
              )}
              <Text style={styles.saveBtnText}>
                {savedLink ? "Update" : "Save"}
              </Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {savedLink ? (
            <>
              <Pressable
                onPress={handleToggleVisibility}
                disabled={rowBusy}
                style={({ pressed }) => [styles.visibilityToggle, pressed && styles.pressed]}
              >
                <View style={styles.visibilityLabel}>
                  {savedLink.is_visible ? (
                    <Eye color={palette.cyan} size={14} />
                  ) : (
                    <EyeOff color={palette.muted} size={14} />
                  )}
                  <Text style={styles.visibilityText}>
                    {savedLink.is_visible ? "Visible on profile" : "Hidden from profile"}
                  </Text>
                </View>
                <View
                  style={[
                    styles.toggleSwitch,
                    savedLink.is_visible && styles.toggleSwitchOn,
                  ]}
                >
                  <View
                    style={[
                      styles.toggleKnob,
                      savedLink.is_visible && styles.toggleKnobOn,
                    ]}
                  />
                </View>
              </Pressable>

              <Pressable
                onPress={handleRemove}
                disabled={rowBusy}
                style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
              >
                {busy === `remove:${savedLink.id}` ? (
                  <ActivityIndicator color={palette.ember} size={13} />
                ) : (
                  <Trash2 color={palette.ember} size={13} />
                )}
                <Text style={styles.removeBtnText}>Remove Link</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

// ── Main Editor Component ──────────────────────────────────────────────

export type SocialLinksEditorProps = {
  /** Optional style override */
  style?: import("react-native").ViewStyle;
};

export const SocialLinksEditor = memo(function SocialLinksEditor({
  style,
}: SocialLinksEditorProps): JSX.Element {
  const h = useHaptics();
  const queryClient = useQueryClient();

  const [busy, setBusy] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const { data: links, isLoading } = useQuery<SocialLinkRow[]>({
    queryKey: SOCIAL_LINKS_QUERY_KEY,
    queryFn: getMySocialLinks,
    staleTime: 5_000,
  });

  const linksByPlatform = useMemo(() => {
    const map = new Map<SocialLinkPlatform, SocialLinkRow>();
    for (const link of links ?? []) {
      map.set(link.platform, link);
    }
    return map;
  }, [links]);

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: SOCIAL_LINKS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ["public-social-links"] });
  }, [queryClient]);

  const handleSave = useCallback(
    async (platform: SocialLinkPlatform, url: string) => {
      setBusy(`save:${platform}`);
      setStatusMsg("Saving social link...");
      setStatusIsError(false);
      const result = await saveSocialLink(platform, url);
      setBusy(null);
      if (result.ok) {
        h.selection();
        setStatusMsg("Social link saved.");
        setStatusIsError(false);
        refreshAll();
      } else {
        setStatusMsg(result.error ?? "Social link could not be saved.");
        setStatusIsError(true);
      }
    },
    [h, refreshAll],
  );

  const handleRemove = useCallback(
    async (linkId: string) => {
      setBusy(`remove:${linkId}`);
      setStatusMsg(null);
      const result = await deleteSocialLink(linkId);
      setBusy(null);
      if (result.ok) {
        h.selection();
        setStatusMsg("Social link removed.");
        setStatusIsError(false);
        refreshAll();
      } else {
        setStatusMsg(result.error ?? "Social link could not be removed.");
        setStatusIsError(true);
      }
    },
    [h, refreshAll],
  );

  const handleToggleVisibility = useCallback(
    async (linkId: string, isVisible: boolean) => {
      setBusy(`visibility:${linkId}`);
      setStatusMsg(null);
      const result = await toggleSocialLinkVisibility(linkId, isVisible);
      setBusy(null);
      if (result.ok) {
        h.selection();
        setStatusMsg(isVisible ? "Link is now visible." : "Link is now hidden.");
        setStatusIsError(false);
        refreshAll();
      } else {
        setStatusMsg(result.error ?? "Social link could not be updated.");
        setStatusIsError(true);
      }
    },
    [h, refreshAll],
  );

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.helperText}>
        Add links to your social profiles. Only the platforms you add will appear on your public profile.
      </Text>

      {statusMsg ? (
        <Text
          style={[
            styles.statusText,
            { color: statusIsError ? palette.ember : palette.success },
          ]}
        >
          {statusMsg}
        </Text>
      ) : null}

      {isLoading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
          <ActivityIndicator color={palette.cyan} size="small" />
          <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "700" }}>
            Loading social links...
          </Text>
        </View>
      ) : (
        <View style={styles.platformList}>
          {PLATFORM_ORDER.map((platform) => (
            <PlatformRow
              key={platform}
              platform={platform}
              savedLink={linksByPlatform.get(platform)}
              busy={busy}
              onSave={handleSave}
              onRemove={handleRemove}
              onToggleVisibility={handleToggleVisibility}
            />
          ))}
        </View>
      )}
    </View>
  );
});

export default SocialLinksEditor;
