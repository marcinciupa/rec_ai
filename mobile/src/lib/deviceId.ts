/**
 * device_id — anonimowy, trwały identyfikator urządzenia (klucz `recai.device_id`).
 * Natywnie w SecureStore. Wariant .web.ts używa AsyncStorage (SecureStore nie działa na web).
 * Wysyłany jako nagłówek `X-Device-Id` do backendu (rate-limit / atrybucja kosztu, bez logowania treści).
 */
import * as SecureStore from 'expo-secure-store';
import { uuidv4 } from './uuid';

const KEY = 'recai.device_id';
let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    let id = await SecureStore.getItemAsync(KEY);
    if (!id) {
      id = uuidv4();
      await SecureStore.setItemAsync(KEY, id);
    }
    cached = id;
    return id;
  } catch {
    // awaryjnie: id tylko na czas sesji (lepsze niż brak nagłówka → 401)
    cached = cached ?? uuidv4();
    return cached;
  }
}
