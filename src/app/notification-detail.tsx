import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { getFullLogoUrl } from '../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Notif {
  id: string;
  service_id?: string;
  service_name?: string;
  service_title?: string;
  logo_url?: string;
  about?: string;
  message: string;
  is_read?: boolean;
  sent_at?: string;
  created_at?: string;
}

function formatDate(iso?: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Bugun, ${time}`;
    const date = d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
    return `${date} — ${time}`;
  } catch {
    return iso;
  }
}

export default function NotificationDetailScreen() {
  const { theme, colors } = useTheme();
  const isDark = theme === 'dark';
  const params = useLocalSearchParams<{
    id: string;
    service_id?: string;
    service_name?: string;
    service_title?: string;
    logo_url?: string;
    about?: string;
    message: string;
    sent_at?: string;
    created_at?: string;
  }>();

  const [showServiceInfo, setShowServiceInfo] = useState(false);

  const notif: Notif = {
    id: params.id,
    service_id: params.service_id,
    service_name: params.service_name,
    service_title: params.service_title,
    logo_url: params.logo_url,
    about: params.about,
    message: params.message,
    sent_at: params.sent_at,
    created_at: params.created_at,
  };

  const logoUri = notif.logo_url ? getFullLogoUrl(notif.logo_url) : null;
  const displayTitle = notif.service_title || notif.service_name || 'Xizmat';
  const timeStr = formatDate(notif.sent_at || notif.created_at);

  // Safe back navigation
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  /* ── iOS-style colors ── */
  const ios = {
    bg: isDark ? '#000000' : '#FFFFFF',
    secondaryBg: isDark ? '#1C1C1E' : '#F2F2F7',
    groupedBg: isDark ? '#2C2C2E' : '#FFFFFF',
    separator: isDark ? 'rgba(84,84,88,0.65)' : 'rgba(60,60,67,0.12)',
    label: isDark ? '#FFFFFF' : '#000000',
    secondaryLabel: isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)',
    tertiaryLabel: isDark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)',
    blue: '#007AFF',
    messageBubble: isDark ? '#1C1C1E' : '#E9E9EB',
    myBubble: '#007AFF',
  };

  /* ════════════════════════════════════════════ */
  /*          SERVICE INFO FULLSCREEN            */
  /* ════════════════════════════════════════════ */
  if (showServiceInfo) {
    return (
      <View style={styles.fullscreenContainer}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        {/* Blurred background (60%) */}
        <View style={styles.blurLayer}>
          <BlurView
            intensity={60}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.25)' }]} />
        </View>

        <SafeAreaView style={styles.fullscreenSafeArea}>
          {/* Close button */}
          <View style={styles.serviceInfoHeader}>
            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }]}
              onPress={() => setShowServiceInfo(false)}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={22} color={isDark ? '#FFFFFF' : '#000000'} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.serviceInfoScroll}
            contentContainerStyle={styles.serviceInfoScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Large circular logo ── */}
            <View style={styles.serviceLogoSection}>
              {logoUri ? (
                <Image
                  source={{ uri: logoUri }}
                  style={styles.serviceLargeLogo}
                />
              ) : (
                <View style={[styles.serviceLargeLogoFallback, { backgroundColor: ios.blue + '25' }]}>
                  <Text style={[styles.serviceLargeInitial, { color: ios.blue }]}>
                    {displayTitle.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}

              {/* Service name under logo */}
              <Text style={[styles.serviceDisplayTitle, { color: '#FFFFFF' }]}>
                {displayTitle}
              </Text>

              {notif.service_name ? (
                <Text style={[styles.serviceDisplayName, { color: 'rgba(255,255,255,0.55)' }]}>
                  @{notif.service_name}
                </Text>
              ) : null}
            </View>

            {/* ── Info cards (iOS Settings grouped style) ── */}
            <View style={[styles.infoGroupCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)' }]}>
              {/* Name */}
              {notif.service_name ? (
                <View style={[styles.infoCardRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]}>
                  <View style={[styles.infoCardIcon, { backgroundColor: '#34C759' }]}>
                    <Ionicons name="at-outline" size={16} color="#FFFFFF" />
                  </View>
                  <View style={styles.infoCardContent}>
                    <Text style={[styles.infoCardLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)' }]}>Nomi</Text>
                    <Text style={[styles.infoCardValue, { color: isDark ? '#FFFFFF' : '#000000' }]}>{notif.service_name}</Text>
                  </View>
                </View>
              ) : null}

              {/* Title */}
              {notif.service_title ? (
                <View style={[styles.infoCardRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]}>
                  <View style={[styles.infoCardIcon, { backgroundColor: '#007AFF' }]}>
                    <Ionicons name="text-outline" size={16} color="#FFFFFF" />
                  </View>
                  <View style={styles.infoCardContent}>
                    <Text style={[styles.infoCardLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)' }]}>Sarlavha</Text>
                    <Text style={[styles.infoCardValue, { color: isDark ? '#FFFFFF' : '#000000' }]}>{notif.service_title}</Text>
                  </View>
                </View>
              ) : null}

              {/* About */}
              {notif.about ? (
                <View style={[styles.infoCardRow, { borderBottomWidth: 0 }]}>
                  <View style={[styles.infoCardIcon, { backgroundColor: '#FF9500' }]}>
                    <Ionicons name="information-circle-outline" size={16} color="#FFFFFF" />
                  </View>
                  <View style={styles.infoCardContent}>
                    <Text style={[styles.infoCardLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)' }]}>Haqida</Text>
                    <Text style={[styles.infoCardValue, { color: isDark ? '#FFFFFF' : '#000000' }]}>{notif.about}</Text>
                  </View>
                </View>
              ) : null}

              {/* Logo preview row */}
              {logoUri ? (
                <View style={[styles.infoCardRow, { borderBottomWidth: 0 }]}>
                  <View style={[styles.infoCardIcon, { backgroundColor: '#AF52DE' }]}>
                    <Ionicons name="image-outline" size={16} color="#FFFFFF" />
                  </View>
                  <View style={styles.infoCardContent}>
                    <Text style={[styles.infoCardLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)' }]}>Logo</Text>
                    <Image
                      source={{ uri: logoUri }}
                      style={styles.infoCardLogoPreview}
                      resizeMode="cover"
                    />
                  </View>
                </View>
              ) : null}
            </View>

            {/* Service ID */}
            {notif.service_id ? (
              <View style={[styles.infoGroupCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)' }]}>
                <View style={[styles.infoCardRow, { borderBottomWidth: 0 }]}>
                  <View style={[styles.infoCardIcon, { backgroundColor: '#5856D6' }]}>
                    <Ionicons name="key-outline" size={16} color="#FFFFFF" />
                  </View>
                  <View style={styles.infoCardContent}>
                    <Text style={[styles.infoCardLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)' }]}>Service ID</Text>
                    <Text style={[styles.infoCardValue, { color: isDark ? '#FFFFFF' : '#000000', fontSize: 13 }]} selectable>{notif.service_id}</Text>
                  </View>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Bottom close button */}
          <View style={styles.serviceInfoFooter}>
            <TouchableOpacity
              style={[styles.fullCloseBtn, { backgroundColor: ios.blue }]}
              onPress={() => setShowServiceInfo(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.fullCloseBtnText}>Yopish</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  /* ════════════════════════════════════════════ */
  /*        MAIN NOTIFICATION DETAIL SCREEN      */
  /* ════════════════════════════════════════════ */
  return (
    <View style={[styles.container, { backgroundColor: ios.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <SafeAreaView style={styles.safeArea}>

        {/* ─── iOS-style NAVBAR ─── */}
        <View style={[styles.navbar, { borderBottomColor: ios.separator }]}>
          {/* Back button */}
          <TouchableOpacity
            style={styles.navBackBtn}
            onPress={handleBack}
            activeOpacity={0.6}
          >
            <Ionicons name="chevron-back" size={28} color={ios.blue} />
          </TouchableOpacity>

          {/* Centre — tappable: circle logo + title */}
          <TouchableOpacity
            style={styles.navCenter}
            onPress={() => setShowServiceInfo(true)}
            activeOpacity={0.7}
          >
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.navLogo} />
            ) : (
              <View style={[styles.navLogoFallback, { backgroundColor: ios.blue + '20' }]}>
                <Text style={[styles.navLogoInitial, { color: ios.blue }]}>
                  {displayTitle.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.navTitleWrap}>
              <Text style={[styles.navTitle, { color: ios.label }]} numberOfLines={1}>
                {displayTitle}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Right spacer */}
          <View style={{ width: 34 }} />
        </View>

        {/* ─── MESSAGE BODY (iOS iMessage style) ─── */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Time stamp */}
          {timeStr ? (
            <View style={styles.timeCenter}>
              <Text style={[styles.timeCenterText, { color: ios.secondaryLabel }]}>{timeStr}</Text>
            </View>
          ) : null}

          {/* Message bubble (incoming — left aligned, gray) */}
          <View style={styles.bubbleRow}>
            {/* Small service avatar */}
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.bubbleAvatar} />
            ) : (
              <View style={[styles.bubbleAvatarFallback, { backgroundColor: ios.blue + '20' }]}>
                <Text style={[styles.bubbleAvatarInitial, { color: ios.blue }]}>
                  {displayTitle.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            <View style={[styles.messageBubble, { backgroundColor: ios.messageBubble }]}>
              <Text style={[styles.bubbleText, { color: ios.label }]}>
                {notif.message}
              </Text>
            </View>
          </View>

          {/* Service info card */}
          <TouchableOpacity
            style={[styles.serviceInfoCard, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}
            onPress={() => setShowServiceInfo(true)}
            activeOpacity={0.7}
          >
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.serviceInfoCardLogo} />
            ) : (
              <View style={[styles.serviceInfoCardFallback, { backgroundColor: ios.blue + '20' }]}>
                <Ionicons name="shield-checkmark" size={20} color={ios.blue} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.serviceInfoCardTitle, { color: ios.label }]} numberOfLines={1}>
                {displayTitle}
              </Text>
              <Text style={[styles.serviceInfoCardSub, { color: ios.secondaryLabel }]}>
                Batafsil ko'rish
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={ios.tertiaryLabel} />
          </TouchableOpacity>
        </ScrollView>

      </SafeAreaView>
    </View>
  );
}

/* ══════════════════════════════════════════════ */
/*                    STYLES                     */
/* ══════════════════════════════════════════════ */
const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 36) : 0,
  },

  /* ── Navbar ── */
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navBackBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navCenter: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLogo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginBottom: 2,
  },
  navLogoFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  navLogoInitial: {
    fontSize: 16,
    fontWeight: '600',
  },
  navTitleWrap: { alignItems: 'center' },
  navTitle: { fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },

  /* ── Content ── */
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 50, gap: 16 },

  timeCenter: {
    alignItems: 'center',
    marginBottom: 4,
  },
  timeCenterText: {
    fontSize: 12,
    fontWeight: '400',
  },

  /* ── Message Bubble ── */
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    maxWidth: '85%',
  },
  bubbleAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 6,
  },
  bubbleAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  bubbleAvatarInitial: {
    fontSize: 12,
    fontWeight: '600',
  },
  messageBubble: {
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '100%',
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
  },

  /* ── Service Info Card ── */
  serviceInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
  },
  serviceInfoCardLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  serviceInfoCardFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  serviceInfoCardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  serviceInfoCardSub: {
    fontSize: 13,
    marginTop: 2,
  },

  /* ══════════════════════════════════════════ */
  /*       FULLSCREEN SERVICE INFO STYLES      */
  /* ══════════════════════════════════════════ */
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  blurLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fullscreenSafeArea: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 36) : 0,
  },
  serviceInfoHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  serviceInfoScroll: {
    flex: 1,
  },
  serviceInfoScrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },

  /* ── Logo Section ── */
  serviceLogoSection: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 32,
  },
  serviceLargeLogo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  serviceLargeLogoFallback: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  serviceLargeInitial: {
    fontSize: 42,
    fontWeight: '600',
  },
  serviceDisplayTitle: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.35,
    textAlign: 'center',
    marginBottom: 4,
  },
  serviceDisplayName: {
    fontSize: 15,
    fontWeight: '400',
  },

  /* ── Info Group Cards ── */
  infoGroupCard: {
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  infoCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoCardIcon: {
    width: 30,
    height: 30,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoCardContent: {
    flex: 1,
    marginLeft: 12,
  },
  infoCardLabel: {
    fontSize: 12,
    fontWeight: '400',
    marginBottom: 2,
  },
  infoCardValue: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
  },
  infoCardLogoPreview: {
    width: 56,
    height: 56,
    borderRadius: 12,
    marginTop: 6,
  },

  /* ── Footer ── */
  serviceInfoFooter: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 10 : 16,
  },
  fullCloseBtn: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  fullCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
});