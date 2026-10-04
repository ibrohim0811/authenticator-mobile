import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Linking, ActivityIndicator } from 'react-native';
import { authService } from '../services/api';

export default function RegisterScreen({ onRegisterSuccess }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+998');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!fullName || !phone || !password) {
      Alert.alert('Eslatma', 'Iltimos, barcha maydonlarni to‘ldiring');
      return;
    }
    setLoading(true);
    try {
      const res = await authService.register(fullName, phone, password);
      setLoading(false);
      if (res && res.bot_url) {
        Alert.alert('OTP Yaratildi', 'Telegram botdan kodni oling', [
          {
            text: 'Botga o‘tish',
            onPress: () => {
              Linking.openURL(res.bot_url);
              if (onRegisterSuccess) onRegisterSuccess(phone);
            },
          },
          {
            text: 'Davom etish',
            onPress: () => {
              if (onRegisterSuccess) onRegisterSuccess(phone);
            },
          }
        ]);
      } else {
        if (onRegisterSuccess) onRegisterSuccess(phone);
      }
    } catch (err) {
      setLoading(false);
      Alert.alert('Xatolik', err.response?.data?.detail || 'Xatolik yuz berdi');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Roʻyxatdan oʻtish</Text>
      <TextInput style={styles.input} placeholder="Ism Familiya" value={fullName} onChangeText={setFullName} />
      <TextInput style={styles.input} placeholder="Telefon (+998...)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextInput style={styles.input} placeholder="Parol" secureTextEntry value={password} onChangeText={setPassword} />
      <TouchableOpacity style={styles.btn} onPress={handleRegister} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Kod olish</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#0f172a' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center', color: '#fff' },
  input: { backgroundColor: '#1e293b', padding: 15, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#334155', color: '#fff' },
  btn: { backgroundColor: '#0284c7', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});