import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { ToastProvider, registerGlobalToast, useToast } from '../context/ToastContext';

function ToastConnector() {
  const { showToast } = useToast();
  useEffect(() => {
    registerGlobalToast(showToast);
  }, [showToast]);
  return null;
}

function RootContent() {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <ToastConnector />
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="lock" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="register" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="login" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="notifications" options={{ animation: 'fade' }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <RootContent />
      </ToastProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
