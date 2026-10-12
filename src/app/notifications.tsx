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
  TextInput,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { notificationService, authService, parseApiError, getFullLogoUrl } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { requestPushPermissions, sendLocalPushNotification } from '../services/pushNotifications';
import OwnerPanelModal from '../components/OwnerPanelModal';

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
  const [userInfo, setUserInfo] = useState<{ id?: string; full_name?: string; phone_number?: string; role?: string } | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // Owner Panel Modal State
  const [ownerModalVisible, setOwnerModalVisible] = useState(false);

  // Notification Detail Modal State
  const [selectedNotif, setSelectedNotif] = useState<NotificationItem | null>(null);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unread'>('all');

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
      if (data) {
        setUserInfo(data);
      }
      const role = await authService.getUserRole();
      const ownerCheck =
        (data?.role && String(data.role).toLowerCase() === 'owner') ||
        (role && role.toLowerCase() === 'owner');
      setIsOwner(Boolean(ownerCheck));
    } catch (err: any) {
      console.log('User fetch info error:', parseApiError(err));
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

      // Detect new incoming notifications and trigger Phone Push Notifications
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
    requestPushPermissions();
    fetchUser();
    fetchNotifications(true);
  }, [fetchNotifications]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchUser();
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

  const handleMarkAllAsRead = async () => {
    const unreadItems = list.filter((n) => !n.is_read);
    if (unreadItems.length === 0) {
      showToast({
        type: 'info',
        title: 'Barchasi oʻqilgan',
        message: 'Oʻqilmagan yangi bildirishnomalar yoʻq.',
      });
      return;
    }

    setList((prev) => prev.map((item) => ({ ...item, is_read: true })));

    for (const item of unreadItems) {
      try {
        await notificationService.markAsRead(item.id);
      } catch (e) {
        // Continue
      }
    }

    showToast({
      type: 'success',
      title: 'Barchasi oʻqildi',
      message: 'Barcha bildirishnomalar oʻqilgan deb belgilandi.',
    });
  };

  const handleOpenNotification = (item: NotificationItem) => {
    setSelectedNotif(item);
    if (!item.is_read) {
      handleMarkAsRead(item.id);
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

  // Dynamically generate services list from fetched notifications
  const servicesList: ServiceItem[] = React.useMemo(() => {
    const allServiceItem: ServiceItem = {
      id: ALL_SERVICES_ID,
      name: 'all',
      title: 'Barcha Xizmatlar',
      icon: 'apps-sharp',
      color: colors.accent,
      latestMessage: list.length > 0 ? list[0].message : 'Barcha xizmatlardan bildirishnomalar',
      count: list.length,
    };

    const map = new Map<string, ServiceItem>();

    list.forEach((item) => {
      const srvId = item.service_id || item.service_name || 'default_service';
      const srvTitle = item.service_name || 'Hamkor Xizmat';

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

  // Filtered notifications
  const filteredNotifications = list.filter((item) => {
    // Service filter
    if (selectedServiceId !== ALL_SERVICES_ID) {
      const srvId = item.service_id || item.service_name || 'default_service';
      if (srvId !== selectedServiceId) return false;
    }

    // Read/Unread filter
    if (filterMode === 'unread' && item.is_read) {
      return false;
    }

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      const matchMsg = item.message?.toLowerCase().includes(query);
      const matchService = item.service_name?.toLowerCase().includes(query);
      return matchMsg || matchService;
    }

    return true;
  });

  const selectedServiceObj =
    servicesList.find((s) => s.id === selectedServiceId) || servicesList[0];

  const unreadCount = list.filter((n) => !n.is_read).length;

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
            <Ionicons name="menu-sharp" size={22} color={colors.accent} />
          </TouchableOpacity>

          {/* User Info Header with Role Badge */}
          <View style={styles.userHead}>
            <View style={styles.userNameRow}>
              <Text style={[styles.userNameText, { color: colors.textPrimary }]} numberOfLines={1}>
                {userInfo?.full_name || 'Foydalanuvchi'}
              </Text>
              {isOwner && (
                <View style={styles.ownerBadge}>
                  <Text style={styles.ownerBadgeText}>OWNER</Text>
                </View>
              )}
            </View>
            <Text style={[styles.userSubText, { color: colors.textMuted }]} numberOfLines={1}>
              {userInfo?.phone_number || 'Faol Seans'}
            </Text>
          </View>

          {/* Top Actions: Admin (Owner Only) | Theme Toggle | Logout */}
          <View style={styles.topActions}>
            {/* ADMIN ICON (ONLY FOR OWNER) */}
            {isOwner && (
              <TouchableOpacity
                style={[
                  styles.iconCircle,
                  styles.adminOwnerBtn,
                  { backgroundColor: 'rgba(234, 179, 8, 0.16)', borderColor: '#eab308' },
                ]}
                onPress={() => setOwnerModalVisible(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="shield-checkmark" size={20} color="#eab308" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.iconCircle, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
              onPress={toggleTheme}
            >
              <Ionicons
                name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'}
                size={18}
                color={colors.accent}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.iconCircle, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={18} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* QUICK STATS & GLANCE BANNER */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>{list.length}</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Jami</Text>
          </View>

          <View style={[styles.statCard, { backgroundColor: colors.cardBg, borderColor: unreadCount > 0 ? colors.accent : colors.cardBorder }]}>
            <Text style={[styles.statValue, { color: unreadCount > 0 ? colors.accent : colors.textPrimary }]}>
              {unreadCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Oʻqilmagan</Text>
          </View>

          <View style={[styles.statCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>{servicesList.length - 1}</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Xizmatlar</Text>
          </View>

          <TouchableOpacity
            style={[styles.markAllBtn, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
            onPress={handleMarkAllAsRead}
          >
            <Ionicons name="checkmark-done" size={18} color={colors.accent} />
            <Text style={[styles.markAllTxt, { color: colors.accent }]}>Oʻqildi</Text>
          </TouchableOpacity>
        </View>

        {/* SEARCH & FILTERS BAR */}
        <View style={styles.searchFilterContainer}>
          <View style={[styles.searchBox, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: colors.textPrimary }]}
              placeholder="Xabarlarni qidirish..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.filterPillsRow}>
            <TouchableOpacity
              style={[
                styles.filterPill,
                filterMode === 'all' && [styles.activeFilterPill, { backgroundColor: colors.accent }],
                { borderColor: colors.cardBorder },
              ]}
              onPress={() => setFilterMode('all')}
            >
              <Text style={[styles.filterPillTxt, { color: filterMode === 'all' ? '#fff' : colors.textMuted }]}>
                Barchasi
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterPill,
                filterMode === 'unread' && [styles.activeFilterPill, { backgroundColor: colors.accent }],
                { borderColor: colors.cardBorder },
              ]}
              onPress={() => setFilterMode('unread')}
            >
              <Text style={[styles.filterPillTxt, { color: filterMode === 'unread' ? '#fff' : colors.textMuted }]}>
                Faqat yangilar ({unreadCount})
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ACTIVE SERVICE BADGE BANNER */}
        {selectedServiceId !== ALL_SERVICES_ID && (
          <View style={[styles.activeFilterBanner, { backgroundColor: `${colors.accent}15`, borderColor: colors.accent }]}>
            <Text style={[styles.activeFilterTxt, { color: colors.accent }]}>
              Filtr: {selectedServiceObj.title}
            </Text>
            <TouchableOpacity onPress={() => setSelectedServiceId(ALL_SERVICES_ID)}>
              <Ionicons name="close" size={16} color={colors.accent} />
            </TouchableOpacity>
          </View>
        )}

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
                  Bildirishnomalar topilmadi
                </Text>
                <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                  {searchQuery
                    ? `"${searchQuery}" boʻyicha birorta ham xabar topilmadi.`
                    : 'Yangi kelgan xabarlar avtomatik shu yerda koʻrinadi.'}
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
                onPress={() => handleOpenNotification(item)}
                activeOpacity={0.8}
              >
                <View style={styles.cardRow}>
                  {item.logo_url ? (
                    <Image
                      source={{ uri: getFullLogoUrl(item.logo_url) || undefined }}
                      style={styles.cardLogoImage}
                    />
                  ) : (
                    <View
                      style={[
                        styles.cardIconCircle,
                        !item.is_read && { backgroundColor: `${colors.accent}20` },
                      ]}
                    >
                      <Ionicons
                        name={item.is_read ? 'mail-open-outline' : 'mail-unread'}
                        size={20}
                        color={item.is_read ? colors.textMuted : colors.accent}
                      />
                    </View>
                  )}

                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.cardTopMeta}>
                      <Text style={[styles.cardServiceTag, { color: colors.accent }]} numberOfLines={1}>
                        {item.service_name || 'Xizmat Bildirishnomasi'}
                      </Text>
                      <Text style={[styles.cardTime, { color: colors.textMuted }]}>
                        {formatDate(item.sent_at || item.created_at)}
                      </Text>
                    </View>

                    <Text style={[styles.cardMsg, { color: colors.textPrimary }]} numberOfLines={2}>
                      {item.message}
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

        {/* OVERLAY BACKDROP FOR DRAWER */}
        {isDrawerOpen && (
          <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={1}
              onPress={() => toggleDrawer(false)}
            />
          </Animated.View>
        )}

        {/* LEFT HAMBURGER SERVICES DRAWER */}
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

            <View style={[styles.drawerFooter, { borderTopColor: colors.cardBorder }]}>
              <View style={styles.footerInfoBox}>
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} />
                <Text style={[styles.footerText, { color: colors.textMuted }]}>
                  Authenticator v1.0 • Immediate Push
                </Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* OWNER ADMIN PANEL MODAL */}
        <OwnerPanelModal
          visible={ownerModalVisible}
          onClose={() => setOwnerModalVisible(false)}
          onServiceCreated={() => fetchNotifications(false)}
        />

        {/* NOTIFICATION DETAIL MODAL */}
        <Modal
          visible={Boolean(selectedNotif)}
          animationType="fade"
          transparent
          onRequestClose={() => setSelectedNotif(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.detailModalCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
              <View style={styles.detailHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  {selectedNotif?.logo_url ? (
                    <Image
                      source={{ uri: getFullLogoUrl(selectedNotif.logo_url) || undefined }}
                      style={styles.detailLogoImg}
                    />
                  ) : (
                    <View style={[styles.detailDefaultLogo, { backgroundColor: `${colors.accent}20` }]}>
                      <Ionicons name="mail" size={20} color={colors.accent} />
                    </View>
                  )}
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={[styles.detailServiceTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                      {selectedNotif?.service_name || 'Xizmat Xabari'}
                    </Text>
                    <Text style={[styles.detailDateTxt, { color: colors.textMuted }]}>
                      {formatDate(selectedNotif?.sent_at || selectedNotif?.created_at)}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.closeDetailBtn, { borderColor: colors.cardBorder }]}
                  onPress={() => setSelectedNotif(null)}
                >
                  <Ionicons name="close" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <View style={[styles.detailDivider, { backgroundColor: colors.cardBorder }]} />

              <Text style={[styles.detailMessageTxt, { color: colors.textPrimary }]}>
                {selectedNotif?.message}
              </Text>

              <TouchableOpacity
                style={[styles.detailDoneBtn, { backgroundColor: colors.accent }]}
                onPress={() => setSelectedNotif(null)}
              >
                <Text style={styles.detailDoneTxt}>Tushunarli</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
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
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  userHead: {
    flex: 1,
    marginHorizontal: 12,
    alignItems: 'flex-start',
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userNameText: {
    fontSize: 15,
    fontWeight: '700',
    maxWidth: 160,
  },
  ownerBadge: {
    backgroundColor: '#eab308',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  ownerBadgeText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  userSubText: {
    fontSize: 12,
    marginTop: 2,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  adminOwnerBtn: {
    borderWidth: 1.5,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  statCard: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  markAllTxt: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchFilterContainer: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  activeFilterPill: {
    borderColor: 'transparent',
  },
  filterPillTxt: {
    fontSize: 12,
    fontWeight: '600',
  },
  activeFilterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  activeFilterTxt: {
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
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
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardLogoImage: {
    width: 38,
    height: 38,
    borderRadius: 12,
  },
  cardTopMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardServiceTag: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  cardMsg: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  cardTime: {
    fontSize: 11,
    marginLeft: 8,
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
    fontSize: 16,
    fontWeight: '700',
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
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  detailModalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailLogoImg: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  detailDefaultLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailServiceTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  detailDateTxt: {
    fontSize: 11,
    marginTop: 2,
  },
  closeDetailBtn: {
    padding: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  detailDivider: {
    height: 1,
    marginVertical: 14,
  },
  detailMessageTxt: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  detailDoneBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  detailDoneTxt: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
