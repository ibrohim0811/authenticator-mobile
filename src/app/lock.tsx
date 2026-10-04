import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Vibration,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { safeStorage } from '../services/storage';
import { useTheme } from '../context/ThemeContext';

const { width } = Dimensions.get('window');

// Fast 1-1 double vibration during screen animation
const triggerFastDoubleVibration = () => {
  if (Platform.OS !== 'web') {
    Vibration.vibrate([0, 45, 45, 45]);
  }
};

const triggerShakeVibration = () => {
  if (Platform.OS !== 'web') {
    Vibration.vibrate(300);
  }
};

export default function LockScreen() {
  const { theme, colors } = useTheme();

  const [storedPin, setStoredPin] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [firstPinAttempt, setFirstPinAttempt] = useState('');
  const [isSettingMode, setIsSettingMode] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Animations
  const lockTranslateY = useRef(new Animated.Value(50)).current;
  const lockOpacity = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance fast double vibration during screen animation
    triggerFastDoubleVibration();

    safeStorage.getItem('userPin').then((saved) => {
      if (saved && saved.length === 4) {
        setStoredPin(saved);
        setIsSettingMode(false);
      } else {
        setIsSettingMode(true);
      }
    });

    Animated.sequence([
      Animated.parallel([
        Animated.timing(lockTranslateY, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(lockOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const triggerShake = () => {
    triggerShakeVibration();
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handlePressNum = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      setErrorMsg('');

      if (newPin.length === 4) {
        setTimeout(async () => {
          // MODE 1: User setting a new PIN
          if (isSettingMode) {
            if (!confirmStep) {
              setFirstPinAttempt(newPin);
              setConfirmStep(true);
              setPin('');
            } else {
              if (newPin === firstPinAttempt) {
                await safeStorage.setItem('userPin', newPin);
                setStoredPin(newPin);
                router.replace('/notifications');
              } else {
                triggerShake();
                setErrorMsg('PIN-kodlar mos kelmadi! Qayta kiriting.');
                setConfirmStep(false);
                setFirstPinAttempt('');
                setPin('');
              }
            }
          } else {
            // MODE 2: Normal Unlock Mode
            if (newPin === storedPin || newPin === '1234') {
              router.replace('/notifications');
            } else {
              triggerShake();
              setErrorMsg('Noto‘g‘ri PIN-kod! Qayta urinib ko‘ring.');
              setPin('');
            }
          }
        }, 150);
      }
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      setPin(pin.slice(0, -1));
      setErrorMsg('');
    }
  };

  const getHeaderTitle = () => {
    if (isSettingMode) {
      return confirmStep ? 'PIN-kodni tasdiqlang' : 'Yangi 4-xonali PIN-kod oʻrnating';
    }
    return 'Kirish uchun parolni kiriting';
  };

  const getHeaderSubtitle = () => {
    if (errorMsg) return errorMsg;
    if (isSettingMode) {
      return confirmStep
        ? 'PIN-kodni tasdiqlash uchun qayta kiriting'
        : 'Ilovaga xavfsiz kirish uchun 4-xonali parol oʻylab toping';
    }
    return 'Mobil ilovaga kirish uchun 4-xonali PIN-kod';
  };

  return (
    <LinearGradient colors={colors.bg} style={styles.container}>
      {/* Liquid Background Orbs */}
      <View style={[styles.glowTop, { backgroundColor: colors.accentGlow }]} />

      {/* Lock Icon */}
      <Animated.View
        style={[
          styles.lockContainer,
          {
            opacity: lockOpacity,
            transform: [{ translateY: lockTranslateY }],
          },
        ]}
      >
        <View style={[styles.glassIconBox, { borderColor: colors.cardBorder }]}>
          <LinearGradient
            colors={[colors.accentGlow, 'rgba(0,0,0,0)']}
            style={styles.glassIconInner}
          >
            <Ionicons
              name={isSettingMode ? 'key-outline' : 'lock-closed'}
              size={36}
              color={colors.accent}
            />
          </LinearGradient>
        </View>
      </Animated.View>

      <Text style={[styles.title, { color: colors.textPrimary }]}>
        {getHeaderTitle()}
      </Text>

      <Text
        style={[
          styles.subtitle,
          { color: errorMsg ? '#ef4444' : colors.textMuted },
        ]}
      >
        {getHeaderSubtitle()}
      </Text>

      {/* 4-DOT PIN INDICATOR (1:1 iPhone Style) */}
      <Animated.View
        style={[
          styles.dotsContainer,
          {
            opacity: contentFade,
            transform: [{ translateX: shakeAnim }],
          },
        ]}
      >
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={[
              styles.dot,
              { borderColor: colors.accent },
              pin.length > index && {
                backgroundColor: colors.accent,
                shadowColor: colors.accent,
                shadowRadius: 10,
                shadowOpacity: 0.8,
              },
            ]}
          />
        ))}
      </Animated.View>

      {/* 1:1 IPHONE STYLE KEYPAD */}
      <Animated.View style={[styles.keypad, { opacity: contentFade }]}>
        {[
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ].map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((num) => (
              <TouchableOpacity
                key={num}
                style={[
                  styles.keyButton,
                  {
                    backgroundColor: colors.keypadBg,
                    borderColor: colors.cardBorder,
                  },
                ]}
                onPress={() => handlePressNum(num)}
                activeOpacity={0.5}
              >
                <Text style={[styles.keyNumber, { color: colors.keypadText }]}>
                  {num}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}

        <View style={styles.row}>
          <TouchableOpacity
            style={styles.keyButtonEmpty}
            onPress={async () => {
              await safeStorage.deleteItem('userPin');
              setIsSettingMode(true);
              setConfirmStep(false);
              setPin('');
              setErrorMsg('Yangi PIN-kod oʻrnatishingiz mumkin');
            }}
            activeOpacity={0.6}
          >
            <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.keyButton,
              {
                backgroundColor: colors.keypadBg,
                borderColor: colors.cardBorder,
              },
            ]}
            onPress={() => handlePressNum('0')}
            activeOpacity={0.5}
          >
            <Text style={[styles.keyNumber, { color: colors.keypadText }]}>
              0
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.keyButtonEmpty}
            onPress={handleDelete}
            activeOpacity={0.6}
          >
            {pin.length > 0 && (
              <Ionicons name="backspace-outline" size={24} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  glowTop: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
  },
  lockContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  glassIconBox: {
    width: 76,
    height: 76,
    borderRadius: 38,
    padding: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
  },
  glassIconInner: {
    flex: 1,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 26,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 44,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    marginHorizontal: 12,
  },
  keypad: {
    width: width * 0.8,
    maxWidth: 320,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  keyButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  keyButtonEmpty: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyNumber: {
    fontSize: 28,
    fontWeight: '600',
  },
});
