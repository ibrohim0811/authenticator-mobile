import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Vibration,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

export default function LockScreen({ onSuccess }) {
  const [pin, setPin] = useState('');

  // Animatsiya qiymatlari
  const lockTranslateY = useRef(new Animated.Value(100)).current; // Qulf pastdan chiqishi
  const lockOpacity = useRef(new Animated.Value(0)).current;      // Qulf korinishi
  const keyholeFade = useRef(new Animated.Value(1)).current;       // Kalit teshigi fade-out
  const contentFade = useRef(new Animated.Value(0)).current;       // PIN doiralar va klaviatura

  useEffect(() => {
    // Sequence (Ketma-ket) animatsiyalar
    Animated.sequence([
      // 1. Qulf pastdan silliq ko'tariladi va paydo bo'ladi
      Animated.parallel([
        Animated.timing(lockTranslateY, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(lockOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
      // 2. Kalit teshigi qismi sekin fade bo'ladi va PIN elementi chiqadi
      Animated.parallel([
        Animated.timing(keyholeFade, {
          toValue: 0.2,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(contentFade, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  // Tugma bosilganda
  const handlePressNum = (num) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);

      // 4 ta raqam terilgach tekshirish
      if (newPin.length === 4) {
        setTimeout(() => {
          if (newPin === '1234') { // Misol uchun sinov paroli: 1234
            onSuccess();
          } else {
            Vibration.vibrate(400); // Noto'g'ri bo'lsa tebranish
            setPin('');
          }
        }, 200);
      }
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      setPin(pin.slice(0, -1));
    }
  };

  return (
    <LinearGradient
      colors={['#1c1c1e', '#000000', '#0f2027']}
      style={styles.container}
    >
      {/* 1. QULFISH ANIMATSIYASI */}
      <Animated.View
        style={[
          styles.lockContainer,
          {
            opacity: lockOpacity,
            transform: [{ translateY: lockTranslateY }],
          },
        ]}
      >
        <Ionicons name="lock-closed" size={42} color="#ffffff" />
        
        {/* Kalit tiqadigan joydagi Fade effekt */}
        <Animated.View style={[styles.keyholeGlow, { opacity: keyholeFade }]} />
      </Animated.View>

      <Text style={styles.title}>Parolni kiriting</Text>

      {/* 2. 4 XONALI PIN DOIRALARI (iPhone style) */}
      <Animated.View style={[styles.dotsContainer, { opacity: contentFade }]}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={[
              styles.dot,
              pin.length > index && styles.dotFilled,
            ]}
          />
        ))}
      </Animated.View>

      {/* 3. IPHONE KLAVIATURASI (1:1) */}
      <Animated.View style={[styles.keypad, { opacity: contentFade }]}>
        {[
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ].map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((num) => (
              <TouchableOpacity
                key={num}
                style={styles.keyButton}
                onPress={() => handlePressNum(num)}
                activeOpacity={0.4}
              >
                <Text style={styles.keyNumber}>{num}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}

        {/* Oxirgi qator: Bo'sh joy, 0 va O'chirish tugmasi */}
        <View style={styles.row}>
          <View style={styles.keyButtonEmpty} />
          <TouchableOpacity
            style={styles.keyButton}
            onPress={() => handlePressNum('0')}
            activeOpacity={0.4}
          >
            <Text style={styles.keyNumber}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.keyButtonEmpty}
            onPress={handleDelete}
            activeOpacity={0.4}
          >
            {pin.length > 0 && <Text style={styles.deleteText}>Oʻchirish</Text>}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },
  lockContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  keyholeGlow: {
    position: 'absolute',
    top: 22,
    width: 6,
    height: 10,
    backgroundColor: '#007AFF',
    borderRadius: 3,
    shadowColor: '#007AFF',
    shadowRadius: 10,
    shadowOpacity: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '500',
    color: '#ffffff',
    letterSpacing: 0.5,
    marginBottom: 20,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 50,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    marginHorizontal: 12,
  },
  dotFilled: {
    backgroundColor: '#ffffff',
  },
  keypad: {
    width: width * 0.8,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  keyButton: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyButtonEmpty: {
    width: 75,
    height: 75,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyNumber: {
    fontSize: 32,
    fontWeight: '400',
    color: '#ffffff',
  },
  deleteText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '400',
  },
});