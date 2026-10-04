import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';

export default function ConfirmOTPScreen() {
  const { colors } = useTheme();

  useEffect(() => {
    // New API spec does not use OTP. Redirect to register/lock immediately.
    const timer = setTimeout(() => {
      router.replace('/lock');
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <LinearGradient colors={colors.bg} style={styles.container}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        Tizimga ulanmoqda...
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    marginTop: 14,
    fontSize: 15,
  },
});
