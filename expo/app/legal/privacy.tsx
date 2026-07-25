import { palette } from "@/constants/colors";
import { useSafeBack } from "@/hooks/useSafeBack";
import { ArrowLeft, ShieldCheck } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "Information We Collect",
    body: "We collect information you provide when creating an account, using EAGOH features, and interacting with the platform. This includes account credentials, profile details, EAGOH configurations, observation entries, marketplace activity, and faction participation data.",
  },
  {
    title: "Account Information",
    body: "When you register, we collect your email address and username. Your password is handled securely by Supabase Auth and is never stored in plaintext. We may also collect optional profile preferences such as theme selection and haptic feedback settings.",
  },
  {
    title: "User Content",
    body: "Content you create on EAGOH, including EAGOH identities, observation entries, marketplace listings, faction messages, and generated images, is stored on our servers. You control what you share publicly through marketplace listings and faction activity. Private data such as your email and account settings are never shared publicly.",
  },
  {
    title: "Device Information",
    body: "We collect basic device information necessary for app functionality, including device model, operating system version, and app version. This information helps us debug issues and improve the platform experience.",
  },
  {
    title: "AI Processing Disclosure",
    body: "When you use EAGOH features that involve artificial intelligence (such as chat analysis, image generation, and observation scoring), your content is transmitted to third-party AI providers including OpenAI for processing. These providers process your data solely for the purpose of generating AI responses and do not use your data for their own model training in accordance with their respective data processing agreements.",
  },
  {
    title: "Third-Party Providers",
    body: "EAGOH relies on the following third-party services:\n\n• Supabase — provides database hosting, authentication, and file storage for your account data, EAGOH content, and generated images.\n\n• OpenAI — processes text prompts for AI chat analysis, observation quality scoring, and EAGOH intelligence responses.\n\n• RevenueCat — manages subscription purchases and payment processing (coming soon). RevenueCat does not receive your EAGOH content or observation data.\n\nEach provider adheres to its own privacy and security standards. We do not sell personal information to any third party.",
  },
  {
    title: "Data Retention",
    body: "We retain your account data and content for as long as your account remains active. If you delete your account, we will remove your personal data within 30 days, except where retention is required by law. Anonymized or aggregated data may be retained for analytical purposes.",
  },
  {
    title: "Security",
    body: "We implement industry-standard security measures to protect your data, including encryption in transit (TLS), database-level row-level security (RLS) via Supabase, and authenticated API access. However, no method of electronic storage is 100% secure, and we cannot guarantee absolute security.",
  },
  {
    title: "Your Rights",
    body: "You have the right to: (a) access your personal data stored in EAGOH; (b) request correction of inaccurate data; (c) request deletion of your account and associated data; (d) export your data (coming soon); (e) withdraw consent where processing is consent-based. To exercise these rights, contact us at eagohsupport@ndstriistudios.com.",
  },
  {
    title: "Children's Privacy",
    body: "EAGOH is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13. If we become aware that a child under 13 has provided us with personal data, we will take steps to delete such information.",
  },
  {
    title: "International Users",
    body: "EAGOH is operated from the United States. If you access EAGOH from outside the United States, your data will be transferred to and processed in the United States. By using EAGOH, you consent to such transfer and processing in accordance with this Privacy Policy.",
  },
  {
    title: "Contact",
    body: "For privacy-related questions or to exercise your data rights, contact us at eagohsupport@ndstriistudios.com.\n\nNDSTRII Studios LLC",
  },
];

export default function PrivacyScreen(): JSX.Element {
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
        <ShieldCheck color={palette.cyan} size={20} />
        <Text style={styles.headerTitle}>Privacy Policy</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lastUpdated}>Last updated: June 2025</Text>
        <View style={styles.pledge}>
          <Text style={styles.pledgeTitle}>We do not sell personal information.</Text>
          <Text style={styles.pledgeBody}>
            Your data is used solely to provide and improve the EAGOH platform experience.
            We never sell, rent, or trade your personal data to third parties for their marketing purposes.
          </Text>
        </View>
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
    marginBottom: 16,
  },
  pledge: {
    padding: 14,
    borderRadius: 5,
    backgroundColor: "rgba(0,255,178,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,178,0.22)",
    marginBottom: 20,
  },
  pledgeTitle: {
    color: palette.success,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 6,
  },
  pledgeBody: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
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
