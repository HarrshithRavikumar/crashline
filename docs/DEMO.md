# Crashline: demo and judging notes

Internal notes for HackGT. For setup, see the [README](../README.md).

## Demo script (about 3 minutes)

Setup: the laptop shows the city map full screen on the projector. Phone A belongs to “Maria,” who speaks Spanish and is set to **Bike** mode with demo mode on. A teammate's phone is her emergency contact.

1. **Hook (20s).** “Crash detection today is built for one kind of person. If you're on a bike, or you don't speak English, you're on your own. And the intersection that hurt you won't get fixed until someone dies there.”
2. **The map (20s).** Point to the projector. “These are near misses around campus. Edgewood and Boulevard: four crashes, fourteen near misses, mostly bikes and scooters.” Filter to Bikes.
3. **Near miss, live (20s).** Start a trip on phone A and give it a medium shake. A beep on the phone, and a few seconds later the projector pulses: *“New near miss reported just now by a cyclist.”* Tap **Log a close call** too.
4. **The crash (25s).** Shake hard and set the phone down. Countdown, alarm. Let it hit zero. The teammate holds up their phone with the alert: location, “they speak Spanish.”
5. **After the crash (25s).** Answer: hit my head? Yes. Driver still there? *No, they left.* The steps jump to hit-and-run reporting and head injury.
6. **Language bridge (40s).** A teammate plays the officer in English. Flip the top half toward them. They ask, “Are you hurt?” and Maria's half shows it in Spanish and reads it aloud. Maria taps *Un carro me golpeó* and the phone says “A car hit me” in English. Then airplane mode: the phrase cards still work.
7. **Close (20s).** Download the CSV. “Every near miss becomes evidence a city can act on, before someone dies. Crashline protects the people car safety forgets, and fixes the streets that hurt them.”

**Backups:** “Simulate near miss” and “Simulate crash” run the same flows if sensors misbehave on stage. Phrase cards work if the venue Wi‑Fi dies.

## Likely judge questions

- **False alarms?** Real-mode crashes need a big impact *and* a second signal, then a cancel window. Near misses need sustained force while moving, so a phone drop doesn't count.
- **Privacy?** Map reports are snapped to a ~50m grid with hour-level time and no identifiers. Profiles stay on the phone. Sharing can be switched off.
- **Why would cities trust this data?** It complements police reports, which only cover crashes. Near misses are the leading indicator that Vision Zero programs say they're missing.
- **Translation mistakes?** Phrase cards are fixed and reviewed. Live translation is labeled as such, and the first phrase card asks for a human interpreter.
- **Why Cox?** Mobility safety data, insurance-ready incident reports, and fleet use (delivery riders on e-bikes and scooters) all fit their world.

## Team split

| Person | Owns |
|---|---|
| 1 | Detection tuning per mode on real phones and bikes (`public/detector.js`) |
| 2 | City map polish and the data story: pitch numbers, CSV, filters (`public/map.*`, `lib/seed.js`) |
| 3 | Language bridge: test voice input per language, review phrase cards with native speakers (`public/talk.js`, `public/i18n.js`) |
| 4 | Pitch, demo rehearsal, Devpost write-up, video |

Get a native speaker to double-check each phrase card before judging.

## Before you go on stage

- Run one full test: start a trip, simulate a crash, lock the phone, and let the countdown finish.
- Open the live alert page on a second phone so there's something on screen while the text arrives.
- The auto-text email can take 5–30 seconds. Keep talking through it.
