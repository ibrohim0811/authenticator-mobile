import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import OwnerPanelModal from '../components/OwnerPanelModal';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { authService, getFullLogoUrl, notificationService, parseApiError, servicesService } from '../services/api';
import { requestPushPermissions, sendLocalPushNotification } from '../services/pushNotifications';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface NotificationItem {
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

interface ConversationGroup {
  serviceId: string;
  serviceName: string;
  serviceTitle: string;
  logoUrl?: string;
  about?: string;
  lastMessage: string;
  lastTime: string;
  unreadCount: number;
  totalCount: number;
  notifications: NotificationItem[];
}

/* ── Logo yuklanmasa (404 va h.k.) bosh harfli avatar ko'rsatadi ── */
function ServiceAvatar({
  uri,
  title,
  size,
  color,
}: {
  uri?: string | null;
  title: string;
  size: number;
  color: string;
}) {
  const [failed, setFailed] = useState(false);

  // URL o'zgarsa, qaytadan urinib ko'ramiz
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color + '20',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.43, fontWeight: '600', color }}>
        {(title || 'S').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export default function NotificationsScreen() {
  const { theme, colors, toggleTheme } = useTheme();
  const { showToast } = useToast();
  const isDark = theme === 'dark';

  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userInfo, setUserInfo] = useState<{ id?: string; full_name?: string; phone_number?: string; role?: string } | null>(null);
  const [isPrivileged, setIsPrivileged] = useState(false);

  // Owner Panel Modal State
  const [ownerModalVisible, setOwnerModalVisible] = useState(false);

  // Service info cache
  const [serviceCache, setServiceCache] = useState<Record<string, { name: string; title: string; logo_url?: string; about?: string }>>({});

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);

  // Filter mode: all | unread
  const [filterMode, setFilterMode] = useState<'all' | 'unread'>('all');

  // Service detail modal
  const [selectedService, setSelectedService] = useState<ConversationGroup | null>(null);
  const [serviceModalVisible, setServiceModalVisible] = useState(false);

  // Track known notification IDs
  const previousNotifIdsRef = useRef<Set<string>>(new Set());

  // Animations
  const scrollY = useRef(new Animated.Value(0)).current;

  const fetchUser = async () => {
    try {
      const data = await authService.getCurrentUser();
      if (data) setUserInfo(data);
      const role = await authService.getUserRole();
      const resolvedRole = (data?.role ? String(data.role).toLowerCase() : null) || (role ? role.toLowerCase() : null);
      const privileged = resolvedRole === 'owner' || resolvedRole === 'admin';
      setIsPrivileged(privileged);
    } catch (err: any) {
      console.log('User fetch info error:', parseApiError(err));
    }
  };

  const fetchServiceCache = async (): Promise<Record<string, { name: string; title: string; logo_url?: string; about?: string }>> => {
    try {
      const services = await servicesService.getServices();
      const cache: Record<string, { name: string; title: string; logo_url?: string; about?: string }> = {};
      services.forEach((s: any) => {
        if (s.id) {
          cache[s.id] = { name: s.name, title: s.title, logo_url: s.logo_url, about: s.about };
        }
      });
      setServiceCache(cache);
      return cache;
    } catch {
      // non-owner users get 403 — fine
      return {};
    }
  };

  const fetchNotifications = useCallback(async (isInitial = false, cacheOverride?: Record<string, { name: string; title: string; logo_url?: string; about?: string }>) => {
    const effectiveCache = cacheOverride ?? serviceCache;
    try {
      const data = await notificationService.getNotifications();
      let rawItems: NotificationItem[] = [];

      if (Array.isArray(data)) {
        rawItems = data;
      } else if (data && Array.isArray(data.items)) {
        rawItems = data.items;
      }

      // Merge service cache info
      rawItems = rawItems.map((item) => {
        const cached = item.service_id ? effectiveCache[item.service_id] : undefined;
        return {
          ...item,
          service_name: item.service_name || cached?.name,
          service_title: item.service_title || cached?.title,
          logo_url: item.logo_url || cached?.logo_url,
          about: item.about || cached?.about,
        };
      });

      setList(rawItems);

      // Detect new notifications and trigger push
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
  }, [showToast, serviceCache]);

  useEffect(() => {
    const init = async () => {
      requestPushPermissions();
      fetchUser();
      // Service cache AVVAL to'ldiriladi, keyin notificationlar olinadi
      const cache = await fetchServiceCache();
      fetchNotifications(true, cache);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    fetchUser();
    // Refresh da ham avval cache, keyin notificationlar
    const cache = await fetchServiceCache();
    fetchNotifications(false, cache);
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id);
      setList((prev) => prev.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
    } catch {
      setList((prev) => prev.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
    }
  };

  const handleMarkAllAsRead = async () => {
    const unreadItems = list.filter((n) => !n.is_read);
    if (unreadItems.length === 0) {
      showToast({ type: 'info', title: 'Barchasi oʻqilgan', message: 'Oʻqilmagan yangi bildirishnomalar yoʻq.' });
      return;
    }
    setList((prev) => prev.map((item) => ({ ...item, is_read: true })));
    for (const item of unreadItems) {
      try { await notificationService.markAsRead(item.id); } catch { /* continue */ }
    }
    showToast({ type: 'success', title: 'Barchasi oʻqildi', message: 'Barcha bildirishnomalar oʻqilgan deb belgilandi.' });
  };

  const handleOpenNotification = (item: NotificationItem) => {
    if (!item.is_read) handleMarkAsRead(item.id);
    router.push({
      pathname: '/notification-detail' as any,
      params: {
        id: item.id,
        service_id: item.service_id ?? '',
        service_name: item.service_name ?? '',
        service_title: item.service_title ?? item.service_name ?? '',
        logo_url: item.logo_url ?? '',
        about: item.about ?? '',
        message: item.message,
        sent_at: item.sent_at ?? '',
        created_at: item.created_at ?? '',
      },
    });
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

  /* ── Date formatting (iOS Messages style) ── */
  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return isoString;
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMin < 1) return 'Hozir';
      if (diffMin < 60) return `${diffMin} daq`;
      if (diffHours < 24 && date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      if (diffDays === 1) return 'Kecha';
      if (diffDays < 7) {
        const days = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];
        return days[date.getDay()];
      }
      return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  };

  /* ── Group notifications into conversations (like iOS Messages) ── */
  const conversations: ConversationGroup[] = React.useMemo(() => {
    const map = new Map<string, ConversationGroup>();

    list.forEach((item) => {
      const srvId = item.service_id || item.service_name || 'default';
      const srvName = item.service_name || 'Xizmat';
      const srvTitle = item.service_title || item.service_name || 'Hamkor Xizmat';

      if (!map.has(srvId)) {
        map.set(srvId, {
          serviceId: srvId,
          serviceName: srvName,
          serviceTitle: srvTitle,
          logoUrl: item.logo_url,
          about: item.about,
          lastMessage: item.message,
          lastTime: item.sent_at || item.created_at || '',
          unreadCount: item.is_read ? 0 : 1,
          totalCount: 1,
          notifications: [item],
        });
      } else {
        const group = map.get(srvId)!;
        group.totalCount += 1;
        if (!item.is_read) group.unreadCount += 1;
        group.notifications.push(item);
        // Keep latest message at top
        const itemTime = new Date(item.sent_at || item.created_at || 0).getTime();
        const groupTime = new Date(group.lastTime || 0).getTime();
        if (itemTime > groupTime) {
          group.lastMessage = item.message;
          group.lastTime = item.sent_at || item.created_at || '';
          group.logoUrl = group.logoUrl || item.logo_url;
          group.about = group.about || item.about;
        }
      }
    });

    // Sort by last message time (newest first)
    return Array.from(map.values()).sort((a, b) => {
      const ta = new Date(a.lastTime || 0).getTime();
      const tb = new Date(b.lastTime || 0).getTime();
      return tb - ta;
    });
  }, [list]);

  /* ── Filtered conversations ── */
  const filteredConversations = conversations.filter((conv) => {
    if (filterMode === 'unread' && conv.unreadCount === 0) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return (
        conv.serviceTitle.toLowerCase().includes(q) ||
        conv.serviceName.toLowerCase().includes(q) ||
        conv.lastMessage.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalUnread = list.filter((n) => !n.is_read).length;

  /* ── iOS-style colors ── */
  const iosColors = {
    bg: isDark ? '#000000' : '#FFFFFF',
    secondaryBg: isDark ? '#1C1C1E' : '#F2F2F7',
    separator: isDark ? 'rgba(84,84,88,0.65)' : 'rgba(60,60,67,0.12)',
    label: isDark ? '#FFFFFF' : '#000000',
    secondaryLabel: isDark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)',
    tertiaryLabel: isDark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)',
    blue: '#007AFF',
    green: '#34C759',
    red: '#FF3B30',
    searchBg: isDark ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)',
    badgeBg: '#007AFF',
  };

  /* ── Handle open conversation (go to latest notification) ── */
  const handleOpenConversation = (conv: ConversationGroup) => {
    // Find the latest notification
    const sorted = [...conv.notifications].sort((a, b) => {
      const ta = new Date(a.sent_at || a.created_at || 0).getTime();
      const tb = new Date(b.sent_at || b.created_at || 0).getTime();
      return tb - ta;
    });
    if (sorted.length > 0) {
      handleOpenNotification(sorted[0]);
    }
  };

  /* ── Show service info modal ── */
  const handleShowServiceInfo = (conv: ConversationGroup) => {
    setSelectedService(conv);
    setServiceModalVisible(true);
  };

  /* ── Render conversation cell (iOS Messages style) ── */
  const renderConversation = ({ item: conv }: { item: ConversationGroup }) => {
    const logoUri = conv.logoUrl ? getFullLogoUrl(conv.logoUrl) : null;
    const hasUnread = conv.unreadCount > 0;
    const timeStr = formatTimeAgo(conv.lastTime);

    return (
      <TouchableOpacity
        style={styles.conversationCell}
        onPress={() => handleOpenConversation(conv)}
        onLongPress={() => handleShowServiceInfo(conv)}
        activeOpacity={0.6}
      >
        {/* Avatar */}
        <TouchableOpacity
          onPress={() => handleShowServiceInfo(conv)}
          activeOpacity={0.7}
        >
          <ServiceAvatar
            uri={logoUri}
            title={conv.serviceTitle}
            size={56}
            color={iosColors.blue}
          />
        </TouchableOpacity>

        {/* Content */}
        <View style={styles.conversationContent}>
          {/* Top row: title + time */}
          <View style={styles.conversationTopRow}>
            <Text
              style={[
                styles.conversationTitle,
                { color: iosColors.label },
                hasUnread && styles.conversationTitleBold,
              ]}
              numberOfLines={1}
            >
              {conv.serviceTitle}
            </Text>
            <View style={styles.timeChevronRow}>
              <Text style={[styles.conversationTime, { color: hasUnread ? iosColors.blue : iosColors.secondaryLabel }]}>
                {timeStr}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={iosColors.tertiaryLabel} style={{ marginLeft: 4 }} />
            </View>
          </View>

          {/* Bottom row: last message + badge */}
          <View style={styles.conversationBottomRow}>
            <Text
              style={[
                styles.conversationPreview,
                { color: iosColors.secondaryLabel },
                hasUnread && { color: isDark ? '#EBEBF5' : '#3C3C43' },
              ]}
              numberOfLines={2}
            >
              {conv.lastMessage}
            </Text>
            {hasUnread && (
              <View style={[styles.unreadBadge, { backgroundColor: iosColors.badgeBg }]}>
                <Text style={styles.unreadBadgeText}>{conv.unreadCount}</Text>
              </View>
            )}
          </View>

          {/* Separator line */}
          <View style={[styles.cellSeparator, { backgroundColor: iosColors.separator }]} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: iosColors.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safeArea}>

        {/* ─── iOS-style Header ─── */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            {/* Edit / Admin button */}
            {isPrivileged ? (
              <TouchableOpacity onPress={() => setOwnerModalVisible(true)} activeOpacity={0.6}>
                <Text style={[styles.headerAction, { color: iosColors.blue }]}>Boshqaruv</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={toggleTheme} activeOpacity={0.6}>
                <Ionicons
                  name={isDark ? 'sunny-outline' : 'moon-outline'}
                  size={22}
                  color={iosColors.blue}
                />
              </TouchableOpacity>
            )}

            {/* Right side actions */}
            <View style={styles.headerRightActions}>
              {isPrivileged && (
                <TouchableOpacity onPress={toggleTheme} activeOpacity={0.6} style={{ marginRight: 20 }}>
                  <Ionicons
                    name={isDark ? 'sunny-outline' : 'moon-outline'}
                    size={22}
                    color={iosColors.blue}
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleLogout} activeOpacity={0.6}>
                <Ionicons name="log-out-outline" size={22} color={iosColors.red} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Large title */}
          <Text style={[styles.largeTitle, { color: iosColors.label }]}>Xabarlar</Text>

          {/* User info subtitle */}
          <View style={styles.userInfoRow}>
            <Text style={[styles.userInfoText, { color: iosColors.secondaryLabel }]}>
              {userInfo?.full_name || 'Foydalanuvchi'}
            </Text>
            {isPrivileged && (
              <View style={[styles.roleBadge, { backgroundColor: userInfo?.role?.toLowerCase() === 'admin' ? '#6366f1' : '#F59E0B' }]}>
                <Text style={styles.roleBadgeText}>{userInfo?.role?.toUpperCase() ?? 'ADMIN'}</Text>
              </View>
            )}
          </View>

          {/* iOS Search bar */}
          <View style={[styles.searchBar, { backgroundColor: iosColors.searchBg }]}>
            <Ionicons name="search" size={16} color={iosColors.secondaryLabel} />
            <TextInput
              style={[styles.searchInput, { color: iosColors.label }]}
              placeholder="Qidirish"
              placeholderTextColor={iosColors.secondaryLabel}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setIsSearchActive(true)}
              onBlur={() => { if (!searchQuery) setIsSearchActive(false); }}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setIsSearchActive(false); }}>
                <Ionicons name="close-circle" size={16} color={iosColors.secondaryLabel} />
              </TouchableOpacity>
            )}
          </View>

          {/* Filter pills (iOS style segmented) */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[
                styles.filterChip,
                { backgroundColor: filterMode === 'all' ? iosColors.blue : iosColors.searchBg },
              ]}
              onPress={() => setFilterMode('all')}
            >
              <Text style={[styles.filterChipText, { color: filterMode === 'all' ? '#FFFFFF' : iosColors.secondaryLabel }]}>
                Barchasi
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterChip,
                { backgroundColor: filterMode === 'unread' ? iosColors.blue : iosColors.searchBg },
              ]}
              onPress={() => setFilterMode('unread')}
            >
              <Text style={[styles.filterChipText, { color: filterMode === 'unread' ? '#FFFFFF' : iosColors.secondaryLabel }]}>
                O'qilmagan {totalUnread > 0 ? `(${totalUnread})` : ''}
              </Text>
            </TouchableOpacity>

            {/* Mark all as read */}
            <TouchableOpacity
              style={[styles.filterChip, { backgroundColor: iosColors.searchBg, marginLeft: 'auto' }]}
              onPress={handleMarkAllAsRead}
            >
              <Ionicons name="checkmark-done" size={14} color={iosColors.blue} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── Conversation List ─── */}
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={iosColors.blue} />
            <Text style={[styles.loadingText, { color: iosColors.secondaryLabel }]}>
              Xabarlar yuklanmoqda...
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredConversations}
            keyExtractor={(item) => item.serviceId}
            renderItem={renderConversation}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={iosColors.blue}
                colors={[iosColors.blue]}
              />
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIconWrap, { backgroundColor: iosColors.searchBg }]}>
                  <Ionicons name="chatbubbles-outline" size={48} color={iosColors.tertiaryLabel} />
                </View>
                <Text style={[styles.emptyTitle, { color: iosColors.label }]}>
                  Xabarlar yo'q
                </Text>
                <Text style={[styles.emptySub, { color: iosColors.secondaryLabel }]}>
                  {searchQuery
                    ? `"${searchQuery}" bo'yicha natija topilmadi`
                    : "Yangi xabarlar kelganda shu yerda ko'rinadi"}
                </Text>
              </View>
            }
          />
        )}

        {/* ─── Service Info Modal (iOS style) ─── */}
        <Modal
          visible={serviceModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setServiceModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setServiceModalVisible(false)} />

            <View style={[styles.serviceModal, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }]}>
              {/* Handle */}
              <View style={[styles.modalHandle, { backgroundColor: iosColors.tertiaryLabel }]} />

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
                {/* Logo */}
                <View style={styles.modalLogoWrap}>
                  <ServiceAvatar
                    uri={selectedService?.logoUrl ? getFullLogoUrl(selectedService.logoUrl) : null}
                    title={selectedService?.serviceTitle || 'Xizmat'}
                    size={80}
                    color={iosColors.blue}
                  />
                </View>

                {/* Title */}
                <Text style={[styles.modalTitle, { color: iosColors.label }]}>
                  {selectedService?.serviceTitle || 'Xizmat'}
                </Text>

                {/* Info cards (iOS grouped style) */}
                <View style={[styles.modalInfoGroup, { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}>
                  {/* Name */}
                  {selectedService?.serviceName ? (
                    <View style={[styles.modalInfoRow, { borderBottomColor: iosColors.separator }]}>
                      <View style={[styles.modalInfoIcon, { backgroundColor: '#34C759' }]}>
                        <Ionicons name="at-outline" size={16} color="#FFFFFF" />
                      </View>
                      <View style={styles.modalInfoContent}>
                        <Text style={[styles.modalInfoLabel, { color: iosColors.secondaryLabel }]}>Nomi</Text>
                        <Text style={[styles.modalInfoValue, { color: iosColors.label }]}>{selectedService.serviceName}</Text>
                      </View>
                    </View>
                  ) : null}

                  {/* Title */}
                  {selectedService?.serviceTitle ? (
                    <View style={[styles.modalInfoRow, { borderBottomColor: iosColors.separator }]}>
                      <View style={[styles.modalInfoIcon, { backgroundColor: '#007AFF' }]}>
                        <Ionicons name="text-outline" size={16} color="#FFFFFF" />
                      </View>
                      <View style={styles.modalInfoContent}>
                        <Text style={[styles.modalInfoLabel, { color: iosColors.secondaryLabel }]}>Sarlavha</Text>
                        <Text style={[styles.modalInfoValue, { color: iosColors.label }]}>{selectedService.serviceTitle}</Text>
                      </View>
                    </View>
                  ) : null}

                  {/* About */}
                  {selectedService?.about ? (
                    <View style={[styles.modalInfoRow, { borderBottomWidth: 0 }]}>
                      <View style={[styles.modalInfoIcon, { backgroundColor: '#FF9500' }]}>
                        <Ionicons name="information-circle-outline" size={16} color="#FFFFFF" />
                      </View>
                      <View style={styles.modalInfoContent}>
                        <Text style={[styles.modalInfoLabel, { color: iosColors.secondaryLabel }]}>Haqida</Text>
                        <Text style={[styles.modalInfoValue, { color: iosColors.label }]}>{selectedService.about}</Text>
                      </View>
                    </View>
                  ) : null}
                </View>

                {/* Stats */}
                <View style={[styles.modalInfoGroup, { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}>
                  <View style={[styles.modalInfoRow, { borderBottomColor: iosColors.separator }]}>
                    <View style={[styles.modalInfoIcon, { backgroundColor: '#5856D6' }]}>
                      <Ionicons name="mail-outline" size={16} color="#FFFFFF" />
                    </View>
                    <View style={styles.modalInfoContent}>
                      <Text style={[styles.modalInfoLabel, { color: iosColors.secondaryLabel }]}>Jami xabarlar</Text>
                      <Text style={[styles.modalInfoValue, { color: iosColors.label }]}>{selectedService?.totalCount || 0}</Text>
                    </View>
                  </View>

                  <View style={[styles.modalInfoRow, { borderBottomWidth: 0 }]}>
                    <View style={[styles.modalInfoIcon, { backgroundColor: '#FF3B30' }]}>
                      <Ionicons name="mail-unread-outline" size={16} color="#FFFFFF" />
                    </View>
                    <View style={styles.modalInfoContent}>
                      <Text style={[styles.modalInfoLabel, { color: iosColors.secondaryLabel }]}>O'qilmagan</Text>
                      <Text style={[styles.modalInfoValue, { color: iosColors.label }]}>{selectedService?.unreadCount || 0}</Text>
                    </View>
                  </View>
                </View>
              </ScrollView>

              {/* Close */}
              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: iosColors.blue }]}
                onPress={() => setServiceModalVisible(false)}
              >
                <Text style={styles.modalCloseBtnText}>Yopish</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* OWNER ADMIN PANEL MODAL */}
        <OwnerPanelModal
          visible={ownerModalVisible}
          onClose={() => setOwnerModalVisible(false)}
          onServiceCreated={() => fetchNotifications(false)}
          userRole={userInfo?.role}
        />

      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 36) : 0,
  },

  /* ── Header (iOS Messages style) ── */
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  headerAction: {
    fontSize: 17,
    fontWeight: '400',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0.37,
    marginBottom: 4,
  },
  userInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  userInfoText: {
    fontSize: 13,
    fontWeight: '400',
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  roleBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  /* ── Search Bar ── */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    marginLeft: 6,
    paddingVertical: 0,
  },

  /* ── Filter Row ── */
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* ── Conversation Cell ── */
  conversationCell: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: 16,
    paddingVertical: 10,
  },
  conversationContent: {
    flex: 1,
    marginLeft: 12,
    paddingRight: 16,
  },
  conversationTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  conversationTitle: {
    fontSize: 16,
    fontWeight: '400',
    flex: 1,
    marginRight: 8,
  },
  conversationTitleBold: {
    fontWeight: '700',
  },
  timeChevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  conversationTime: {
    fontSize: 14,
    fontWeight: '400',
  },
  conversationBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  conversationPreview: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '400',
    flex: 1,
    marginRight: 8,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginTop: 2,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  cellSeparator: {
    height: StyleSheet.hairlineWidth,
    marginTop: 10,
  },

  /* ── List ── */
  listContent: {
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
  },

  /* ── Empty State ── */
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 20,
  },

  /* ── Service Info Modal ── */
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  serviceModal: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '80%',
  },
  modalHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalLogoWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.35,
    marginBottom: 20,
  },
  modalInfoGroup: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  modalInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalInfoIcon: {
    width: 30,
    height: 30,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalInfoContent: {
    flex: 1,
    marginLeft: 12,
  },
  modalInfoLabel: {
    fontSize: 12,
    fontWeight: '400',
    marginBottom: 2,
  },
  modalInfoValue: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  modalCloseBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
});