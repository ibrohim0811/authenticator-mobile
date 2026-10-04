import React, { createContext, useContext, useState, useEffect } from 'react';
import { safeStorage } from '../services/storage';

type ThemeMode = 'dark' | 'light';

interface ThemeColors {
  bg: [string, string, string];
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentGlow: string;
  inputBg: string;
  inputBorder: string;
  keypadBg: string;
  keypadText: string;
  drawerBg: [string, string, string];
  modalBg: string;
}

const darkColors: ThemeColors = {
  bg: ['#000000', '#09090c', '#030712'],
  cardBg: 'rgba(255, 255, 255, 0.05)',
  cardBorder: 'rgba(255, 255, 255, 0.12)',
  textPrimary: '#ffffff',
  textSecondary: '#cbd5e1',
  textMuted: '#64748b',
  accent: '#00f2fe',
  accentGlow: 'rgba(0, 242, 254, 0.15)',
  inputBg: 'rgba(15, 23, 42, 0.8)',
  inputBorder: 'rgba(255, 255, 255, 0.15)',
  keypadBg: 'rgba(255, 255, 255, 0.08)',
  keypadText: '#ffffff',
  drawerBg: ['#090d16', '#020617', '#000000'],
  modalBg: '#090d16',
};

const lightColors: ThemeColors = {
  bg: ['#f8fafc', '#e2e8f0', '#cbd5e1'],
  cardBg: 'rgba(255, 255, 255, 0.75)',
  cardBorder: 'rgba(203, 213, 225, 0.6)',
  textPrimary: '#0f172a',
  textSecondary: '#334155',
  textMuted: '#64748b',
  accent: '#0284c7',
  accentGlow: 'rgba(2, 132, 199, 0.12)',
  inputBg: 'rgba(255, 255, 255, 0.9)',
  inputBorder: 'rgba(148, 163, 184, 0.4)',
  keypadBg: 'rgba(255, 255, 255, 0.85)',
  keypadText: '#0f172a',
  drawerBg: ['#ffffff', '#f1f5f9', '#e2e8f0'],
  modalBg: '#ffffff',
};

interface ThemeContextType {
  theme: ThemeMode;
  colors: ThemeColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  colors: darkColors,
  toggleTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>('dark');

  useEffect(() => {
    safeStorage.getItem('appTheme').then((savedTheme) => {
      if (savedTheme === 'light' || savedTheme === 'dark') {
        setTheme(savedTheme);
      }
    });
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    safeStorage.setItem('appTheme', nextTheme);
  };

  const colors = theme === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ theme, colors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
