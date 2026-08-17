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

## 5. Co zmieniłeś po opiniach (300)

> ⚠️ To pytanie pojawia się w formularzu **drugi raz**, w sekcji „Gotowość do etapu
> produkcyjnego" (punkt 10 niżej). **Nie wklejaj dwa razy tego samego tekstu** — recenzent widzi
> oba pola obok siebie. Tutaj podsumuj krótko, a konkrety zostaw do punktu 10 (albo odwrotnie).

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

# Sekcja „Informacje o Twojej aplikacji"

Te pola są opisowe, nie deklaratywne — nie stwierdzają faktów o przebiegu testu, więc można je
napisać wprost. Wszystko poniżej jest wzięte z tego, co apka realnie robi (patrz
`STORE_LISTING_EN.md`), bez obietnic na przyszłość.

## 7. Kim są docelowi odbiorcy? (300)

```
People who think out loud and need the words afterwards: students, journalists, researchers, sales and field workers, and anyone who records meetings, interviews or ideas on the way. They want a recording turned into text they can search and question, not an audio file they never replay.
```
**288 / 300**

**Wariant z dopiskiem o zasięgu i języku (przydatny, bo UI jest tylko po angielsku):**
```
Adults who record spoken notes on a phone — students, journalists, researchers, sales and field workers, and people who capture ideas while walking or driving. They need the recording as text they can read and search, not an audio file nobody replays. No specific region; English UI.
```
**283 / 300**

> Świadomie BEZ deklaracji w stylu „for everyone" i bez grup, których nie obsługujesz. Google
> zestawia tę odpowiedź z oceną treści i Data safety — apka nie jest kierowana do dzieci
> (polityka prywatności mówi to wprost), więc odbiorcy to dorośli.

## 8. Jaką wartość ma aplikacja dla użytkowników? (300)

```
It closes the gap between recording something and being able to use it. The note transcribes itself, gets a title, and is split into paragraphs and speakers, so it is readable. You can ask the AI about what was said, and playback follows the text word by word. No account is needed.
```
**282 / 300**

**Wariant kładący nacisk na prywatność i sterowanie:**
```
A dictaphone that gives the words back. Recordings transcribe themselves, get an AI title and are split by speaker and paragraph; you can ask questions about a note and jump to any line by tapping the text. No account, and recordings and transcripts stay on the device.
```
**269 / 300**

> Każde zdanie odpowiada funkcji, która jest w wydaniu 0.988 — transkrypcja, tytuł od AI,
> podział na akapity i rozmówców, czat o notatce, karaoke co do słowa, brak konta, dane lokalnie.
> Nie ma tu ani jednej obietnicy „na później", bo to pole bywa zestawiane z opisem w sklepie.

## 9. Oczekiwana liczba instalacji w pierwszym roku

Wybierz **najniższy realny przedział** (dla pierwszego wydania bez budżetu marketingowego zwykle
`0–1000`, ewentualnie `1000–10 000`, jeśli masz konkretny kanał dotarcia). To pytanie badawcze —
Google zbiera nim skalę, a nie ocenia ambicję. Zawyżony przedział niczego nie ułatwia, a przy
świeżym koncie bez historii wygląda niespójnie z resztą wniosku.

---

# Sekcja „Gotowość do etapu produkcyjnego"

## 10. Jakie zmiany wprowadziłeś na podstawie testu zamkniętego? (300)

```
Four things testers flagged. The waveform now scales to recent audio instead of sitting at the top. Speakers show name initials taken from the conversation (Marc → MRC) instead of numbers. Long transcripts are split into timestamped paragraphs. Free space is real, not a fixed line.
```
**282 / 300**

**Wariant, jeśli chcesz pokazać też naprawiony błąd (mocniejszy — usterka brzmi wiarygodniej
niż same ulepszenia):**
```
The waveform now scales to recent audio instead of pinning at the top; speakers show name initials from the conversation (Marc → MRC) instead of numbers; long transcripts are split into timestamped paragraphs; free space is real. A bug where auto-transcription ignored the AI settings was fixed.
```
**295 / 300**

> Ta czwórka ma pokrycie w realnych wydaniach: skalowanie waveformu, 0.976 (imiona rozmówców),
> 0.978 (akapity + poprawka AUTO TRANSCRIBE ignorującego AI ENGINE i AI LANGUAGE), 0.975
> (realne wolne miejsce). Jeśli Twoi testerzy zgłaszali co innego — podmień, ale zostaw ten
> kształt: **konkretna obserwacja → konkretna zmiana**, bez „improved performance and fixed bugs".

## 11. Skąd wiesz, że aplikacja jest gotowa na produkcję? (300)

```
No crashes were reported by testers and none appear in my own runs. Every build is verified end to end before upload: record, transcribe on both engines, ask the AI about the note. The privacy policy is live and matches what the code sends, and Data safety matches it too.
```
**272 / 300**

**Wariant kładący nacisk na stabilność zakresu (dobry, jeśli miałeś zgłoszenia awarii i nie
chcesz twierdzić, że ich nie było):**
```
The feature set has been stable for the last releases — recent work only refined the transcript view, not the core. The closed test produced no crash reports, and each build is checked end to end against the production backend before upload. Remaining ideas are additions, not fixes.
```
**283 / 300**

> ⚠️ Zdanie o braku awarii wpisz **tylko jeśli to prawda** — sprawdź wcześniej Android vitals
> w Console; Google ma te dane i zestawi je z odpowiedzią. Jeśli awarie były, napisz wprost,
> co je powodowało i w którym wydaniu zniknęły; to wygląda lepiej niż zaprzeczenie.
>
> Reszta tej odpowiedzi jest weryfikowalna po Twojej stronie: każdy build 0.988 był sprawdzany
> na urządzeniu (nagranie → transkrypcja STANDARD i ADVANCED → czat) oraz bezpośrednio na
> produkcyjnym backendzie, a polityka prywatności pod linkiem ze sklepu jest zgodna z tym, co
> kod naprawdę wysyła (szczegóły w `DEPLOY_0.988.md`).

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
