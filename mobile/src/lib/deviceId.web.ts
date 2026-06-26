/** device_id na web — AsyncStorage (SecureStore nie jest wspierany na web). Ten sam interfejs co deviceId.ts. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuidv4 } from './uuid';

const KEY = 'recai.device_id';
let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    let id = await AsyncStorage.getItem(KEY);
    if (!id) {
      id = uuidv4();
      await AsyncStorage.setItem(KEY, id);
    }
    cached = id;
    return id;
  } catch {
    cached = cached ?? uuidv4();
    return cached;
  }
}
