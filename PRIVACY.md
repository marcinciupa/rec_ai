# Privacy Policy — Rec+

_Last updated: 17 August 2026_

Hosted version (for Google Play): **https://rec-ai-backend-production.up.railway.app/privacy**

> **Not legal advice.** This document is grounded in how the Rec+ app actually
> processes data. Have it reviewed by a qualified lawyer before relying on it. If you
> have (or later register) a legal/business name, add it to the "Data controller" line.

This Policy explains how the **Rec+** application — Android package
`com.glue010.recai` ("the App", "we", "us") — processes data when you use its
voice-note recording, transcription, and AI-chat features.

**Data controller:** the publisher of the Rec+ app
**Address:** Poland
**Contact:** glue010@gmail.com

## 1. What data we process
- **Audio recordings** — created when you record a note. Stored **locally on your device**. A copy is transmitted to our server and on to our transcription provider only to convert it to text (see §3), then discarded by us.
- **Transcripts and chat messages** — the text produced from your recordings and the questions/answers you exchange with the AI, including recent messages from the same conversation. Stored **locally on your device**.
- **Anonymous device identifier** — a random identifier generated within the App. It is **not** the Android Advertising ID, not a hardware identifier, and is **not** linked to your identity, an account, your name, email, or phone number. It is used solely for abuse prevention and cost control on the server.
- **Technical metadata** — basic, content-free request metadata such as request identifiers, processing status, and timing. This **does not contain the content** of your recordings, transcripts, or chats.

The App **requires no account** and does **not** collect data such as your name, email,
precise or coarse location, contacts, photos, or advertising identifiers. The App
contains **no advertising or analytics SDKs** and does **not** track you across apps
or websites.

## 2. Why we process data (purposes)
- To **convert your recording into text** (transcription).
- To **answer your questions about a note** (AI chat).
- To **prepare a finished transcript for reading** — when a transcription completes, the App
  sends the transcript to the AI provider **on its own, without any question from you**, to
  produce a short note title. This happens for every transcript. When you use the **ADVANCED**
  transcription engine, which returns the text split into speaker segments, the App also asks
  the model to group the text into speaker turns and readable paragraphs, and to pick up a
  speaker's **first name if it is clearly spoken in the recording** (this is how a note can
  show `MRC` instead of `SPEAKER_00`). The **AI SPEAKERS** and **AI PARAGRAPHS** switches in
  Settings turn the turn- and paragraph-grouping requests off; the title and the speaker
  naming are not behind a switch. With the **STANDARD** engine only the title request is made.
- To **operate and secure the service**, including preventing abuse and controlling cost.

## 3. Who we share data with (processors / recipients)
To perform transcription and chat, content is sent from the App to our intermediary
server and from there to AI providers:
- **deAPI** — audio transcription (Whisper model). We send the audio file, the language you selected and the transcription engine you chose. The file name is a random identifier, never the note title. If you dictate a question inside the AI chat, that short recording is transcribed the same way and is deleted from your device immediately afterwards. The **ADVANCED** engine additionally asks deAPI to separate speakers and return per-word timings.
- **OpenRouter** (and the connected large language model — currently Google Gemini 2.5 Flash Lite) — used both for chat about a note **and for the automatic preparation of a finished transcript described in §2**. We send the transcript (or an extract of it) and the question — either the one you typed or one the App forms by itself; for chat we also send up to the **last 12 messages** of that same conversation.
- **Railway** — hosting of our intermediary server.

Our intermediary server is **stateless**: it does **not** permanently store your
recordings or transcripts — it forwards them only to fulfil your request and then
discards the content (a finished transcript stays in the server's memory for **up to about
25 minutes**, so that a late or repeated delivery can still reach your device, and is then
deleted automatically). Some of these providers may process data on servers
**outside Poland, including outside the European Economic Area (EEA)/UK**. Their
processing is governed by their own privacy policies and terms — please review
deAPI's, OpenRouter's, and Railway's policies for where and how they process data.

> **Please note:** voice recordings may incidentally contain sensitive information
> depending on what you say. Avoid recording content you would not want processed by
> the AI providers listed above.

If you use the **SHARE** action on a note, the App hands the audio file to whichever app you
pick (messaging, mail, cloud storage). That transfer is initiated by you and goes directly
from your device to that app; what happens to the file afterwards is governed by that app's
privacy policy, not this one.

## 4. Where and how long we keep data
- **On your device:** recordings, transcripts and chat messages are kept locally until you **delete** them in the App or **uninstall** the App. Deleting a note removes it from the App immediately (its transcript and chat go with it); the audio file itself is kept a little longer so that **UNDO** can bring the note back, and is erased the next time the App starts.
- **On the server:** content is **not permanently stored** and is never written to a database — it is processed transiently for the duration of the request. A finished transcript stays in the server's memory for **up to about 25 minutes** and is then deleted automatically. Content-free technical metadata may appear in our hosting provider's server logs and is kept according to that provider's log-retention policy.
- **At the AI providers:** retention is governed by each provider's own policy.

## 5. Legal bases for processing (GDPR — EU/EEA/UK users)
Where the EU/UK General Data Protection Regulation applies, we rely on:
- **Performance of a service you request** (Art. 6(1)(b)) — to transcribe a recording and to answer your chat questions, because these features cannot work without sending the relevant content to our processors.
- **Consent** (Art. 6(1)(a)) — for access to your device microphone, which you grant through the operating system permission prompt and can withdraw at any time in your device settings.
- **Legitimate interests** (Art. 6(1)(f)) — to keep the service secure and prevent abuse and runaway cost, using the anonymous identifier and technical metadata. You may object to this processing (§6).

## 6. Your rights
Depending on where you live, you may have the right to **access, rectify, erase,
restrict, or object to** processing of your personal data, to **data portability**,
and to **withdraw consent**. You can exercise core controls directly in the App:
- **Delete any recording** at any time in the App.
- **Uninstall the App** to remove all data stored locally on your device.

To make a rights request at the server level, contact us at the address above.
Because the App uses no account and only an anonymous identifier, we may be **unable
to identify your data** on the server; in that case we will explain why and ask for
information that lets us locate it (GDPR Art. 11). **EU/EEA/UK users** also have the
right to lodge a complaint with a supervisory authority (in Poland: the President of
the Personal Data Protection Office, UODO).

## 7. U.S. state privacy rights (including California — CCPA/CPRA)
We **do not "sell"** your personal information and **do not "share"** it for
cross-context behavioral advertising, as those terms are defined under the California
Consumer Privacy Act (as amended by the CPRA). We do not use your data for targeted
advertising. California residents (and residents of other U.S. states with similar
laws) may have the right to **know, access, delete, and correct** personal
information and to be **free from discrimination** for exercising these rights. To
exercise these rights, contact us at the address above.

## 8. Permissions
- **Microphone** (`RECORD_AUDIO`) — the only permission the App asks you for. Required to record voice notes; recording happens only after you start it in the App.

The App also declares these technical permissions, none of which prompts you and none of
which gives access to your location, contacts, photos, or an advertising identifier:
- `INTERNET`, `ACCESS_NETWORK_STATE` — to send a recording for transcription and to use AI chat.
- `MODIFY_AUDIO_SETTINGS`, `VIBRATE`, `WAKE_LOCK` — playback routing, the haptic feedback on the on-screen keys, and keeping the screen awake while you record.
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` — so playback can continue while the App is in the background.
- `USE_BIOMETRIC`, `USE_FINGERPRINT` — declared by the secure-storage component that keeps the anonymous device identifier. The App never asks you to authenticate.
- `SYSTEM_ALERT_WINDOW` — declared by the app framework. The App does not draw over other apps and never asks you to enable this.
- `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, limited to **Android 12L and older** — legacy file-access permissions declared by the framework. Your recordings are written to the App's own private storage, not to shared storage.

## 9. Security
Connections to our server are encrypted in transit (HTTPS). The **AI providers' API keys
(deAPI, OpenRouter) live only on our server and are never shipped inside the App.** The App
does carry one key of its own, which only lets our server tell requests coming from the App
apart from random traffic — it identifies the App, not you, and unlocks no personal data. No
method of transmission or storage is 100% secure, but we apply reasonable safeguards.

## 10. Children
The App is **not directed to children under 13** (and, where applicable, under the
age of digital consent in your country, which can be up to 16 in the EU) and we do
not knowingly collect their personal data. If you believe a child has provided us
data, contact us and we will delete it.

## 11. Changes to this Policy
We may update this Policy. We publish changes at the same address with an updated
"Last updated" date. Material changes will be highlighted where practicable.

## 12. Contact
Rec+ · Poland · glue010@gmail.com
