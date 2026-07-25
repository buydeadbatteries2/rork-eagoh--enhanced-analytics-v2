/**
 * Social sharing utilities for EAGOH marketplace listings and public profiles.
 *
 * Uses React Native Share API when available, falls back to Clipboard.
 * Never exposes private Open Intelligence content in shared messages.
 */

import { Share, Clipboard, Platform, Alert, Linking } from "react-native";

/** Base URL for public links — uses the app's web presence. */
const PUBLIC_BASE_URL = "https://eagoh.app";

/** Builds a public listing URL for a marketplace listing. */
export function buildPublicListingUrl(listingId: string): string {
  return `${PUBLIC_BASE_URL}/listing/${listingId}`;
}

/** Builds a public profile URL, preferring username when available. */
export function buildPublicProfileUrl(username: string | null, userId: string): string {
  if (username) {
    return `${PUBLIC_BASE_URL}/u/${username.toLowerCase()}`;
  }
  return `${PUBLIC_BASE_URL}/profile/${userId}`;
}

/** Builds the share message for a marketplace listing. */
export function buildListingShareMessage(
  eagohName: string,
  vendorName: string | null,
  listingUrl: string,
  description?: string | null,
): string {
  const shortDesc = description
    ? ` ${description.slice(0, 120)}${description.length > 120 ? "…" : ""}`
    : "";
  const vendorPart = vendorName ? ` by ${vendorName}` : "";
  return `Check out my EAGOH analyst on EAGOH:${vendorPart} — ${eagohName}.${shortDesc} View my marketplace listing here: ${listingUrl}`;
}

/** Builds the share message for a public profile. */
export function buildProfileShareMessage(
  displayName: string | null,
  username: string | null,
  profileUrl: string,
): string {
  const name = displayName ?? username ?? "This EAGOH analyst";
  return `Check out ${name} on EAGOH — the intelligence marketplace. View their profile here: ${profileUrl}`;
}

/** Copies text to clipboard and shows a toast. */
export function copyToClipboard(text: string, label: string = "Link"): void {
  Clipboard.setString(text);
  Alert.alert("Copied", `${label} copied to clipboard.`);
}

/** Shares content via native Share sheet, falls back to clipboard copy. */
export async function shareContent(
  message: string,
  url?: string,
): Promise<void> {
  const shareOptions = {
    message,
    url: url as string | undefined,
    title: "EAGOH",
  };

  try {
    const result = await Share.share(shareOptions);
    if (result.action === Share.sharedAction) {
      // Successfully shared
    }
  } catch (error: unknown) {
    // Fallback: copy to clipboard
    const text = url ? `${message} ${url}` : message;
    copyToClipboard(text, "Share text");
  }
}

/** Shares a marketplace listing via native Share sheet. */
export async function shareListing(
  eagohName: string,
  vendorName: string | null,
  listingId: string,
  description?: string | null,
): Promise<void> {
  const listingUrl = buildPublicListingUrl(listingId);
  const message = buildListingShareMessage(eagohName, vendorName, listingUrl, description);
  await shareContent(message, listingUrl);
}

/** Shares a public profile via native Share sheet. */
export async function shareProfile(
  displayName: string | null,
  username: string | null,
  userId: string,
): Promise<void> {
  const profileUrl = buildPublicProfileUrl(username, userId);
  const message = buildProfileShareMessage(displayName, username, profileUrl);
  await shareContent(message, profileUrl);
}

/** Copies a marketplace listing link to clipboard. */
export function copyListingLink(listingId: string): void {
  const url = buildPublicListingUrl(listingId);
  copyToClipboard(url, "Listing link");
}

/** Copies a public profile link to clipboard. */
export function copyProfileLink(username: string | null, userId: string): void {
  const url = buildPublicProfileUrl(username, userId);
  copyToClipboard(url, "Profile link");
}
