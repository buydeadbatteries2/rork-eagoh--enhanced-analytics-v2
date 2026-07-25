import { palette } from "@/constants/colors";
import { useSafeBack } from "@/hooks/useSafeBack";
import { ArrowLeft, Scale } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "Eligibility",
    body: "You must be at least 13 years old to use EAGOH. By creating an account, you confirm that you meet this age requirement and that all registration information you provide is accurate and complete.",
  },
  {
    title: "Description of Service",
    body: "EAGOH (Enhanced Analytics & Game Oracle Hub) is an AI-powered intelligence platform that allows users to create personalized AI oracle identities (\"EAGOHs\"), submit observations, participate in mock intelligence marketplaces, join analyst factions, and explore predictive analytics. EAGOH provides informational and entertainment content only. EAGOH is not a gambling platform, financial advisor, medical professional, or legal counsel.",
  },
  {
    title: "User Accounts",
    body: "You are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately of any unauthorized use. EAGOH reserves the right to suspend or terminate accounts that violate these Terms.",
  },
  {
    title: "Subscriptions and Neurons",
    body: "EAGOH offers subscription tiers (Free, Pro, Oracle Elite, Syndicate) that allocate monthly Neurons for platform activities. Neurons are virtual platform currency with no real-world cash value. They cannot be redeemed for money, transferred outside the platform, or exchanged for any financial instrument. Subscription Neurons may be subject to rollover caps. Purchased Neurons, when available through RevenueCat, are non-refundable except as required by applicable law.",
  },
  {
    title: "User Content",
    body: "You retain ownership of content you create on EAGOH, including observation entries, EAGOH identities, and marketplace listings. By posting content, you grant EAGOH a worldwide, non-exclusive, royalty-free license to display and distribute your content within the platform. You represent that you have all necessary rights to any content you upload. You may not upload copyrighted logos, trademarks, or unauthorized likenesses of individuals without explicit permission.",
  },
  {
    title: "Marketplace and Factions",
    body: "The EAGOH Marketplace enables mock intelligence sync transactions between users using Neurons. Factions are voluntary analyst alliances for collaborative intelligence. EAGOH does not guarantee the accuracy, reliability, or value of any marketplace listing or faction intelligence. Users participate at their own discretion.",
  },
  {
    title: "AI Generated Content",
    body: "EAGOH uses artificial intelligence, including OpenAI and other third-party models, to generate responses, analyze observations, and create visual assets. AI-generated content may be inaccurate, incomplete, or inconsistent. You should independently verify any important information before relying on it. EAGOH makes no warranties regarding AI output accuracy.",
  },
  {
    title: "Intellectual Property",
    body: "The EAGOH brand, platform design, visual identity, and underlying technology are owned by NDSTRII Studios LLC. You may not copy, modify, distribute, or reverse-engineer any part of the platform without express written permission.",
  },
  {
    title: "Prohibited Conduct",
    body: "You agree not to: (a) use EAGOH for any illegal purpose; (b) attempt to manipulate or exploit platform systems; (c) harass, abuse, or harm other users; (d) upload malicious code or content; (e) impersonate others or misrepresent affiliations; (f) attempt unauthorized access to platform systems; (g) use automated tools to scrape or extract data without permission.",
  },
  {
    title: "Disclaimer",
    body: "EAGOH is provided \"AS IS\" without warranties of any kind, express or implied. EAGOH does not guarantee predictions, outcomes, rankings, or analysis accuracy. The platform is for informational and entertainment purposes only and should not be used as the sole basis for any decision.",
  },
  {
    title: "Limitation of Liability",
    body: "To the maximum extent permitted by law, NDSTRII Studios LLC and its affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of EAGOH. Our total liability for any claim shall not exceed the amount you paid us in the 12 months preceding the claim.",
  },
  {
    title: "Account Termination",
    body: "You may delete your account at any time through the app settings. EAGOH reserves the right to suspend or terminate accounts for violations of these Terms, with or without notice. Upon termination, your right to access EAGOH ceases immediately. Data retention policies apply as described in our Privacy Policy.",
  },
  {
    title: "Changes to These Terms",
    body: "We may update these Terms from time to time. Material changes will be communicated through the app or via email. Continued use of EAGOH after changes take effect constitutes acceptance of the revised Terms.",
  },
  {
    title: "Contact",
    body: "For questions about these Terms, contact NDSTRII Studios LLC at eagohsupport@ndstriistudios.com.",
  },
];

export default function TermsScreen(): JSX.Element {
  const safeBack = useSafeBack();

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => { safeBack(); }}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={palette.text} size={20} />
        </Pressable>
        <Scale color={palette.cyan} size={20} />
        <Text style={styles.headerTitle}>Terms of Service</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lastUpdated}>Last updated: June 2025</Text>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.void },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.obsidian,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  headerTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "900",
    flex: 1,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 18, paddingBottom: 60 },
  lastUpdated: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 20,
  },
  section: {
    marginBottom: 22,
    padding: 14,
    borderRadius: 5,
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.line,
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 8,
  },
  sectionBody: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
  },
});
