import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Platform,
  Animated,
  Dimensions,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { notificationService, authService, parseApiError, getFullLogoUrl } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { requestPushPermissions, sendLocalPushNotification } from '../services/pushNotifications';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 340);

interface NotificationItem {
  id: string;
  service_id?: string;
  service_name?: string;
  logo_url?: string;
  message: string;
  is_read?: boolean;
  sent_at?: string;
  created_at?: string;
}

interface ServiceItem {
  id: string;
  name: string;
  title: string;
  logo_url?: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  latestMessage?: string;
  count: number;
}

const ALL_SERVICES_ID = 'all';

export default function NotificationsScreen() {
  const { theme, colors, toggleTheme } = useTheme();
  const { showToast } = useToast();

  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userInfo, setUserInfo] = useState<{ id?: string; full_name?: string; phone_number?: string } | null>(null);

  // Track known notification IDs to trigger push notification for new ones
  const previousNotifIdsRef = useRef<Set<string>>(new Set());

  // Left Drawer state & animation
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>(ALL_SERVICES_ID);
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  const toggleDrawer = (open: boolean) => {
    setIsDrawerOpen(open);
    Animated.parallel([
      Animated.timing(drawerAnim, {
        toValue: open ? 0 : -DRAWER_WIDTH,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: open ? 1 : 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const fetchUser = async () => {
    try {
      const data = await authService.getCurrentUser();
      setUserInfo(data);
    } catch (err: any) {
      console.log('User fetch info:', parseApiError(err));
    }
  };

  const fetchNotifications = useCallback(async (isInitial = false) => {
    try {
      const data = await notificationService.getNotifications();
      let rawItems: NotificationItem[] = [];

      if (Array.isArray(data)) {
        rawItems = data;
      } else if (data && Array.isArray(data.items)) {
        rawItems = data.items;
      }

      setList(rawItems);

      // Detect new incoming notifications from services and trigger Phone Push Notifications
      if (!isInitial && rawItems.length > 0) {
        const previousIds = previousNotifIdsRef.current;
        const newItems = rawItems.filter((item) => item.id && !previousIds.has(item.id));

        newItems.forEach((newItem) => {
          sendLocalPushNotification({
            title: newItem.service_name || 'Xizmatdan yangi xabar',
            body: newItem.message,
            data: { notificationId: newItem.id, serviceId: newItem.service_id },
          });
        });
      }

      // Update known IDs reference
      const currentIds = new Set<string>();
      rawItems.forEach((item) => {
        if (item.id) currentIds.add(item.id);
      });
      previousNotifIdsRef.current = currentIds;
    } catch (err: any) {
      if (err.response?.status !== 401) {
        const friendlyError = parseApiError(err);
        showToast({
          type: 'error',
          title: 'Xabarlarni yuklashda xatolik',
          message: friendlyError,
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    // Request push notification permissions on mount
    requestPushPermissions();
    fetchUser();
    fetchNotifications(true);
  }, [fetchNotifications]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchNotifications(false);
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id);
      setList((prev) =>
        prev.map((item) => (item.id === id ? { ...item, is_read: true } : item))
      );
    } catch (err: any) {
      // Optimistic update
      setList((prev) =>
        prev.map((item) => (item.id === id ? { ...item, is_read: true } : item))
      );
    }
  };

  const handleLogout = () => {
    Alert.alert('Chiqish', 'Tizimdan chiqishni xohlaysizmi?', [
      { text: 'Bekor qilish', style: 'cancel' },
      {
        text: 'Chiqish',
        style: 'destructive',
        onPress: async () => {
          await authService.logout();
          router.replace('/login');
        },
      },
    ]);
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return isoString;
      const today = new Date();
      const isToday = date.toDateString() === today.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Bugun, ${timeStr}`;
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
    } catch (e) {
      return isoString;
    }
  };

  // DYNAMICALLY GENERATE SERVICES LIST FROM ACTUAL FETCHED NOTIFICATIONS DATA
  // No hardcoded sample services!
  const servicesList: ServiceItem[] = React.useMemo(() => {
    const allServiceItem: ServiceItem = {
      id: ALL_SERVICES_ID,
      name: 'all',
      title: 'Barcha Xizmatlar',
      icon: 'apps-sharp',
      color: colors.accent,
      latestMessage: list.length > 0 ? list[0].message : 'Barcha xizmatlardan kelgan bildirishnomalar',
      count: list.length,
    };

    const map = new Map<string, ServiceItem>();

    list.forEach((item) => {
      const srvId = item.service_id || item.service_name || 'default_service';
      const srvTitle = item.service_name || 'Xizmat Push Notification';

      if (!map.has(srvId)) {
        map.set(srvId, {
          id: srvId,
          name: srvId,
          title: srvTitle,
          logo_url: item.logo_url,
          icon: 'shield-checkmark-sharp',
          color: '#3b82f6',
          latestMessage: item.message,
          count: 1,
        });
      } else {
        const existing = map.get(srvId)!;
        existing.count += 1;
      }
    });

    return [allServiceItem, ...Array.from(map.values())];
  }, [list, colors.accent]);

  const filteredNotifications = list.filter((item) => {
    if (selectedServiceId === ALL_SERVICES_ID) return true;
    const srvId = item.service_id || item.service_name || 'default_service';
    return srvId === selectedServiceId;
  });

  const selectedServiceObj =
    servicesList.find((s) => s.id === selectedServiceId) || servicesList[0];

  return (
    <LinearGradient colors={colors.bg} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* TOP NAVIGATION BAR */}
        <View style={styles.topBar}>
          {/* Hamburger Drawer Toggle */}
          <TouchableOpacity
            style={[styles.hamburgerBtn, { borderColor: colors.cardBorder, backgroundColor: colors.cardBg }]}
            onPress={() => toggleDrawer(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="menu-sharp" size={24} color={colors.accent} />
          </TouchableOpacity>

          {/* User Info Header */}
          <View style={styles.userHead}>
            <Text style={[styles.userNameText, { color: colors.textPrimary }]} numberOfLines={1}>
              {userInfo?.full_name || 'Foydalanuvchi'}
            </Text>
            <Text style={[styles.userSubText, { color: colors.textMuted }]} numberOfLines={1}>
              {userInfo?.phone_number || 'Authenticator Active'}
            </Text>
          </View>

          {/* Actions: Theme Toggle & Logout */}
          <View style={styles.topActions}>
            <TouchableOpacity
              style={[styles.iconCircle, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
              onPress={toggleTheme}
            >
              <Ionicons
                name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'}
                size={20}
                color={colors.accent}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.iconCircle, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={20} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ACTIVE SERVICE BANNER */}
        <View style={[styles.activeServiceBanner, { borderColor: colors.cardBorder }]}>
          <LinearGradient colors={[colors.cardBg, 'rgba(0,0,0,0)']} style={styles.bannerInner}>
            <View style={styles.bannerLeft}>
              {selectedServiceObj.logo_url ? (
                <Image source={{ uri: getFullLogoUrl(selectedServiceObj.logo_url) || undefined }} style={styles.serviceLogoImage} />
              ) : (
                <View style={[styles.serviceIconCircle, { backgroundColor: `${selectedServiceObj.color}20` }]}>
                  <Ionicons name={selectedServiceObj.icon} size={22} color={selectedServiceObj.color} />
                </View>
              )}
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={[styles.bannerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                  {selectedServiceObj.title}
                </Text>
                <Text style={[styles.bannerSub, { color: colors.textMuted }]}>
                  {filteredNotifications.length} ta bildirishnoma
                </Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* NOTIFICATIONS LIST */}
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>
              Xabarlar yuklanmoqda...
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredNotifications}
            keyExtractor={(item, index) => item.id?.toString() || index.toString()}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
                colors={[colors.accent]}
              />
            }
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="notifications-off-outline" size={56} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
                  Bildirishnomalar mavjud emas
                </Text>
                <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                  {selectedServiceId === ALL_SERVICES_ID
                    ? 'Hali birorta hamkor xizmatdan bildirishnoma kelmadi. Yangi kelgan xabarlar avtomatik shu yerda koʻrinadi.'
                    : `"${selectedServiceObj.title}" xizmatidan hozircha xabarlar mavjud emas.`}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.glassCard,
                  { backgroundColor: colors.cardBg, borderColor: colors.cardBorder },
                  !item.is_read && { borderColor: colors.accent, borderWidth: 1.5 },
                ]}
                onPress={() => handleMarkAsRead(item.id)}
                activeOpacity={0.8}
              >
                <View style={styles.cardRow}>
                  {item.logo_url ? (
                    <Image source={{ uri: getFullLogoUrl(item.logo_url) || undefined }} style={styles.cardLogoImage} />
                  ) : (
                    <View
                      style={[
                        styles.cardIconCircle,
                        !item.is_read && { backgroundColor: `${colors.accent}20` },
                      ]}
                    >
                      <Ionicons
                        name={item.is_read ? 'mail-open-outline' : 'mail-unread-sharp'}
                        size={20}
                        color={item.is_read ? colors.textMuted : colors.accent}
                      />
                    </View>
                  )}

                  <View style={{ flex: 1, marginLeft: 12 }}>
                    {item.service_name && (
                      <Text style={[styles.cardServiceTag, { color: colors.accent }]}>
                        {item.service_name}
                      </Text>
                    )}
                    <Text style={[styles.cardMsg, { color: colors.textPrimary }]}>
                      {item.message}
                    </Text>
                    <Text style={[styles.cardTime, { color: colors.textMuted }]}>
                      {formatDate(item.sent_at || item.created_at)}
                    </Text>
                  </View>

                  {!item.is_read && (
                    <View style={[styles.unreadGlowDot, { backgroundColor: colors.accent }]} />
                  )}
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* OVERLAY BACKDROP FOR LEFT DRAWER */}
        {isDrawerOpen && (
          <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={1}
              onPress={() => toggleDrawer(false)}
            />
          </Animated.View>
        )}

        {/* DYNAMIC LEFT HAMBURGER SERVICES DRAWER */}
        <Animated.View
          style={[
            styles.drawerContainer,
            {
              transform: [{ translateX: drawerAnim }],
              borderColor: colors.cardBorder,
            },
          ]}
        >
          <LinearGradient colors={colors.drawerBg} style={styles.drawerInner}>
            {/* Drawer Header */}
            <View style={[styles.drawerHeader, { borderBottomColor: colors.cardBorder }]}>
              <View style={styles.drawerHeaderLeft}>
                <View style={[styles.drawerBadge, { backgroundColor: `${colors.accent}20`, borderColor: colors.cardBorder }]}>
                  <Ionicons name="cube-sharp" size={20} color={colors.accent} />
                </View>
                <Text style={[styles.drawerTitle, { color: colors.textPrimary }]}>Services</Text>
              </View>

              <TouchableOpacity style={styles.closeDrawerBtn} onPress={() => toggleDrawer(false)}>
                <Ionicons name="close-sharp" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.drawerSectionLabel, { color: colors.textMuted }]}>
              Faol Xizmatlar Roʻyxati
            </Text>

            {/* Dynamic Services List with Logo, Title & Latest Message */}
            <FlatList
              data={servicesList}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = selectedServiceId === item.id;

                return (
                  <TouchableOpacity
                    style={[
                      styles.serviceDrawerCard,
                      { backgroundColor: colors.cardBg, borderColor: colors.cardBorder },
                      isSelected && {
                        backgroundColor: `${colors.accent}15`,
                        borderColor: colors.accent,
                      },
                    ]}
                    onPress={() => {
                      setSelectedServiceId(item.id);
                      toggleDrawer(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={styles.serviceDrawerHeaderRow}>
                      {item.logo_url ? (
                        <Image source={{ uri: getFullLogoUrl(item.logo_url) || undefined }} style={styles.drawerLogoImage} />
                      ) : (
                        <View style={[styles.serviceDrawerIconBox, { backgroundColor: `${item.color}20` }]}>
                          <Ionicons name={item.icon} size={18} color={item.color} />
                        </View>
                      )}

                      <Text
                        style={[
                          styles.serviceDrawerTitle,
                          { color: colors.textPrimary },
                          isSelected && { color: colors.accent, fontWeight: '700' },
                        ]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>

                      {item.count > 0 && (
                        <View style={[styles.countBadge, { backgroundColor: isSelected ? colors.accent : 'rgba(255, 255, 255, 0.1)' }]}>
                          <Text style={[styles.countText, { color: isSelected ? '#000' : colors.textPrimary }]}>
                            {item.count}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Latest message underneath service title */}
                    {item.latestMessage && (
                      <Text
                        style={[styles.serviceDrawerSubMessage, { color: colors.textMuted }]}
                        numberOfLines={2}
                      >
                        {item.latestMessage}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              }}
            />

            {/* Drawer Footer */}
            <View style={[styles.drawerFooter, { borderTopColor: colors.cardBorder }]}>
              <View style={styles.footerInfoBox}>
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} />
                <Text style={[styles.footerText, { color: colors.textMuted }]}>
                  Partner Push API v1.0 • Immediate Auth
                </Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? 36 : 0,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  hamburgerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  userHead: {
    flex: 1,
    marginHorizontal: 12,
    alignItems: 'flex-start',
  },
  userNameText: {
    fontSize: 15,
    fontWeight: '700',
  },
  userSubText: {
    fontSize: 12,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  activeServiceBanner: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 14,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
  },
  bannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  serviceIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  serviceLogoImage: {
    width: 42,
    height: 42,
    borderRadius: 12,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  bannerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  glassCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardLogoImage: {
    width: 40,
    height: 40,
    borderRadius: 12,
  },
  cardServiceTag: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  cardMsg: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  cardTime: {
    fontSize: 11,
    marginTop: 4,
  },
  unreadGlowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginTop: 14,
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 30,
    lineHeight: 18,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    zIndex: 90,
  },
  drawerContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    zIndex: 100,
    borderRightWidth: 1,
  },
  drawerInner: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 16,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  drawerHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  drawerBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
  },
  drawerTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeDrawerBtn: {
    padding: 6,
  },
  drawerSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  serviceDrawerCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  serviceDrawerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceDrawerIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  drawerLogoImage: {
    width: 32,
    height: 32,
    borderRadius: 10,
    marginRight: 10,
  },
  serviceDrawerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 6,
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
  },
  serviceDrawerSubMessage: {
    fontSize: 12,
    marginTop: 6,
    lineHeight: 16,
    paddingLeft: 42,
  },
  drawerFooter: {
    paddingVertical: 16,
    borderTopWidth: 1,
    marginTop: 10,
  },
  footerInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    fontSize: 11,
    marginLeft: 6,
  },
});
