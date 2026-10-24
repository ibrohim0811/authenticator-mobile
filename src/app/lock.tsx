import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Vibration,
  Platform,
  StatusBar,
  ImageBackground,
} from 'react-native';
import { router } from 'expo-router';

import { Ionicons } from '@expo/vector-icons';
import { safeStorage } from '../services/storage';
import * as LocalAuthentication from 'expo-local-authentication';

const { width, height } = Dimensions.get('window');
const KEY_SIZE = Math.min(width * 0.21, 78);

/* ── Haptic helpers ─────────────────────────────────────── */
const tapVibrate = () => {
  if (Platform.OS !== 'web') Vibration.vibrate(10);
};
const errorVibrate = () => {
  if (Platform.OS !== 'web') Vibration.vibrate(300);
};

/* ── Number pad layout (iPhone style) ────────────────── */
const ROWS = [
  [{ n: '1', s: '' },   { n: '2', s: 'A B C' }, { n: '3', s: 'D E F' }],
  [{ n: '4', s: 'G H I' }, { n: '5', s: 'J K L' }, { n: '6', s: 'M N O' }],
  [{ n: '7', s: 'P Q R S' }, { n: '8', s: 'T U V' }, { n: '9', s: 'W X Y Z' }],
];

/* ── Glass circle key ────────────────────────────────── */
function GlassKey({
  label,
  sub,
  onPress,
}: {
  label: string;
  sub?: string;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    Animated.parallel([
      Animated.timing(scale, { toValue: 0.9, duration: 50, useNativeDriver: true }),
      Animated.timing(bgOpacity, { toValue: 1, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 200, useNativeDriver: true }),
      Animated.timing(bgOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  return (
    <TouchableOpacity
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={() => {
        tapVibrate();
        onPress();
      }}
      activeOpacity={1}
    >
      <Animated.View style={[styles.keyWrap, { transform: [{ scale }] }]}>
        {/* Default state — glass ring */}
        <View style={styles.keyRing}>
          <Animated.View style={[styles.keyHighlight, { opacity: bgOpacity }]} />
          <Text style={styles.keyNum}>{label}</Text>
          {sub ? <Text style={styles.keySub}>{sub}</Text> : null}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

/* ── Dot indicator ───────────────────────────────────── */
function PinDot({ filled, error }: { filled: boolean; error: boolean }) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: filled ? 1 : 0,
      friction: 5,
      tension: 300,
      useNativeDriver: true,
    }).start();
  }, [filled]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.dotOuter}>
      <Animated.View
        style={[
          styles.dotInner,
          error && styles.dotError,
          { transform: [{ scale: scaleAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) }] },
        ]}
      />
    </View>
  );
}

/* ── Real-time clock ─────────────────────────────────── */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ══════════════════════════════════════════════════════ */
/*                   LOCK SCREEN                         */
/* ══════════════════════════════════════════════════════ */
export default function LockScreen() {
  const now = useClock();

  /* PIN state */
  const [storedPin, setStoredPin] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [firstPinAttempt, setFirstPinAttempt] = useState('');
  const [isSettingMode, setIsSettingMode] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [hasError, setHasError] = useState(false);

  /* Biometrics state */
  const [biometricType, setBiometricType] = useState<'fingerprint' | 'faceid' | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  /* Animations */
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const clockSlideAnim = useRef(new Animated.Value(-30)).current;

  /* ── Init ────────────────────────────────── */
  useEffect(() => {
    // Load PIN
    safeStorage.getItem('userPin').then((saved) => {
      if (saved && saved.length === 4) {
        setStoredPin(saved);
        setIsSettingMode(false);
      } else {
        setIsSettingMode(true);
      }
    });

    // Check biometrics
    checkBiometrics();

    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(clockSlideAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
    ]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const checkBiometrics = async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricAvailable(compatible && enrolled);

      if (compatible && enrolled) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType('faceid');
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricType('fingerprint');
        }

        // Check if user enabled biometrics
        const bioPref = await safeStorage.getItem('biometricEnabled');
        setBiometricEnabled(bioPref === 'true');
      }
    } catch {
      setBiometricAvailable(false);
    }
  };

  /* ── Biometric auth ──────────────────────── */
  const handleBiometricAuth = useCallback(async () => {
    if (!biometricAvailable) return;

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Ilovaga kirish',
        cancelLabel: 'Bekor qilish',
        disableDeviceFallback: true,
        fallbackLabel: 'PIN-kod bilan kirish',
      });

      if (result.success) {
        router.replace('/notifications');
      }
    } catch (err) {
      console.warn('Biometric error:', err);
    }
  }, [biometricAvailable]);

  // Auto-trigger biometric auth when screen loads (if PIN is already set & biometrics enabled)
  useEffect(() => {
    if (!isSettingMode && storedPin && biometricEnabled && biometricAvailable) {
      // Small delay so the UI renders first
      const timeout = setTimeout(() => handleBiometricAuth(), 600);
      return () => clearTimeout(timeout);
    }
  }, [isSettingMode, storedPin, biometricEnabled, biometricAvailable, handleBiometricAuth]);

  /* ── Shake animation ─────────────────────── */
  const triggerShake = () => {
    errorVibrate();
    setHasError(true);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 18, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -18, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 14, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -14, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => setHasError(false), 300);
    });
  };

  /* ── PIN input handler ───────────────────── */
  const handlePressNum = (num: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + num;
    setPin(newPin);
    setErrorMsg('');
    setHasError(false);

    if (newPin.length === 4) {
      setTimeout(async () => {
        if (isSettingMode) {
          if (!confirmStep) {
            setFirstPinAttempt(newPin);
            setConfirmStep(true);
            setPin('');
          } else {
            if (newPin === firstPinAttempt) {
              await safeStorage.setItem('userPin', newPin);
              setStoredPin(newPin);

              // Enable biometrics if available
              if (biometricAvailable) {
                await safeStorage.setItem('biometricEnabled', 'true');
                setBiometricEnabled(true);
              }

              router.replace('/notifications');
            } else {
              triggerShake();
              setErrorMsg("PIN-kodlar mos kelmadi");
              setConfirmStep(false);
              setFirstPinAttempt('');
              setPin('');
            }
          }
        } else {
          if (newPin === storedPin) {
            router.replace('/notifications');
          } else {
            triggerShake();
            setErrorMsg("Noto'g'ri PIN-kod");
            setPin('');
          }
        }
      }, 180);
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      setPin(pin.slice(0, -1));
      setErrorMsg('');
      setHasError(false);
      tapVibrate();
    }
  };

  /* ── Title & subtitle ────────────────────── */
  const getTitle = () => {
    if (isSettingMode) return confirmStep ? 'PIN-kodni tasdiqlang' : "PIN-kod o'rnating";
    return 'Parol kiriting';
  };

  /* ── Format clock ────────────────────────── */
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');

  const weekDays = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
  const months = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  const dateStr = `${weekDays[now.getDay()]}, ${now.getDate()}-${months[now.getMonth()]}`;

  /* ── Biometric icon ──────────────────────── */
  const getBiometricIcon = () => {
    if (!biometricAvailable || isSettingMode) return null;
    if (biometricType === 'faceid') return 'scan-outline';
    return 'finger-print-outline';
  };

  const biometricIcon = getBiometricIcon();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Full-screen background image */}
      <ImageBackground
        source={require('../../assets/lockscreen-background.jpg')}
        style={styles.bgImage}
        resizeMode="cover"
      >
        {/* Dark overlay for readability */}
        <View style={styles.overlay} />

        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>

          {/* ── Clock section (iPhone style) ── */}
          <Animated.View style={[styles.clockSection, { transform: [{ translateY: clockSlideAnim }] }]}>
            <Text style={styles.clockTime}>{hours}:{minutes}</Text>
            <Text style={styles.clockDate}>{dateStr}</Text>
          </Animated.View>

          {/* ── PIN section ── */}
          <View style={styles.pinSection}>
            {/* Title */}
            <Text style={styles.title}>{getTitle()}</Text>

            {/* Error message */}
            {errorMsg ? (
              <Text style={styles.errorText}>{errorMsg}</Text>
            ) : null}

            {/* Dot indicators */}
            <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
              {[0, 1, 2, 3].map((i) => (
                <PinDot key={i} filled={pin.length > i} error={hasError} />
              ))}
            </Animated.View>

            {/* Keypad */}
            <View style={styles.keypad}>
              {ROWS.map((row, ri) => (
                <View key={ri} style={styles.keyRow}>
                  {row.map(({ n, s }) => (
                    <GlassKey key={n} label={n} sub={s || undefined} onPress={() => handlePressNum(n)} />
                  ))}
                </View>
              ))}

              {/* Bottom row: biometric | 0 | backspace */}
              <View style={styles.keyRow}>
                {/* Biometric button (or empty space) */}
                {biometricIcon && !isSettingMode ? (
                  <TouchableOpacity
                    style={styles.keyWrap}
                    onPress={handleBiometricAuth}
                    activeOpacity={0.6}
                  >
                    <View style={styles.keyGhostBtn}>
                      <Ionicons name={biometricIcon as any} size={28} color="rgba(255,255,255,0.85)" />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.keyWrap} />
                )}

                <GlassKey label="0" onPress={() => handlePressNum('0')} />

                {/* Backspace */}
                <TouchableOpacity style={styles.keyWrap} onPress={handleDelete} activeOpacity={0.6}>
                  <View style={styles.keyGhostBtn}>
                    {pin.length > 0 && (
                      <Ionicons name="backspace-outline" size={26} color="rgba(255,255,255,0.85)" />
                    )}
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Cancel / Emergency text (iPhone style) */}
            <View style={styles.bottomActions}>
              {!isSettingMode && (
                <TouchableOpacity
                  onPress={async () => {
                    await safeStorage.deleteItem('userPin');
                    setIsSettingMode(true);
                    setConfirmStep(false);
                    setPin('');
                    setErrorMsg('');
                  }}
                  activeOpacity={0.6}
                >
                  <Text style={styles.bottomActionText}>PIN-ni qayta o'rnatish</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

        </Animated.View>
      </ImageBackground>
    </View>
  );
}

/* ══════════════════════════════════════════════════════ */
/*                     STYLES                            */
/* ══════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  bgImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 70 : 50,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },

  /* ── Clock ── */
  clockSection: {
    alignItems: 'center',
    marginTop: 10,
  },
  clockTime: {
    fontSize: 76,
    fontWeight: '200',
    color: '#ffffff',
    letterSpacing: 2,
    lineHeight: 86,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  clockDate: {
    fontSize: 20,
    fontWeight: '400',
    color: '#ffffff',
    letterSpacing: 0.4,
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  /* ── PIN section ── */
  pinSection: {
    alignItems: 'center',
    width: '100%',
  },
  title: {
    fontSize: 17,
    fontWeight: '400',
    color: '#ffffff',
    letterSpacing: 0.3,
    textAlign: 'center',
    marginBottom: 14,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  errorText: {
    fontSize: 14,
    color: '#ff6b6b',
    textAlign: 'center',
    marginBottom: 8,
    marginTop: -8,
    fontWeight: '500',
  },

  /* ── Dots ── */
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    gap: 16,
  },
  dotOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
  },
  dotError: {
    backgroundColor: '#ff6b6b',
  },

  /* ── Keypad ── */
  keypad: {
    width: width * 0.78,
    maxWidth: 310,
    gap: 14,
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  keyWrap: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyRing: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 0,
    overflow: 'hidden',
  },
  keyHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: KEY_SIZE / 2,
  },
  keyGlass: {
    width: '100%',
    height: '100%',
    borderRadius: KEY_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyGhostBtn: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyNum: {
    fontSize: 32,
    fontWeight: '200',
    color: '#ffffff',
    letterSpacing: 0.5,
    lineHeight: 38,
  },
  keySub: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 2,
    marginTop: -2,
  },

  /* ── Bottom actions ── */
  bottomActions: {
    marginTop: 20,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomActionText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.3,
  },
});
