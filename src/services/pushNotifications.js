import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { safeStorage } from './storage';

const isExpoGo =
  Constants?.executionEnvironment === ExecutionEnvironment?.StoreClient ||
  Constants?.appOwnership === 'expo';

// Dynamic import: Expo Go va Web muhitida module yuklanishini oldini olamiz
let Notifications = null;

if (!isExpoGo && Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (err) {
    console.warn('[Push Notifications] Init error:', err?.message || err);
  }
}

/**
 * Request notification permissions from device
 */
export async function requestPushPermissions() {
  try {
    if (Platform.OS === 'web' || isExpoGo || !Notifications) {
      console.log('ℹ️ [Push Notifications] Push notifications disabled in Expo Go / Web environment.');
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('⚠️ [Push Notifications] Ruxsat berilmadi.');
      return false;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Authenticator Push Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#00f2fe',
      });
    }

    console.log('✅ [Push Notifications] Ruxsat faollashtirildi.');
    return true;
  } catch (error) {
    console.warn('❌ [Push Notifications Error]:', error?.message || error);
    return false;
  }
}

/**
 * Send immediate local phone push notification for service messages
 */
export async function sendLocalPushNotification({ title, body, data = {} }) {
  try {
    if (Platform.OS === 'web' || isExpoGo || !Notifications) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: title || 'Authenticator Xizmati',
        body: body || 'Yangi xabar keldi',
        data: data,
        sound: true,
      },
      trigger: null, // null means trigger immediately
    });
    console.log(`📱 [Push Triggered] ${title}: ${body}`);
  } catch (error) {
    console.warn('❌ [Push Trigger Error]:', error?.message || error);
  }
}

/**
 * Get native FCM device push token if available, with robust fallback
 */
export async function getDevicePushToken() {
  try {
    const cachedToken = await safeStorage.getItem('device_token');

    if (!isExpoGo && Platform.OS !== 'web' && Notifications) {
      try {
        const hasPermission = await requestPushPermissions();
        if (hasPermission) {
          const tokenData = await Notifications.getDevicePushTokenAsync();
          if (tokenData?.data) {
            await safeStorage.setItem('device_token', tokenData.data);
            return tokenData.data;
          }
        }
      } catch (nativeErr) {
        console.warn('⚠️ [Push Token Native Error]:', nativeErr?.message || nativeErr);
      }
    }

    if (cachedToken && !cachedToken.startsWith('fcm_emergency') && !cachedToken.startsWith('fcm_android')) {
      return cachedToken;
    }

    // ❌ SOXTA TOKEN GENERATSIYA QILISHNI TO'XTATAMIZ!
    console.log('⚠️ [Push Token]: Haqiqiy FCM token olinmadi (Expo Go yoki Emulator bo\'lishi mumkin).');
    return null;

  } catch (error) {
    console.warn('⚠️ [Push Token Fetch Error]:', error?.message || error);
    return null;
  }
}

export const getDeviceToken = getDevicePushToken;

/**
 * Listen for FCM token refreshes and update the server via PATCH /api/v1/users/device-token
 * Bu listener ilova ochiq bo'lganda FCM token o'zgarsa, avtomatik serverga xabar beradi.
 * Returns an unsubscribe function, or null if not applicable.
 */
export function setupTokenRefreshListener() {
  if (isExpoGo || Platform.OS === 'web' || !Notifications) {
    return null;
  }

  try {
    // Notifications.addPushTokenListener fires when the device push token changes
    const subscription = Notifications.addPushTokenListener(async (tokenData) => {
      if (tokenData?.data) {
        console.log('🔄 [FCM Token Refreshed]:', tokenData.data.substring(0, 20) + '...');
        await safeStorage.setItem('device_token', tokenData.data);

        // Dynamically import to avoid circular dependency
        try {
          const { authService } = require('./api');
          const userToken = await safeStorage.getItem('userToken');
          if (userToken) {
            await authService.updateDeviceToken(tokenData.data);
            console.log('✅ [FCM Token Synced]: Server ga yangi token yuborildi');
          }
        } catch (syncErr) {
          console.warn('⚠️ [FCM Token Sync Error]:', syncErr?.message || syncErr);
        }
      }
    });

    console.log('📡 [Push Token Listener] FCM token refresh listener o\'rnatildi');
    return () => subscription?.remove?.();
  } catch (err) {
    console.warn('⚠️ [Push Token Listener Error]:', err?.message || err);
    return null;
  }
}