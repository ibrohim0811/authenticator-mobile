import axios from 'axios';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { triggerGlobalToast } from '../context/ToastContext';
import { safeStorage } from './storage';

// Normalize phone number according to API.md (+998901234567 format)
export const normalizePhone = (raw) => {
  if (!raw) return '';
  const cleaned = raw.replace(/\D/g, '');
  return cleaned ? '+' + cleaned : '';
};

// Default base URL
export const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  if (Platform.OS === 'android') {
    return 'https://api.authenticator.devguard.uz/api/v1';
  }
  return 'https://api.authenticator.devguard.uz/api/v1';
};

// Helper function to format service logo URLs
export const getFullLogoUrl = (logoUrl) => {
  if (!logoUrl) return null;
  if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
    return logoUrl;
  }
  const hostUrl = getBaseUrl().replace(/\/api\/v1\/?$/, '');
  const path = logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`;
  return `${hostUrl}${path}`;
};

const api = axios.create({
  baseURL: getBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Dynamic Base URL loader
safeStorage.getItem('customApiUrl').then((customUrl) => {
  if (customUrl) {
    api.defaults.baseURL = customUrl;
    console.log('📌 [API Custom BaseURL loaded]:', customUrl);
  }
});

export const setApiBaseUrl = async (url) => {
  let formattedUrl = url.trim().replace(/\/+$/, '');
  if (!formattedUrl.endsWith('/api/v1')) {
    formattedUrl = formattedUrl + '/api/v1';
  }
  api.defaults.baseURL = formattedUrl;
  await safeStorage.setItem('customApiUrl', formattedUrl);
  console.log('🔄 [API BaseURL updated]:', formattedUrl);
  return formattedUrl;
};

// Helper function to extract error message
export const parseApiError = (error, fallbackMessage = 'Xatolik yuz berdi') => {
  if (!error) return fallbackMessage;

  const status = error.response?.status;
  const data = error.response?.data;

  if (status >= 400 && status < 500) {
    if (data) {
      if (typeof data.detail === 'string') return data.detail;
      if (typeof data.message === 'string') return data.message;
      if (typeof data.error === 'string') return data.error;
      if (Array.isArray(data.detail) && data.detail[0]?.msg) {
        return `${data.detail[0].loc ? data.detail[0].loc.join('.') + ': ' : ''}${data.detail[0].msg}`;
      }
    }

    if (status === 400) return 'Kiritilgan maʼlumotlarda xatolik bor (400 Bad Request).';
    if (status === 401) return 'Token yaroqsiz yoki muddati oʻtgan (401 Unauthorized).';
    if (status === 403) return 'Ushbu amalni bajarish uchun huquqingiz yetarli emas (403 Forbidden).';
    if (status === 404) return 'Soʻralgan resurs topilmadi (404 Not Found).';
    if (status === 422) return 'Soʻrov formati notoʻgʻri yoki maydonlar yetarli emas (422 Unprocessable).';
    if (status === 429) return 'Juda koʻp soʻrov yuborildi (429 Too Many Requests).';
  }

  if (error.message === 'Network Error' || !error.response) {
    return `Nimadur xato ketdi iltimos qaytadan urinib ko'ring!`;
  }

  return fallbackMessage;
};

// Queue mechanism
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Refresh Access Token
export const refreshAccessToken = async () => {
  try {
    const refreshToken = await safeStorage.getItem('refreshToken');
    if (!refreshToken) return null;

    console.log('🔄 [Attempting Refresh Token via /users/refresh]');
    const res = await axios.post(
      `${api.defaults.baseURL}/users/refresh`,
      { refresh_token: refreshToken },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000,
      }
    );

    const newAccessToken = res.data?.access_token;
    const newRefreshToken = res.data?.refresh_token;

    if (newAccessToken) {
      await safeStorage.setItem('userToken', newAccessToken);
      if (newRefreshToken) {
        await safeStorage.setItem('refreshToken', newRefreshToken);
      }
      console.log('✅ [Refresh Token Success]: Tokens rotated');
      return newAccessToken;
    }
    return null;
  } catch (err) {
    console.warn('⚠️ [Refresh Token Failed]: Refresh token yaroqsiz yoki muddati oʻtgan.');
    return null;
  }
};

// Request Interceptor (Bearer token kiritish)
api.interceptors.request.use(
  async (config) => {
    const token = await safeStorage.getItem('userToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    console.log(`🌐 [API Request] ${config.method?.toUpperCase()} -> ${config.baseURL}${config.url}`);
    return config;
  },
  (error) => {
    console.error('❌ [API Request Error]', error);
    return Promise.reject(error);
  }
);

// Response Interceptor
api.interceptors.response.use(
  (response) => {
    console.log(`✅ [API Response] ${response.status} <- ${response.config.url}`);
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const url = originalRequest?.url || '';

    const isAuthEndpoint =
      url.includes('/users/login') ||
      url.includes('/users/register') ||
      url.includes('/users/refresh') ||
      url.includes('/users/logout');

    // Handle 401 Unauthorized
    if (status === 401 && originalRequest && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await refreshAccessToken();
        if (newToken) {
          processQueue(null, newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        } else {
          processQueue(new Error('Token refresh failed'), null);
          console.log('🔒 [Session Expired] Token muddati oʻtgan. Login ga yoʻnaltirilmoqda.');

          // Majburiy local tozalash
          await safeStorage.deleteItem('userToken');
          await safeStorage.deleteItem('refreshToken');
          await safeStorage.deleteItem('isRegistered');

          triggerGlobalToast({
            type: 'error',
            title: 'Seans Muddati Tugadi',
            message: 'Qayta tizimga kiring.',
            duration: 4000,
          });

          router.replace('/login');
          return Promise.reject(error);
        }
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        await safeStorage.deleteItem('userToken');
        await safeStorage.deleteItem('refreshToken');
        await safeStorage.deleteItem('isRegistered');
        router.replace('/login');
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    // 400-level User Errors
    if (status && status >= 400 && status < 500 && status !== 401 && !isAuthEndpoint) {
      const parsedMessage = parseApiError(error);
      let title = `Xatolik (${status})`;
      if (status === 400) title = 'Xato Maʼlumot (400)';
      if (status === 403) title = 'Taqiqlangan Amal (403)';
      if (status === 404) title = 'Topilmadi (404)';
      if (status === 422) title = 'Format Xatosi (422)';
      if (status === 429) title = 'Soʻrovlar Cheklovi (429)';

      triggerGlobalToast({
        type: 'error',
        title,
        message: parsedMessage,
        duration: 4500,
      });
    }

    return Promise.reject(error);
  }
);

export const authService = {
  /**
   * @param {string} fullName
   * @param {string} phoneNumber
   * @param {string} password
   * @param {string | null} [deviceToken=null]
   */
  register: async (fullName, phoneNumber, password, deviceToken = null) => {
    const formattedPhone = normalizePhone(phoneNumber);
    const res = await api.post('/users/register', {
      full_name: fullName,
      phone_number: formattedPhone,
      password: password,
      device_token: deviceToken,
    });
    if (res.data) {
      if (res.data.access_token) await safeStorage.setItem('userToken', res.data.access_token);
      if (res.data.refresh_token) await safeStorage.setItem('refreshToken', res.data.refresh_token);
      await safeStorage.setItem('isRegistered', 'true');
    }
    return res.data;
  },

  /**
   * @param {string} phoneNumber
   * @param {string} password
   * @param {string | null} [deviceToken=null]
   */
  login: async (phoneNumber, password, deviceToken = null) => {
    const formattedPhone = normalizePhone(phoneNumber);
    const res = await api.post('/users/login', {
      phone_number: formattedPhone,
      password: password,
      device_token: deviceToken,
    });
    if (res.data) {
      if (res.data.access_token) await safeStorage.setItem('userToken', res.data.access_token);
      if (res.data.refresh_token) await safeStorage.setItem('refreshToken', res.data.refresh_token);
      await safeStorage.setItem('isRegistered', 'true');
    }
    return res.data;
  },

  getCurrentUser: async () => {
    const res = await api.get('/users/me');
    return res.data;
  },

  // 4. Logout (Tuzatildi: api.post o'rniga mustaqil axios ishlatildi)
  logout: async () => {
    try {
      const token = await safeStorage.getItem('userToken');
      if (token) {
        await axios.post(
          `${api.defaults.baseURL}/users/logout`,
          {},
          { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }
        );
        console.log('✅ [Logout Success]: Server refresh token revoked');
      }
    } catch (err) {
      console.warn('⚠️ [Logout Warning]: Server logout token status:', err?.response?.status || err?.message);
    } finally {
      await safeStorage.deleteItem('userToken');
      await safeStorage.deleteItem('refreshToken');
      await safeStorage.deleteItem('isRegistered');
    }
  },

  isAuthenticated: async () => {
    const token = await safeStorage.getItem('userToken');
    return Boolean(token);
  }
};

export const notificationService = {
  getNotifications: async () => {
    const res = await api.get('/notifications');
    return res.data;
  },

  markAsRead: async (notificationId) => {
    const res = await api.patch(`/notifications/${notificationId}/read`);
    return res.data;
  },
};

export default api;