/**
 * Wolne miejsce na urządzeniu — REALNE, w miejsce stuba „~311h/32.3GB AVAILABLE", który wisiał
 * zaszyty w czterech miejscach (RecordingScreen ×2, PlaybackScreen, ChatView).
 *
 * Tu jest wyłącznie odczyt z urządzenia i odświeżanie; formatowanie w lib/storage.ts (testowalne).
 * Wariant .web.ts nie ma czego czytać — patrz tam.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
// SDK 56: `Paths.availableDiskSpace` to SYNCHRONICZNA właściwość. Stare
// `FileSystem.getFreeDiskStorageAsync()` jest deprecated i rzuca w runtime, chyba że importowane
// z 'expo-file-system/legacy' — nie używamy go.
import { Paths } from 'expo-file-system';
import { storageLabel, type Quality } from '../lib/storage';

export type { Quality };

/** Odczyt wolnego miejsca. Zwraca null zamiast rzucać — brak odczytu nie może wywalić UI. */
export function readFreeBytes(): number | null {
  try {
    const v = Paths.availableDiskSpace;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Etykieta wolnego miejsca, odświeżana gdy: zmieni się jakość nagrywania (inny bitrate → inne
 * godziny), zmieni się `refreshKey` (np. liczba nagrań — po nagraniu/usunięciu miejsca ubywa lub
 * przybywa) albo apka wróci na wierzch (miejsce mogło zniknąć poza nią).
 */
export function useStorageLabel(quality: Quality = 'HIGH', refreshKey?: unknown): string | null {
  const [free, setFree] = useState<number | null>(() => readFreeBytes());
  const refresh = useCallback(() => setFree(readFreeBytes()), []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return storageLabel(free, quality);
}
