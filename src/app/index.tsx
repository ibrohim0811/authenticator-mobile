import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, Vibration, Platform } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { safeStorage } from '../services/storage';

const { width } = Dimensions.get('window');

// Tez 2 marta 1-1 nisbatli vibratsiya (Fast 1-1 double vibration during app entrance animation)
const triggerFastDoubleVibration = () => {
  if (Platform.OS !== 'web') {
    Vibration.vibrate([0, 45, 45, 45]);
  }
};

export default function SplashScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    // Ilova animatsiyasi vaqtida tez 2 marta vibratsiya (1-1)
    triggerFastDoubleVibration();

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(async () => {
        const isRegistered = await safeStorage.getItem('isRegistered');
        const token = await safeStorage.getItem('userToken');

        if (isRegistered || token) {
          router.replace('/lock');
        } else {
          router.replace('/register');
        }
      }, 700);
    });
  }, []);

  return (
    <LinearGradient
      colors={['#000000', '#0a0a0f', '#030712']}
      style={styles.container}
    >
      {/* Liquid Background Glow */}
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <View style={styles.glassBadge}>
          <LinearGradient
            colors={['rgba(0, 242, 254, 0.25)', 'rgba(0, 122, 255, 0.1)']}
            style={styles.glassBadgeInner}
          >
            <Ionicons name="shield-checkmark" size={60} color="#00f2fe" />
          </LinearGradient>
        </View>

        <Text style={styles.title}>Authenticator</Text>
        <Text style={styles.subtitle}>Liquid Glass & Dark Services 🔐</Text>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  glowTop: {
    position: 'absolute',
    top: -100,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(0, 242, 254, 0.12)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  glassBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    padding: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    marginBottom: 24,
  },
  glassBadgeInner: {
    flex: 1,
    borderRadius: 58,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
  },
});
