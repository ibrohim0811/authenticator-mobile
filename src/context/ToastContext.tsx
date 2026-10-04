import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
  Vibration,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './ThemeContext';

export type ToastType = 'error' | 'warning' | 'success' | 'info';

export interface ToastOptions {
  type?: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContextData {
  showToast: (options: ToastOptions) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextData>({
  showToast: () => {},
  hideToast: () => {},
});

const { width } = Dimensions.get('window');

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { colors, theme } = useTheme();
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerVibration = (type: ToastType) => {
    if (Platform.OS !== 'web') {
      if (type === 'error' || type === 'warning') {
        Vibration.vibrate([0, 60, 40, 60]);
      } else {
        Vibration.vibrate(40);
      }
    }
  };

  const hideToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToast(null);
    });
  }, [translateY, opacity]);

  const showToast = useCallback(
    (options: ToastOptions) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      setToast(options);
      triggerVibration(options.type || 'error');

      translateY.setValue(-120);
      opacity.setValue(0);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          friction: 8,
          tension: 50,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();

      const duration = options.duration || 4000;
      timerRef.current = setTimeout(() => {
        hideToast();
      }, duration);
    },
    [translateY, opacity, hideToast]
  );

  const getToastColors = () => {
    if (!toast) return { bg: '#1e293b', border: '#334155', icon: '#38bdf8', text: '#ffffff' };
    switch (toast.type) {
      case 'error':
        return {
          bg: theme === 'dark' ? '#2a0a0a' : '#fef2f2',
          border: '#ef4444',
          icon: '#ef4444',
          badgeBg: 'rgba(239, 68, 68, 0.15)',
          title: '#f87171',
        };
      case 'warning':
        return {
          bg: theme === 'dark' ? '#2a1a08' : '#fffbe6',
          border: '#f59e0b',
          icon: '#f59e0b',
          badgeBg: 'rgba(245, 158, 11, 0.15)',
          title: '#fbbf24',
        };
      case 'success':
        return {
          bg: theme === 'dark' ? '#062016' : '#f0fdf4',
          border: '#10b981',
          icon: '#10b981',
          badgeBg: 'rgba(16, 185, 129, 0.15)',
          title: '#34d399',
        };
      case 'info':
      default:
        return {
          bg: theme === 'dark' ? '#081d2e' : '#f0f9ff',
          border: colors.accent,
          icon: colors.accent,
          badgeBg: colors.accentGlow,
          title: colors.accent,
        };
    }
  };

  const getToastIcon = (): keyof typeof Ionicons.glyphMap => {
    if (!toast) return 'information-circle-sharp';
    switch (toast.type) {
      case 'error':
        return 'alert-circle-sharp';
      case 'warning':
        return 'warning-sharp';
      case 'success':
        return 'checkmark-circle-sharp';
      case 'info':
      default:
        return 'information-circle-sharp';
    }
  };

  const styleColors = getToastColors();

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              transform: [{ translateY }],
              opacity,
              backgroundColor: styleColors.bg,
              borderColor: styleColors.border,
            },
          ]}
        >
          <View style={styles.toastContent}>
            <View style={[styles.iconBox, { backgroundColor: styleColors.badgeBg }]}>
              <Ionicons name={getToastIcon()} size={22} color={styleColors.icon} />
            </View>

            <View style={styles.textContainer}>
              <Text style={[styles.title, { color: styleColors.title }]}>
                {toast.title || (toast.type === 'error' ? 'Foydalanuvchi Xatosi (400)' : 'Eslatma')}
              </Text>
              <Text style={[styles.message, { color: colors.textPrimary }]} numberOfLines={3}>
                {toast.message}
              </Text>
            </View>

            <TouchableOpacity onPress={hideToast} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);

// Global Toast Emitter helper for outside React components (e.g. Axios Interceptors)
let globalToastHandler: ((options: ToastOptions) => void) | null = null;

export const registerGlobalToast = (handler: (options: ToastOptions) => void) => {
  globalToastHandler = handler;
};

export const triggerGlobalToast = (options: ToastOptions) => {
  if (globalToastHandler) {
    globalToastHandler(options);
  }
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 42,
    left: 16,
    right: 16,
    maxWidth: width - 32,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    paddingRight: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  closeBtn: {
    padding: 6,
  },
});
