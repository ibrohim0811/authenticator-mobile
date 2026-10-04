import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { notificationService } from '../services/api';

export default function NotificationsScreen() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    notificationService
      .getNotifications()
      .then((data) => {
        if (Array.isArray(data)) {
          setList(data);
        } else if (data && Array.isArray(data.items)) {
          setList(data.items);
        } else {
          setList([]);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch notifications:', err);
        setList([]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Xabarlaringiz</Text>
      {loading ? (
        <ActivityIndicator color="#38bdf8" />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item, index) => item.id?.toString() || index.toString()}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.msg}>{item.message}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Hozircha xabarlar yoʻq.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 50, backgroundColor: '#0f172a' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 15, color: '#fff' },
  card: { backgroundColor: '#1e293b', padding: 15, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  msg: { fontSize: 15, color: '#f8fafc' },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 20 },
});