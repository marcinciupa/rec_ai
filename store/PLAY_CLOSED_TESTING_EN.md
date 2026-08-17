# Play Console — „Informacje o teście zamkniętym" (wniosek o dostęp do produkcji)

> Gotowe odpowiedzi EN do formularza, który Google pokazuje kontom osobistym przy ubieganiu się
> o produkcję (po ≥14 dniach testu zamkniętego z ≥12 testerami).
> Limit każdego pola: **300 znaków**. Liczniki poniżej policzone `len()`, nie na oko.
>
> ⚠️ **To jest oświadczenie składane Google'owi, nie tekst marketingowy.** Miejsca w `[nawiasach]`
> uzupełnij prawdą — reszta jest napisana pod to, co w tym projekcie realnie się wydarzyło
> (te punkty widać w historii wydań 0.975–0.988). Jeśli któreś zdanie nie opisuje Twojego testu,
> zmień je, zamiast zostawiać. Powody odrzuceń są zwykle dwa: odpowiedzi generyczne („testers
> liked the app, no major issues") albo sprzeczne z tym, co Google i tak widzi w Console —
> liczbą uczestników opt-in, długością testu i historią wydań.

---

## 1. Jak pozyskałeś testerów? (300)

**Wariant A — znajomi i rodzina (najczęstszy, i najbezpieczniejszy, jeśli tak było):**
```
I recruited testers myself, one by one: friends, family and former colleagues who take voice notes at work — meetings, interviews, notes while driving. I asked them directly by phone and messenger and sent them the opt-in link. [N] joined. I did not use a paid testing provider.
```
**278 / 300**

**Wariant B — znajomi + grupy deweloperskie wymieniające się testami:**
```
Partly friends and family, partly people I asked in indie developer groups where testers are swapped between small apps. I contacted each person directly and sent the opt-in link; [N] joined and installed it on their own phone. No paid testing provider was used.
```
**262 / 300**

> Jeśli korzystałeś z **płatnego** dostawcy testerów — napisz to wprost i podaj nazwę. Google
> pyta o to nie po to, żeby karać, tylko żeby wiedzieć; zatajenie i późniejsza niezgodność
> z danymi jest gorsza niż sam fakt.

## 2. Jak łatwo było pozyskać testerów? (wybór)

Rekomendacja: **„Trudno"** — dla jednoosobowego projektu bez budżetu to szczera i typowa
odpowiedź; wymóg 12 osób przez 14 dni jest realną barierą. To pytanie badawcze, nie ocena
wniosku, więc nie ma sensu wybierać „Łatwo" na pokaz. Wybierz „Bardzo trudno", jeśli zbieranie
kompletu zajęło Ci więcej niż kilka dni.

## 3. Zaangażowanie testerów (300)

```
They used it as a real dictaphone on their own phones: recording notes, letting them transcribe, reading the transcript and asking the AI about it. Recording and transcription were used most. The AI chat and the ADVANCED engine with speaker separation were tried by fewer testers.
```
**280 / 300**

> To pytanie wprost dopuszcza odpowiedź „nie wszystkie funkcje" — i taka odpowiedź jest
> **wiarygodniejsza** niż deklaracja, że każdy tester przeszedł wszystko. Jeśli u Ciebie było
> odwrotnie (np. nikt nie tknął czatu), napisz to; różnice względem realnego użycia to dokładnie
> to, o co pytają.

## 4. Podsumowanie opinii + jak je zebrałeś (300)

```
Collected informally — messenger threads, phone calls and screenshots; no survey. Main points: the waveform looked flat at normal speech level, speakers were shown as numbers, long transcripts arrived as one block of text, and the free-space line showed a fixed value.
```
**268 / 300**

> Każdy z tych czterech punktów ma odpowiednik w realnych wydaniach (0.975 wolne miejsce,
> 0.976 imiona rozmówców, 0.978 akapity, skalowanie waveformu) — dlatego ta odpowiedź trzyma się
> kupy razem z historią wersji, którą Google widzi. Podmień punkty na te, które faktycznie
> dostałeś.

## 5. Co zmieniłeś po opiniach (300) — pytanie zwykle następne

```
Every point became a release. The waveform now scales to the last seconds of audio, speakers get name initials taken from the conversation (Marc → MRC), long transcripts are split into timestamped paragraphs, and free space is computed from the real bitrate. Current build: 0.988.
```
**280 / 300**

## 6. Co dalej testujesz (300) — jeśli pole się pojawi

```
Testing continues on the closed track. Next I want feedback on the ADVANCED engine on longer, multi-speaker recordings, on battery use during long sessions, and on the joystick navigation, which is unusual and I want to know whether new users find it natural.
```
**259 / 300**

---

## Zanim wyślesz — sprawdź zgodność z tym, co Google i tak widzi

1. **Liczba testerów** w odpowiedzi ≥ liczba uczestników opt-in w Console. Nie zawyżaj.
2. **Długość testu** — wniosek ma sens po pełnych 14 dniach ciągłego testu zamkniętego.
3. **Historia wydań** — opowieść „opinie → zmiany" musi pasować do dat i treści wydań na torze
   zamkniętym. Tu pasuje: 0.975 → 0.976 → 0.978 → 0.988 to realny ciąg poprawek.
4. **Polityka prywatności** — pod linkiem stoi aktualna wersja EN dla `Rec+`
   (https://rec-ai-backend-production.up.railway.app/privacy), zgodna z Data safety.
5. **Nazwa** — w Console tytuł powinien być spójny z tym, co widzi użytkownik na urządzeniu.
   ⚠️ Apka w środku wciąż wita napisem `WELCOME TO REC_AI` i pokazuje `REC_AI` w oknie INFO oraz
   w stopce Ustawień, mimo że sklep i polityka mówią `Rec+`. Recenzent może to wychwycić jako
   niespójność. Poprawka to trzy stringi + nowy build (0.989).
