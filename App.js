import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';

// Must be exported or defined for Expo Router entry compatibility
export function App() {
  const ctx = require.context('./src/app');
  return <ExpoRoot context={ctx} />;
}

export default App;