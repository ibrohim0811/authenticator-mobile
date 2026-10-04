import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

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
 * Get native FCM device push token if available
 */
export async function getDevicePushToken() {
  try {
    if (Platform.OS === 'web' || isExpoGo || !Notifications) return null;
    const hasPermission = await requestPushPermissions();
    if (!hasPermission) return null;

    const tokenData = await Notifications.getDevicePushTokenAsync();
    return tokenData?.data || null;
  } catch (error) {
    console.warn('⚠️ [Push Token Fetch Error]:', error?.message || error);
    return null;
  }
}