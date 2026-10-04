import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { authService } from '../services/api';

export default function ConfirmOTPScreen({ phone, onConfirmSuccess }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!code || code.length < 4) {
      Alert.alert('Eslatma', 'Iltimos, OTP kodni kiriting');
      return;
    }
    setLoading(true);
    try {
      await authService.confirmOtp(phone, code);
      setLoading(false);
      Alert.alert('Muvaffaqiyatli!', 'Tizimga kirdingiz.');
      if (onConfirmSuccess) onConfirmSuccess();
    } catch (err) {
      setLoading(false);
      Alert.alert('Xatolik', err.response?.data?.detail || 'Kod noto‘g‘ri');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>OTP Kodni Kiriting</Text>
      <TextInput
        style={styles.input}
        placeholder="000000"
        placeholderTextColor="#64748b"
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={setCode}
      />
      <TouchableOpacity style={styles.btn} onPress={handleConfirm} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Tasdiqlash</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#0f172a' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 20, textAlign: 'center', color: '#fff' },
  input: { backgroundColor: '#1e293b', padding: 15, borderRadius: 10, fontSize: 24, textAlign: 'center', marginBottom: 15, color: '#fff', borderWidth: 1, borderColor: '#334155' },
  btn: { backgroundColor: '#10b981', padding: 15, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});