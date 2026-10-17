import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Dimensions,
  Platform,
  Image,
  KeyboardAvoidingView,
  Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { servicesService, parseApiError, getFullLogoUrl } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ServiceItem {
  id: string;
  name: string;
  title: string;
  logo_url?: string | null;
  about?: string | null;
  token?: string;
}

interface OwnerPanelModalProps {
  visible: boolean;
  onClose: () => void;
  onServiceCreated?: () => void;
}

type TabType = 'services' | 'send' | 'register';
type SendType = 'broadcast' | 'single';

export default function OwnerPanelModal({ visible, onClose, onServiceCreated }: OwnerPanelModalProps) {
  const { colors, theme } = useTheme();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<TabType>('services');

  // Services List State
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [revealedTokens, setRevealedTokens] = useState<Record<string, boolean>>({});

  // Service Detail Modal State
  const [selectedServiceDetail, setSelectedServiceDetail] = useState<ServiceItem | null>(null);

  // Register Form State
  const [regName, setRegName] = useState('');
  const [regTitle, setRegTitle] = useState('');
  const [regAbout, setRegAbout] = useState('');
  const [regLogoUrl, setRegLogoUrl] = useState('');
  const [registering, setRegistering] = useState(false);

  // Send Message Form State
  const [sendType, setSendType] = useState<SendType>('broadcast');
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');

  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [targetPhone, setTargetPhone] = useState('+998');
  const [singleMsg, setSingleMsg] = useState('');
  const [sending, setSending] = useState(false);

  // Fetch services when modal opens
  useEffect(() => {
    if (visible) {
      loadServices();
    }
  }, [visible]);

  const loadServices = async () => {
    setLoadingServices(true);
    try {
      const data = await servicesService.getServices();
      // getServices returns [] for 404 ("no services yet") — no error needed
      const list = Array.isArray(data) ? data : [];
      setServices(list);
      if (list.length > 0 && !selectedServiceId) {
        setSelectedServiceId(list[0].id);
        setManualToken(list[0].token || '');
      }
    } catch (err: any) {
      const errStatus = (err as any)?.response?.status;
      // 403 = not owner (expected), 404 = handled in getServices (shouldn't reach here)
      if (errStatus !== 403 && errStatus !== 404) {
        console.warn('Services load error:', parseApiError(err));
        showToast({
          type: 'error',
          title: 'Xizmatlar Yuklanmadi',
          message: parseApiError(err, 'Xizmatlar ro\u02bbxatini olishda xatolik yuz berdi.'),
        });
      }
    } finally {
      setLoadingServices(false);
    }
  };

  const toggleTokenVisibility = (id: string) => {
    setRevealedTokens((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyOrShareToken = async (token?: string, title?: string) => {
    if (!token) return;
    try {
      await Share.share({
        message: `${title ? title + ' Tokeni: ' : ''}${token}`,
      });
      showToast({
        type: 'success',
        title: 'Token Ulashildi',
        message: 'Xizmat tokeni muvaffaqiyatli saqlandi/ulashildi.',
      });
    } catch (err) {
      // Ignored
    }
  };

  // Open service detail modal
  const handleOpenServiceDetail = (service: ServiceItem) => {
    setSelectedServiceDetail(service);
  };

  // Switch to Send Tab with preselected service
  const handleSelectServiceForMessage = (service: ServiceItem) => {
    setSelectedServiceId(service.id);
    setManualToken(service.token || '');
    setSendType('single');
    setActiveTab('send');
  };

  // Register a new service
  const handleRegisterService = async () => {
    if (!regName.trim() || !regTitle.trim()) {
      showToast({
        type: 'error',
        title: 'Yetarli Emas',
        message: 'Xizmat nomi (name) va sarlavhasi (title) kiritilishi shart!',
      });
      return;
    }

    if (regName.trim().length < 3 || regName.trim().length > 50) {
      showToast({
        type: 'error',
        title: 'Nom Uzunligi Xatosi',
        message: 'Xizmat nomi (name) 3 dan 50 belgigacha boʻlishi kerak.',
      });
      return;
    }

    if (regTitle.trim().length < 2 || regTitle.trim().length > 150) {
      showToast({
        type: 'error',
        title: 'Sarlavha Xatosi',
        message: 'Xizmat sarlavhasi 2 dan 150 belgigacha boʻlishi kerak.',
      });
      return;
    }

    setRegistering(true);
    try {
      const res = await servicesService.registerService({
        name: regName.trim(),
        title: regTitle.trim(),
        about: regAbout.trim() || undefined,
        logo: regLogoUrl.trim() ? { uri: regLogoUrl.trim(), name: 'logo.png' } : null,
      });

      showToast({
        type: 'success',
        title: 'Xizmat Yaratildi! 🎉',
        message: `"${regTitle}" muvaffaqiyatli roʻyxatdan oʻtkazildi.`,
      });

      setRegName('');
      setRegTitle('');
      setRegAbout('');
      setRegLogoUrl('');

      await loadServices();
      setActiveTab('services');
      if (onServiceCreated) onServiceCreated();
    } catch (err: any) {
      const friendlyErr = parseApiError(err, 'Servisni roʻyxatdan oʻtkazishda xatolik.');
      showToast({
        type: 'error',
        title: 'Yaratishda Xatolik',
        message: friendlyErr,
      });
    } finally {
      setRegistering(false);
    }
  };

  // Send Broadcast or Single Message
  const handleSendMessage = async () => {
    if (sendType === 'broadcast') {
      if (!broadcastTitle.trim() || !broadcastMsg.trim()) {
        showToast({
          type: 'error',
          title: 'Toʻldirilmagan',
          message: 'Iltimos, sarlavha va xabar matnini toʻliq kiriting.',
        });
        return;
      }

      setSending(true);
      try {
        await servicesService.broadcastMessage({
          title: broadcastTitle.trim(),
          message: broadcastMsg.trim(),
        });

        showToast({
          type: 'success',
          title: 'Broadcast Yuborildi! 🚀',
          message: 'Barcha foydalanuvchilarga xabar yetkazildi.',
        });

        setBroadcastTitle('');
        setBroadcastMsg('');
      } catch (err: any) {
        showToast({
          type: 'error',
          title: 'Yuborishda Xatolik',
          message: parseApiError(err, 'Broadcast xabar yuborishda xatolik yuz berdi.'),
        });
      } finally {
        setSending(false);
      }
    } else {
      // Single User Message
      if (!selectedServiceId) {
        showToast({
          type: 'error',
          title: 'Servis Tanlanmagan',
          message: 'Iltimos, xabar yuboruvchi xizmatni tanlang.',
        });
        return;
      }

      if (!manualToken.trim()) {
        showToast({
          type: 'error',
          title: 'Xizmat Tokeni Kerak',
          message: 'Tanlangan xizmat tokeni kiritilishi shart.',
        });
        return;
      }

      if (!targetPhone.trim() || targetPhone.trim() === '+998') {
        showToast({
          type: 'error',
          title: 'Telefon Raqam Kerak',
          message: 'Qabul qiluvchi telefon raqamini toʻliq kiriting.',
        });
        return;
      }

      if (!singleMsg.trim()) {
        showToast({
          type: 'error',
          title: 'Xabar Matni Boʻsh',
          message: 'Iltimos, yuboriladigan xabar matnini yozing.',
        });
        return;
      }

      setSending(true);
      try {
        const res = await servicesService.sendMessageToUser({
          service_id: selectedServiceId,
          token: manualToken.trim(),
          user_phone: targetPhone.trim(),
          message: singleMsg.trim(),
        });

        const pushNote = res?.push_sent ? ' va Push-bildirishnoma joʻnatildi' : '';
        showToast({
          type: 'success',
          title: 'Xabar Yetkazildi! ✅',
          message: `Foydalanuvchiga xabar saqlandi${pushNote}.`,
        });

        setSingleMsg('');
      } catch (err: any) {
        showToast({
          type: 'error',
          title: 'Yuborishda Xatolik',
          message: parseApiError(err, 'Foydalanuvchiga xabar yuborishda xatolik yuz berdi.'),
        });
      } finally {
        setSending(false);
      }
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <LinearGradient colors={colors.bg} style={styles.container}>
          {/* Top Header */}
          <View style={[styles.header, { borderBottomColor: colors.cardBorder }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.crownBadge, { backgroundColor: 'rgba(234, 179, 8, 0.15)', borderColor: '#eab308' }]}>
                <Ionicons name="shield-checkmark" size={20} color="#eab308" />
              </View>
              <View style={{ marginLeft: 10 }}>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Owner Admin Panel</Text>
                <Text style={[styles.headerSub, { color: colors.textMuted }]}>
                  Xizmatlarni boshqarish & Xabar yuborish
                </Text>
              </View>
            </View>

            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Navigation Tabs */}
          <View style={[styles.tabBar, { borderBottomColor: colors.cardBorder }]}>
            <TouchableOpacity
              style={[
                styles.tabItem,
                activeTab === 'services' && [styles.activeTabItem, { borderBottomColor: colors.accent }],
              ]}
              onPress={() => setActiveTab('services')}
            >
              <Ionicons
                name="layers-outline"
                size={18}
                color={activeTab === 'services' ? colors.accent : colors.textMuted}
              />
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'services' ? colors.accent : colors.textMuted },
                ]}
              >
                Xizmatlar ({services.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabItem,
                activeTab === 'send' && [styles.activeTabItem, { borderBottomColor: colors.accent }],
              ]}
              onPress={() => setActiveTab('send')}
            >
              <Ionicons
                name="paper-plane-outline"
                size={18}
                color={activeTab === 'send' ? colors.accent : colors.textMuted}
              />
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'send' ? colors.accent : colors.textMuted },
                ]}
              >
                Xabar Yuborish
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabItem,
                activeTab === 'register' && [styles.activeTabItem, { borderBottomColor: colors.accent }],
              ]}
              onPress={() => setActiveTab('register')}
            >
              <Ionicons
                name="add-circle-outline"
                size={18}
                color={activeTab === 'register' ? colors.accent : colors.textMuted}
              />
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'register' ? colors.accent : colors.textMuted },
                ]}
              >
                Yangi Servis
              </Text>
            </TouchableOpacity>
          </View>

          {/* Body Content */}
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* TAB 1: SERVICES LIST */}
            {activeTab === 'services' && (
              <View>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                    Faol Hamkor Xizmatlar
                  </Text>
                  <TouchableOpacity
                    style={[styles.refreshIconBtn, { borderColor: colors.cardBorder }]}
                    onPress={loadServices}
                  >
                    <Ionicons name="refresh" size={16} color={colors.accent} />
                  </TouchableOpacity>
                </View>

                {loadingServices ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="large" color={colors.accent} />
                    <Text style={[styles.loadingTxt, { color: colors.textMuted }]}>
                      Xizmatlar yuklanmoqda...
                    </Text>
                  </View>
                ) : services.length === 0 ? (
                  <View style={[styles.emptyCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                    <Ionicons name="cube-outline" size={48} color={colors.textMuted} />
                    <Text style={[styles.emptyCardTitle, { color: colors.textPrimary }]}>
                      Hozircha xizmatlar mavjud emas
                    </Text>
                    <Text style={[styles.emptyCardSub, { color: colors.textMuted }]}>
                      Yangi servis qoʻshish uchun yuqoridagi "Yangi Servis" boʻlimiga oʻting.
                    </Text>
                    <TouchableOpacity
                      style={[styles.smallBtn, { backgroundColor: colors.accent }]}
                      onPress={() => setActiveTab('register')}
                    >
                      <Text style={styles.smallBtnText}>+ Servis Qoʻshish</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  services.map((service) => {
                    const isRevealed = Boolean(revealedTokens[service.id]);
                    return (
                      <TouchableOpacity
                        key={service.id}
                        style={[
                          styles.serviceCard,
                          { backgroundColor: colors.cardBg, borderColor: colors.cardBorder },
                        ]}
                        onPress={() => handleOpenServiceDetail(service)}
                        activeOpacity={0.85}
                      >
                        <View style={styles.serviceHeaderRow}>
                          {service.logo_url ? (
                            <Image
                              source={{ uri: getFullLogoUrl(service.logo_url) || undefined }}
                              style={styles.serviceLogoImg}
                            />
                          ) : (
                            <View style={[styles.serviceDefaultLogo, { backgroundColor: `${colors.accent}20` }]}>
                              <Ionicons name="cube" size={24} color={colors.accent} />
                            </View>
                          )}

                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={[styles.serviceTitleTxt, { color: colors.textPrimary }]} numberOfLines={1}>
                              {service.title}
                            </Text>
                            <Text style={[styles.serviceNameTag, { color: colors.accent }]}>
                              @{service.name}
                            </Text>
                          </View>

                          <TouchableOpacity
                            style={[styles.actionBadgeBtn, { backgroundColor: `${colors.accent}15`, marginRight: 6 }]}
                            onPress={(e) => { e.stopPropagation?.(); handleSelectServiceForMessage(service); }}
                          >
                            <Ionicons name="chatbubble-ellipses" size={16} color={colors.accent} />
                            <Text style={[styles.actionBadgeTxt, { color: colors.accent }]}>Xabar</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.actionBadgeBtn, { backgroundColor: 'rgba(255,255,255,0.06)' }]}
                            onPress={(e) => { e.stopPropagation?.(); handleOpenServiceDetail(service); }}
                          >
                            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>

                        {service.about ? (
                          <Text style={[styles.serviceAboutTxt, { color: colors.textMuted }]} numberOfLines={2}>
                            {service.about}
                          </Text>
                        ) : null}

                        {/* Token Row */}
                        <View style={[styles.tokenBox, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.tokenLabel, { color: colors.textMuted }]}>Service Token:</Text>
                            <Text style={[styles.tokenValue, { color: colors.textPrimary }]} numberOfLines={1}>
                              {isRevealed
                                ? service.token || 'Token koʻrsatilmagan'
                                : '••••••••••••••••••••••••••••••••••••••••'}
                            </Text>
                          </View>

                          <TouchableOpacity
                            style={styles.tokenActionBtn}
                            onPress={() => toggleTokenVisibility(service.id)}
                          >
                            <Ionicons
                              name={isRevealed ? 'eye-off-outline' : 'eye-outline'}
                              size={18}
                              color={colors.textMuted}
                            />
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.tokenActionBtn}
                            onPress={() => copyOrShareToken(service.token, service.title)}
                          >
                            <Ionicons name="share-outline" size={18} color={colors.accent} />
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}

            {/* TAB 2: SEND MESSAGE */}
            {activeTab === 'send' && (
              <View>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                  Xabar Joʻnatish
                </Text>
                <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
                  Tanlangan xizmat orqali foydalanuvchilar telefoniga push va ilova bildirishnomasi yuborish
                </Text>

                {/* Type Switcher */}
                <View style={[styles.typeSwitcher, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                  <TouchableOpacity
                    style={[
                      styles.typeBtn,
                      sendType === 'broadcast' && [styles.typeBtnActive, { backgroundColor: colors.accent }],
                    ]}
                    onPress={() => setSendType('broadcast')}
                  >
                    <Ionicons
                      name="megaphone"
                      size={16}
                      color={sendType === 'broadcast' ? '#ffffff' : colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.typeBtnText,
                        { color: sendType === 'broadcast' ? '#ffffff' : colors.textMuted },
                      ]}
                    >
                      Hammaga (Broadcast)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.typeBtn,
                      sendType === 'single' && [styles.typeBtnActive, { backgroundColor: colors.accent }],
                    ]}
                    onPress={() => setSendType('single')}
                  >
                    <Ionicons
                      name="person"
                      size={16}
                      color={sendType === 'single' ? '#ffffff' : colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.typeBtnText,
                        { color: sendType === 'single' ? '#ffffff' : colors.textMuted },
                      ]}
                    >
                      Bitta Odamga
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* BROADCAST FORM */}
                {sendType === 'broadcast' ? (
                  <View style={[styles.formCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Sarlavha (Title)</Text>
                    <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                      <TextInput
                        style={[styles.input, { color: colors.textPrimary }]}
                        placeholder="Masalan: Yangi Yangilanish 🚀"
                        placeholderTextColor={colors.textMuted}
                        value={broadcastTitle}
                        onChangeText={setBroadcastTitle}
                      />
                    </View>

                    <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                      Xabar Matni (Message)
                    </Text>
                    <View style={[styles.inputWrap, styles.textAreaWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                      <TextInput
                        style={[styles.input, styles.textArea, { color: colors.textPrimary }]}
                        placeholder="Barcha foydalanuvchilarga koʻrinadigan xabar matni..."
                        placeholderTextColor={colors.textMuted}
                        value={broadcastMsg}
                        onChangeText={setBroadcastMsg}
                        multiline
                        numberOfLines={4}
                      />
                    </View>

                    <TouchableOpacity
                      style={styles.submitBtn}
                      onPress={handleSendMessage}
                      disabled={sending}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={[colors.accent, '#2563eb']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.submitBtnGrad}
                      >
                        {sending ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="megaphone-outline" size={20} color="#fff" />
                            <Text style={styles.submitBtnTxt}>Hammaga Yuborish (POST /services/broadcast)</Text>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* SINGLE USER FORM */
                  <View style={[styles.formCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                    {/* Service Selector */}
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Yuboruvchi Xizmat</Text>
                    {services.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.serviceChipsScroll}>
                        {services.map((srv) => {
                          const isSelected = selectedServiceId === srv.id;
                          return (
                            <TouchableOpacity
                              key={srv.id}
                              style={[
                                styles.serviceChip,
                                {
                                  backgroundColor: isSelected ? colors.accent : colors.inputBg,
                                  borderColor: isSelected ? colors.accent : colors.cardBorder,
                                },
                              ]}
                              onPress={() => {
                                setSelectedServiceId(srv.id);
                                setManualToken(srv.token || '');
                              }}
                            >
                              <Text
                                style={[
                                  styles.serviceChipTxt,
                                  { color: isSelected ? '#ffffff' : colors.textPrimary },
                                ]}
                              >
                                {srv.title}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    ) : (
                      <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 8 }}>
                        Avval xizmat qoʻshing yoki token kiriting.
                      </Text>
                    )}

                    {/* Token */}
                    <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 10 }]}>
                      Xizmat Tokeni (srv_token_...)
                    </Text>
                    <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                      <TextInput
                        style={[styles.input, { color: colors.textPrimary }]}
                        placeholder="srv_token_c01d8acf00..."
                        placeholderTextColor={colors.textMuted}
                        value={manualToken}
                        onChangeText={setManualToken}
                      />
                    </View>

                    {/* Target User Phone */}
                    <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                      Foydalanuvchi Telefoni (user_phone)
                    </Text>
                    <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                      <Ionicons name="call-outline" size={18} color={colors.accent} style={{ marginRight: 8 }} />
                      <TextInput
                        style={[styles.input, { color: colors.textPrimary }]}
                        placeholder="+998901234567"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                        value={targetPhone}
                        onChangeText={setTargetPhone}
                      />
                    </View>

                    {/* Message */}
                    <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                      Xabar Matni (Message)
                    </Text>
                    <View style={[styles.inputWrap, styles.textAreaWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                      <TextInput
                        style={[styles.input, styles.textArea, { color: colors.textPrimary }]}
                        placeholder="Foydalanuvchiga yetkaziladigan matn..."
                        placeholderTextColor={colors.textMuted}
                        value={singleMsg}
                        onChangeText={setSingleMsg}
                        multiline
                        numberOfLines={4}
                      />
                    </View>

                    <TouchableOpacity
                      style={styles.submitBtn}
                      onPress={handleSendMessage}
                      disabled={sending}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={[colors.accent, '#2563eb']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.submitBtnGrad}
                      >
                        {sending ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="send" size={18} color="#fff" />
                            <Text style={styles.submitBtnTxt}>Yuborish (POST /services/messages/send)</Text>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* TAB 3: REGISTER NEW SERVICE */}
            {activeTab === 'register' && (
              <View>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                  Yangi Servis Roʻyxatdan Oʻtkazish
                </Text>
                <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
                  Yangi xizmat nomi, sarlavhasi va maʼlumotlarini kiritib, unga xos doimiy token oling.
                </Text>

                <View style={[styles.formCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                  {/* Name */}
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                    Xizmat Nomi (name *) <Text style={{ color: colors.textMuted, fontSize: 12 }}>3–50 belgi</Text>
                  </Text>
                  <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                    <Ionicons name="code-slash-outline" size={18} color={colors.accent} style={{ marginRight: 8 }} />
                    <TextInput
                      style={[styles.input, { color: colors.textPrimary }]}
                      placeholder="Masalan: jamgarma_app"
                      placeholderTextColor={colors.textMuted}
                      value={regName}
                      onChangeText={setRegName}
                      autoCapitalize="none"
                    />
                  </View>

                  {/* Title */}
                  <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                    Koʻrinadigan Sarlavha (title *) <Text style={{ color: colors.textMuted, fontSize: 12 }}>2–150 belgi</Text>
                  </Text>
                  <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                    <Ionicons name="text-outline" size={18} color={colors.accent} style={{ marginRight: 8 }} />
                    <TextInput
                      style={[styles.input, { color: colors.textPrimary }]}
                      placeholder="Masalan: Jamgʻarma MCHJ"
                      placeholderTextColor={colors.textMuted}
                      value={regTitle}
                      onChangeText={setRegTitle}
                    />
                  </View>

                  {/* About */}
                  <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                    Tavsif (about) <Text style={{ color: colors.textMuted, fontSize: 12 }}>Ixtiyoriy</Text>
                  </Text>
                  <View style={[styles.inputWrap, styles.textAreaWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                    <TextInput
                      style={[styles.input, styles.textArea, { color: colors.textPrimary }]}
                      placeholder="Xizmat haqida qisqacha maʼlumot..."
                      placeholderTextColor={colors.textMuted}
                      value={regAbout}
                      onChangeText={setRegAbout}
                      multiline
                      numberOfLines={3}
                    />
                  </View>

                  {/* Logo URL */}
                  <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                    Logotip URL (logo) <Text style={{ color: colors.textMuted, fontSize: 12 }}>Ixtiyoriy (boʻsh qoldirish mumkin)</Text>
                  </Text>
                  <View style={[styles.inputWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                    <Ionicons name="image-outline" size={18} color={colors.accent} style={{ marginRight: 8 }} />
                    <TextInput
                      style={[styles.input, { color: colors.textPrimary }]}
                      placeholder="https://... yoki boʻsh qoldiring"
                      placeholderTextColor={colors.textMuted}
                      value={regLogoUrl}
                      onChangeText={setRegLogoUrl}
                      autoCapitalize="none"
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.submitBtn}
                    onPress={handleRegisterService}
                    disabled={registering}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={[colors.accent, '#2563eb']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.submitBtnGrad}
                    >
                      {registering ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="shield-checkmark-outline" size={20} color="#fff" />
                          <Text style={styles.submitBtnTxt}>Servisni Roʻyxatdan Oʻtkazish</Text>
                        </>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </LinearGradient>
      </KeyboardAvoidingView>

      {/* SERVICE DETAIL MODAL */}
      <Modal
        visible={Boolean(selectedServiceDetail)}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedServiceDetail(null)}
      >
        <View style={styles.detailModalBackdrop}>
          <View style={[styles.detailModalSheet, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
            {/* Handle */}
            <View style={[styles.detailSheetHandle, { backgroundColor: colors.cardBorder }]} />

            {/* Header */}
            <View style={styles.detailModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                {selectedServiceDetail?.logo_url ? (
                  <Image
                    source={{ uri: getFullLogoUrl(selectedServiceDetail.logo_url) || undefined }}
                    style={styles.detailModalLogo}
                  />
                ) : (
                  <View style={[styles.detailModalLogoPlaceholder, { backgroundColor: `${colors.accent}20` }]}>
                    <Ionicons name="cube" size={28} color={colors.accent} />
                  </View>
                )}
                <View style={{ marginLeft: 14, flex: 1 }}>
                  <Text style={[styles.detailModalTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                    {selectedServiceDetail?.title}
                  </Text>
                  <Text style={[styles.detailModalName, { color: colors.accent }]}>
                    @{selectedServiceDetail?.name}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.detailModalCloseBtn, { borderColor: colors.cardBorder }]}
                onPress={() => setSelectedServiceDetail(null)}
              >
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* About */}
              {selectedServiceDetail?.about ? (
                <View style={[styles.detailInfoRow, { borderColor: colors.cardBorder }]}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.accent} style={{ marginRight: 10 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.detailInfoLabel, { color: colors.textMuted }]}>Tavsif</Text>
                    <Text style={[styles.detailInfoValue, { color: colors.textPrimary }]}>
                      {selectedServiceDetail.about}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Service ID */}
              <View style={[styles.detailInfoRow, { borderColor: colors.cardBorder }]}>
                <Ionicons name="finger-print-outline" size={18} color={colors.accent} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailInfoLabel, { color: colors.textMuted }]}>Service ID (UUID)</Text>
                  <Text style={[styles.detailInfoValue, styles.detailMonoText, { color: colors.textPrimary }]} selectable>
                    {selectedServiceDetail?.id}
                  </Text>
                </View>
              </View>

              {/* Token */}
              <View style={[styles.detailInfoRow, { borderColor: colors.cardBorder }]}>
                <Ionicons name="key-outline" size={18} color="#eab308" style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailInfoLabel, { color: colors.textMuted }]}>Service Token</Text>
                  <Text
                    style={[styles.detailInfoValue, styles.detailMonoText, { color: '#eab308' }]}
                    selectable
                    numberOfLines={2}
                  >
                    {selectedServiceDetail?.token || 'Token mavjud emas'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={{ padding: 6 }}
                  onPress={() => copyOrShareToken(selectedServiceDetail?.token, selectedServiceDetail?.title)}
                >
                  <Ionicons name="share-outline" size={18} color={colors.accent} />
                </TouchableOpacity>
              </View>

              {/* Actions */}
              <View style={styles.detailModalActions}>
                <TouchableOpacity
                  style={[styles.detailActionBtn, { backgroundColor: `${colors.accent}15`, borderColor: colors.accent }]}
                  onPress={() => {
                    setSelectedServiceDetail(null);
                    if (selectedServiceDetail) handleSelectServiceForMessage(selectedServiceDetail);
                  }}
                >
                  <Ionicons name="chatbubble-ellipses" size={18} color={colors.accent} />
                  <Text style={[styles.detailActionTxt, { color: colors.accent }]}>Xabar Yuborish</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.detailActionBtn, { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: '#ef4444' }]}
                  onPress={() => setSelectedServiceDetail(null)}
                >
                  <Ionicons name="close-circle-outline" size={18} color="#ef4444" />
                  <Text style={[styles.detailActionTxt, { color: '#ef4444' }]}>Yopish</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 54 : 44,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  crownBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 12,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabItem: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  sectionSub: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
    lineHeight: 18,
  },
  refreshIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  loadingBox: {
    paddingVertical: 50,
    alignItems: 'center',
  },
  loadingTxt: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyCard: {
    padding: 30,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 10,
  },
  emptyCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 14,
  },
  emptyCardSub: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  smallBtn: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  smallBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  serviceCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
  },
  serviceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceLogoImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  serviceDefaultLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  serviceTitleTxt: {
    fontSize: 16,
    fontWeight: '700',
  },
  serviceNameTag: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  actionBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  actionBadgeTxt: {
    fontSize: 12,
    fontWeight: '600',
  },
  serviceAboutTxt: {
    fontSize: 13,
    marginTop: 10,
    lineHeight: 18,
  },
  tokenBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  tokenLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  tokenValue: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  tokenActionBtn: {
    padding: 6,
    marginLeft: 6,
  },
  typeSwitcher: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  typeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  typeBtnActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  typeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  formCard: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
  },
  textAreaWrap: {
    height: 100,
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
  },
  textArea: {
    height: '100%',
    textAlignVertical: 'top',
  },
  serviceChipsScroll: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  serviceChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  serviceChipTxt: {
    fontSize: 13,
    fontWeight: '600',
  },
  submitBtn: {
    marginTop: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  submitBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  submitBtnTxt: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Service Detail Modal styles
  detailModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  detailModalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '82%',
    paddingBottom: 32,
  },
  detailSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  detailModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  detailModalLogo: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  detailModalLogoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  detailModalName: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  detailModalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  detailInfoLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  detailInfoValue: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  detailMonoText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  detailModalActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
  },
  detailActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  detailActionTxt: {
    fontSize: 14,
    fontWeight: '600',
  },
});
