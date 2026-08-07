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
    body: "EAGOH (Enhanced Analytics & Game Oracle Hub) is an AI-powered intelligence platform that allows users to create personalized AI oracle identities (\"EAGOHs\"), submit Open Intelligence observations, participate in a mock intelligence marketplace (\"Exchange\"), join analyst Factions, compete in Arena matchups, earn leaderboard rankings, purchase sponsored banner promotions, and explore predictive analytics. EAGOH provides informational and entertainment content only. EAGOH is not a gambling platform, financial advisor, medical professional, or legal counsel.",
  },
  {
    title: "User Accounts",
    body: "You are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately of any unauthorized use. EAGOH reserves the right to suspend or terminate accounts that violate these Terms.",
  },
  {
    title: "Subscriptions and Neurons",
    body: "EAGOH offers subscription tiers (Free, Pro, Oracle Elite, Syndicate) that allocate monthly Neurons for platform activities. Subscriptions are processed through RevenueCat via Apple App Store in-app purchase. Neurons are virtual platform currency with no real-world cash value. They cannot be redeemed for money, transferred outside the platform, or exchanged for any financial instrument. Subscription Neurons are subject to monthly rollover caps: unused subscription Neurons roll over only if you retained at least 10% of the prior month's allocation, up to a maximum of 10% of the prior allocation. Free tier Neurons do not roll over. Purchased Neuron Packs are available through RevenueCat and do not expire. Purchased Neurons are non-refundable except as required by applicable law. If a subscription is canceled, the current billing cycle's allocation remains available until the cycle ends; subsequent monthly allocations will not be granted.",
  },
  {
    title: "Open Intelligence",
    body: "Open Intelligence is a community knowledge system where users submit domain-locked observation entries with optional tags, confidence levels, and supporting context. Observations are scored for quality using AI-based evaluation. Submitted observations become part of the EAGOH knowledge ecosystem and may be visible to other users through Learning Feeds and marketplace listings. You retain ownership of your observations and grant EAGOH a license to display and process them within the platform as described in the User Content section.",
  },
  {
    title: "Exchange Marketplace",
    body: "The EAGOH Exchange enables mock intelligence sync transactions between users using Neurons. Vendors create listings for their EAGOHs at chosen price points (25%, 50%, 75%, 100% sync levels) and durations (1–5 days). Buyers pay Neurons to temporarily access a vendor EAGOH's intelligence. EAGOH does not guarantee the accuracy, reliability, or value of any Exchange listing. Users participate at their own discretion. A vendor cannot purchase their own listing.",
  },
  {
    title: "Retained Exchange Intelligence",
    body: "Each completed Exchange purchase may permanently add a limited selection (approximately 2%) of the purchased EAGOH's Open Intelligence to your private Retained Exchange Intelligence library. You may retain no more than 25% of any individual vendor EAGOH's eligible Open Intelligence. Once that limit is reached, future purchases will still provide temporary purchased access but will not add more retained entries. Retained entries are read-only, vendor-attributed, private, and cannot be resold, shared with Factions, or listed on the Exchange.",
  },
  {
    title: "Arena Mode",
    body: "Arena Mode allows users to pit their EAGOH against another EAGOH in domain-specific head-to-head analysis matchups (e.g., player vs. player, team vs. team, strategy vs. strategy). Arena matchups consume Neurons and generate AI-computed comparison results. Arena results are for entertainment and informational purposes only and do not constitute predictions of real-world outcomes. Refunds for Arena analysis may be issued at EAGOH's discretion in cases of technical failure.",
  },
  {
    title: "Sponsored Banners",
    body: "Users may purchase sponsored banner promotions to feature their EAGOH or Exchange listing in prominent carousel positions on the Home and Exchange screens. Banner bookings are purchased with Neurons for specific dates and display locations. Banner purchases are processed through a single atomic server-side transaction: Neurons are deducted and the banner booking is created simultaneously, or neither occurs. If a banner purchase fails, no Neurons are charged. Banner bookings are non-refundable once successfully created, except in cases of platform error. Banner availability is subject to date conflicts — if a requested date is already booked for the same location, the purchase will be rejected.",
  },
  {
    title: "Leaderboards",
    body: "EAGOH maintains leaderboards that rank users and EAGOHs across multiple categories including overall rankings, domain-specific rankings, rising contributors, and top marketplace vendors. Leaderboard positions are computed from platform activity metrics and do not constitute endorsements of accuracy or reliability. EAGOH reserves the right to adjust ranking algorithms and may remove entries that result from system manipulation or prohibited conduct.",
  },
  {
    title: "Factions",
    body: "Factions are voluntary analyst alliances for collaborative intelligence. Users may create or join Factions, participate in faction activity feeds, share intelligence, and compete in faction rankings. Faction leaders may manage membership and settings. EAGOH does not guarantee the accuracy, reliability, or value of any Faction intelligence or activity. Users participate at their own discretion.",
  },
  {
    title: "Social Share Verification",
    body: "EAGOH may offer a Social Share Verification system where users can earn Neuron rewards by sharing EAGOH content to external social platforms and verifying the share through screenshot submission. Verification is subject to review and approval. EAGOH reserves the right to deny rewards for shares that do not meet verification criteria, are determined to be fraudulent, or violate platform policies. Reward amounts are subject to change.",
  },
  {
    title: "User Content",
    body: "You retain ownership of content you create on EAGOH, including observation entries, EAGOH identities, Exchange listings, Faction messages, and source credentials. By posting content, you grant EAGOH a worldwide, non-exclusive, royalty-free license to display and distribute your content within the platform. You represent that you have all necessary rights to any content you upload. You may not upload copyrighted logos, trademarks, or unauthorized likenesses of individuals without explicit permission. Public content, including your username, public profile, EAGOH identities, Exchange listings, and shared observations, may be visible to other EAGOH users. Private data such as your email, account settings, and transaction history are never shared publicly.",
  },
  {
    title: "AI Generated Content",
    body: "EAGOH uses artificial intelligence, including OpenAI and other third-party models, to generate responses, analyze observations, score quality, create EAGOH visual assets, run Arena comparisons, and produce intelligence analysis. AI-generated content may be inaccurate, incomplete, or inconsistent. You should independently verify any important information before relying on it. EAGOH makes no warranties regarding AI output accuracy.",
  },
  {
    title: "Intellectual Property",
    body: "The EAGOH brand, platform design, visual identity, and underlying technology are owned by NDSTRII Studios LLC. You may not copy, modify, distribute, or reverse-engineer any part of the platform without express written permission.",
  },
  {
    title: "Prohibited Conduct",
    body: "You agree not to: (a) use EAGOH for any illegal purpose; (b) attempt to manipulate or exploit platform systems, including leaderboard rankings, Arena outcomes, or Exchange pricing; (c) harass, abuse, or harm other users; (d) upload malicious code or content; (e) impersonate others or misrepresent affiliations; (f) attempt unauthorized access to platform systems; (g) use automated tools to scrape or extract data without permission; (h) submit fraudulent social share verification screenshots; (i) create multiple accounts to exploit Neuron allocations or reward systems; (j) resell, transfer, or barter Neurons or account access outside the platform.",
  },
  {
    title: "Disclaimer",
    body: "EAGOH is provided \"AS IS\" without warranties of any kind, express or implied. EAGOH does not guarantee predictions, outcomes, rankings, Arena results, or analysis accuracy. The platform is for informational and entertainment purposes only and should not be used as the sole basis for any decision.",
  },
  {
    title: "Limitation of Liability",
    body: "To the maximum extent permitted by law, NDSTRII Studios LLC and its affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of EAGOH. Our total liability for any claim shall not exceed the amount you paid us in the 12 months preceding the claim.",
  },
  {
    title: "Account Termination",
    body: "You may delete your account at any time through the app settings. Account deletion permanently removes your EAGOHs, observations, Exchange listings, Faction memberships, retained intelligence, and profile data. EAGOH reserves the right to suspend or terminate accounts for violations of these Terms, with or without notice. Upon termination, your right to access EAGOH ceases immediately. Data retention policies apply as described in our Privacy Policy.",
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
        <Text style={styles.lastUpdated}>Last updated: August 2026</Text>
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
