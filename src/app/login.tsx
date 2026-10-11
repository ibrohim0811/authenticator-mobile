import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { authService, parseApiError } from '../services/api';
import { getDeviceToken } from '../services/pushNotifications';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

export default function LoginScreen() {
  const { theme, colors, toggleTheme } = useTheme();
  const { showToast } = useToast();

  const [phone, setPhone] = useState('+998');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!phone.trim() || phone === '+998' || !password.trim()) {
      showToast({
        type: 'error',
        title: 'Foydalanuvchi Xatosi (400)',
        message: 'Iltimos, telefon raqamingiz va maxfiy parolingizni toʻliq kiriting.',
      });
      return;
    }

    setLoading(true);
    try {
      let deviceToken: string | null = null;
      try {
        deviceToken = await getDeviceToken();
      } catch (tokenErr) {
        console.warn('⚠️ [Login] Device token olishda xatolik:', tokenErr);
        deviceToken = null;
      }

      await authService.login(phone, password, deviceToken);
      setLoading(false);

      showToast({
        type: 'success',
        title: 'Muvaffaqiyatli! 🎉',
        message: 'Tizimga kirdingiz.',
      });

      router.replace('/lock');
    } catch (err: any) {
      setLoading(false);
      const userFriendlyMessage = parseApiError(err, 'Telefon raqam yoki parol noto‘g‘ri!');

      showToast({
        type: 'error',
        title: 'Kirishda Xatolik',
        message: userFriendlyMessage,
      });
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <LinearGradient colors={colors.bg} style={styles.container}>
        {/* Liquid Glass Glow Background Orbs */}
        <View style={[styles.orbCyan, { backgroundColor: colors.accentGlow }]} />
        <View style={[styles.orbPurple, { backgroundColor: 'rgba(147, 51, 234, 0.12)' }]} />

        {/* Top Header Buttons */}
        <View style={styles.topHeader}>
          <TouchableOpacity
            style={[styles.topIconBtn, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={20} color={colors.accent} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.topIconBtn, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
            onPress={toggleTheme}
          >
            <Ionicons
              name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'}
              size={18}
              color={colors.accent}
            />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.glassBadge, { borderColor: colors.cardBorder }]}>
              <LinearGradient
                colors={[colors.accentGlow, 'rgba(0,0,0,0)']}
                style={styles.glassBadgeInner}
              >
                <Ionicons name="log-in" size={32} color={colors.accent} />
              </LinearGradient>
            </View>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Tizimga kirish</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              Telefon raqamingiz va parolingiz bilan kiring
            </Text>
          </View>

          {/* Liquid Glass Card */}
          <View style={[styles.glassCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
            {/* Telefon */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>Telefon Raqam</Text>
            <View style={[styles.inputBox, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
              <Ionicons name="call-outline" size={20} color={colors.accent} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="+998 90 123 45 67"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            </View>

            {/* Parol */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>Maxfiy Parol</Text>
            <View style={[styles.inputBox, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.accent} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={styles.btn}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[colors.accent, '#2563eb']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.btnGradient}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.btnText}>Kirish</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Switch to Register */}
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => router.push('/register')}
            >
              <Text style={[styles.linkText, { color: colors.textMuted }]}>
                Hisobingiz yoʻqmi? <Text style={[styles.linkHighlight, { color: colors.accent }]}>Roʻyxatdan oʻtish</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  orbCyan: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  orbPurple: {
    position: 'absolute',
    bottom: -60,
    left: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
  },
  topHeader: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  topIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 100 : 80,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  glassBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    padding: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    marginBottom: 16,
  },
  glassBadgeInner: {
    flex: 1,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  glassCard: {
    borderRadius: 24,
    padding: 22,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 10,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
  },
  eyeBtn: {
    padding: 6,
  },
  btn: {
    marginTop: 26,
    borderRadius: 14,
    overflow: 'hidden',
  },
  btnGradient: {
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  linkBtn: {
    marginTop: 18,
    alignItems: 'center',
    padding: 8,
  },
  linkText: {
    fontSize: 14,
  },
  linkHighlight: {
    fontWeight: '700',
  },
});
