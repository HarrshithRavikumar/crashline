# Crashline

**Crash safety for the people car safety tech forgets.**

Social Good track · presented by Cox Automotive · HackGT 2027 season

## The problem

Crash detection exists, but it's built for one person: an English-speaking driver in a newer car with a flagship phone. Everyone else is left out:

- **People on bikes, scooters, and wheelchairs, and people walking**, the most likely to be badly hurt when a car hits them, get no crash detection and no guidance built for them.
- **People who don't speak English** are alone at the scene, unable to explain what happened to police, and often blamed because of it.
- **Neighborhoods** only get a dangerous intersection fixed after someone dies there, because near misses are never recorded.

## What Crashline does

### 1. Detection for every way people travel
Pick **Car, Bike, Scooter, Wheelchair, or Walking**. Each mode has its own thresholds for:
- **Crashes**: a big impact plus a second signal (no movement after, a sudden speed drop, or a loud crash sound), then a countdown with a big “I’m OK” button. If you don't cancel, your contacts get your location by text.
- **Near misses**: sustained hard braking or swerving below crash level, logged automatically.
- **Close calls**: one tap when a car passes too close. Sensors can't feel that, but riders can.

After a crash, the quick check and steps change by mode. On a bike, it asks about head hits and whether the driver left, and walks you through a hit-and-run report.

### 2. Language bridge
- **Face-to-face translator.** The top half faces the officer (flip it upside down so they can read across from you), the bottom half faces you. Speak or type, and each side sees and hears the other in their own language.
- **Phrase cards that work offline**, in Spanish, Chinese, Vietnamese, Korean, Arabic, Haitian Creole, Portuguese, French, and Hindi: “I need an interpreter,” “I am hurt,” “A car hit me,” and more. Tap one and the phone shows and says it in English.
- **Know your rights** card, translated into your language.
- AI guidance after a crash comes back in your language, and the alert tells your contacts you may need an interpreter.

### 3. City safety map (`/map.html`)
Every near miss, close call, and crash is shared anonymously (location rounded to about 50m, hour-level time, no name or ID). The map ranks the most dangerous spots, filters by who's at risk (cyclists, pedestrians, wheelchair users...), updates live, and exports a CSV a city transportation department can use.

### 4. Black box, auto-start, and integrations (Settings)
- **Black box:** the minute of motion and GPS before a crash is always saved, plus 10 seconds after. Turn on **Dashcam** to also keep video from the phone's camera. Saved only on the phone, with a SHA-256 fingerprint, and the server timestamps the fingerprint (never the video) to prove when it existed.
- **Auto-start:** with Crashline open, it starts a trip when you start moving and guesses walk, bike, or drive from your speed. It ends the trip after 3 minutes stopped.
- **Phone automations:** links like `/?start=car` start a trip. Use them in iPhone **Shortcuts** (CarPlay or car Bluetooth connects) or Android routines. Settings shows OS-specific steps.
- **Car:** experimental OBD-II speed over Web Bluetooth (Chrome on Android or a computer).
- **Google sign-in:** backs up the profile and contacts and restores them on any device (through Auth0).
- **Emergency texts:** opt in or out of automatic texts, and send contacts a one-time heads-up text.
- **PC layout:** on wide screens the home page becomes a dashboard with a live city map and a live report feed.

**What a website can't do (native app roadmap):** run detection in the background with the app closed, read Apple Health or Health Connect, and run on CarPlay or Android Auto screens.

## Accounts
- **Email + password** works out of the box: Settings → Account, or “Sign in / sign up” on the setup screen. The profile, contacts, and alert invites sync to any device you sign in on.
- **Google and Apple** sign-in go through Auth0 (free, about 10 minutes, and it counts for the Auth0 prize):
  1. auth0.com → **Applications → Create Application → Single Page Application**.
  2. In **Settings**, put your site (e.g. `https://45-76-248-250.sslip.io, http://localhost:3000`) in **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins**. Save.
  3. **Authentication → Social**: Google works right away with Auth0's dev keys. For **Apple**: Social → Create Connection → Apple → leave the key fields blank (Auth0's test keys) → Create → **Applications** tab → turn on Crashline. Then set `AUTH0_APPLE=true`. For production, Apple requires an Apple Developer account ($99/yr).
  Callback URLs must match exactly, including the trailing slash: list both `https://YOUR-SITE` and `https://YOUR-SITE/`.
  4. Add to `.env`: `AUTH0_DOMAIN=dev-xxxx.us.auth0.com`, `AUTH0_CLIENT_ID=xxxx`, and optionally `AUTH0_APPLE=true`. Redeploy.
  If sign-in fails, the app shows exactly which Auth0 setting is missing.

## Automatic alerts after a crash
When the countdown runs out (or you tap “Send help now”), Crashline creates a **live alert page** and sends it through every channel that's set up:
- **The live alert page** (what contacts open): who crashed, when, how they were traveling, a live map that follows their phone for up to an hour, medical notes, **Call them** and **Call 911** buttons, and reply buttons (*I've seen this*, *I'm on my way*, *I called 911*, *I reached them*). Replies appear on the crashed phone and are read aloud. When they tap “I'm safe”, contacts get a “marked safe” update. Links expire after 48 hours.
- **Instant alerts (free, no setup):** Settings → Emergency alerts → **Invite contacts**. Each contact opens the link once and allows notifications. A crash then buzzes their phone, and tapping the notification opens the live page.
- **Email:** add contacts' emails and set `SMTP_USER` and `SMTP_PASS` (Gmail App password).
- **Text messages (Twilio):** US carriers block unregistered senders, so set this up a few days ahead. Buy a **toll-free number** in Twilio, submit **Toll-Free Verification** (free; describe it as "emergency crash alerts to contacts who opted in"), and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. Twilio free trials can't send custom text. Textbelt's terms forbid life-safety use.
- **Texts from your own iPhone (free, automatic):** Settings → *Auto-text from my iPhone*. Every phone gets a random token. When the countdown ends, the server saves the recipients and message under that token and emails the user's iCloud address with the subject `CRASHLINE SOS <token>` (plain and link-free, so iCloud doesn't bounce it). One shared Shortcut, **Crashline SOS**, reads the token from the subject, fetches `/s/<token>` (JSON `{to, text}`), and texts each contact from the user's own number. Contacts live in the app, so nobody edits the Shortcut. Build it once (steps are in the app), share it with **Copy iCloud Link**, and set `SHORTCUT_URL` in `.env`. After that, anyone can set it up: add their iCloud email, tap **Add Shortcut**, and create an Email automation (Sender = your SMTP address, Subject contains `CRASHLINE SOS`, Run Immediately). **Send test** texts the user's own number. Jobs expire after 30 minutes.
- **Backup:** “Text my contacts from this phone” opens a pre-filled text, including the live link.

## How crash detection works
Instead of a single g-force threshold, every jolt above the trigger becomes a *candidate* that's scored over the next 3 seconds on:
- **Impact:** peak force, how long it lasts (crashes ≈ 50–150 ms, a dropped phone ≈ one sample), and the implied velocity change
- **Free fall:** weightless right before the hit means a dropped phone, a strong signal against (unless speed also collapsed)
- **Rotation and tip-over:** tumbling, and how far "down" changed (a bike ends up on its side)
- **Speed:** moving, then stopped (GPS or the car's OBD-II port). Kept moving counts against; already stopped (rear-ended at a light) is neutral
- **Aftermath:** still afterward counts toward a crash, picked up or walking again counts against. "Still" only counts if GPS also says you stopped
- **Sound:** a loud bang at the same moment (optional)
- **Severe sustained impacts** (≥2× trigger for ≥60 ms, no free fall) always alarm

Weights differ for drivers, riders (bike, scooter, wheelchair), and pedestrians. Near misses come from sustained hard braking or swerving, plus GPS hard-braking. **Sensitivity** (Fewer alarms / Balanced / More sensitive) sets the confidence needed: 72% / 62% / 52%.

**Detection Lab** (Settings) replays 11 recorded situations, crashes and look-alikes, through the real engine: car crash, hard braking, pothole, phone dropped (parked, while driving, while walking), bike crash, curb bump, pedestrian hit, rear-ended at a light, and a crash with no GPS. `npm test` runs the same checks at all three sensitivities (11/11 pass).

## People on Crashline
Signed-in users can find contacts who already use Crashline (Settings → **People on Crashline** → *Find my contacts*, or search by exact phone or email) and send an "emergency contact" request. The other person gets a notification, accepts, and their phone then receives your crash alerts automatically, with no invite link. Each person can turn on **Alerts on this phone**, see who they protect, stop or remove anyone, and turn off being findable.

## What the crash alert looks like
`🚨 Maria Lopez may have crashed`, followed by *Biking · 4:17 PM · didn't cancel the crash alarm · 📍 Near Peachtree St NE, Midtown · ⚕️ medical notes · Tap for live map, call, and reply*, with **Open live map** and **I'm on my way** buttons. It uses an SOS vibration and stays on screen until it's handled. If nobody replies within 2 minutes, everyone gets a second alert: **"⚠️ No one has responded"**.

## Delete profile
Settings → **Delete my profile** removes the profile, contacts, alert invites (and everyone subscribed to them), live alerts, black-box recordings, the server copy, and the email account if you made one.

## Contacts from your phone
- **Android (Chrome):** “Choose from my contacts” opens the phone's contact picker.
- **iPhone:** websites can only open contacts after a one-time switch: **Settings → Apps → Safari → Advanced → Feature Flags → Contact Picker API** (on). Reload Crashline and “Import from my contacts” opens the iPhone contact picker. Otherwise use “Import contact card” (Contacts → Share Contact → Save to Files). A native app would get the normal contacts permission prompt.
- **Computers:** “Import contact card” with a .vcf file.

## Run it

```bash
npm install
npm start
```
- App: http://localhost:3000
- City map: http://localhost:3000/map.html

The map starts with **sample data** around Georgia Tech and Midtown so it isn't empty. It's clearly labeled, and you can hide it with the “Show sample data” toggle. To start fresh, stop the server and delete the `data` folder.

### Optional keys (`cp .env.example .env`)
| Variable | Turns on |
|---|---|
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | Live two-way translation, translated rights card, AI-tailored steps in the user's language. Either works. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Automatic texts to contacts. Trial accounts can only text numbers you've verified. |

Without keys: phrase cards, the built-in guide, near-miss mapping, and SMS from your own phone all still work.

## Put it online on Vultr (no GitHub, counts for the Vultr prize)

1. Claim Vultr credits from the Hacklanta MLH prizes page, then deploy a server: **Cloud Compute → Shared CPU → Ubuntu 24.04**, smallest plan, a US East region. Copy its **IP address** and **root password**.
2. From this folder on your Mac:
   ```bash
   bash deploy/push.sh YOUR_SERVER_IP
   ```
   Enter the root password when asked. A few minutes later it prints `https://YOUR-IP.sslip.io`, a real HTTPS link with no domain needed.
3. **With a GoDaddy Registry domain** (also a prize): in the domain's DNS settings, add an **A record** for `@` pointing to your server IP, wait a few minutes, then run:
   ```bash
   bash deploy/push.sh YOUR_SERVER_IP yourdomain.xyz
   ```
4. To push code changes later, run the same command again.

Logs on the server: `ssh root@IP journalctl -u crashline -f`

## Put it online as an app (Render, free)

This gives Crashline a permanent https link that anyone can install on their phone. No tunnel needed.

1. **Push to GitHub.** Create an empty repo called `crashline` on github.com, then in this folder:
   ```bash
   git init && git add . && git commit -m "Crashline"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/crashline.git
   git push -u origin main
   ```
   `.env` (your keys) is in `.gitignore`, so it is **not** uploaded.
2. **Deploy.** On render.com, sign in with GitHub, then choose **New → Blueprint** and pick the `crashline` repo. Render reads `render.yaml`, asks for your `GEMINI_API_KEY` (leave the Twilio ones blank if you don't have them), and deploys.
3. **Install on a phone.** Open the `https://crashline-xxxx.onrender.com` link.
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** tap **Install** on the card at the top, or menu → **Install app**.

It opens full screen with its own icon and works offline after the first load.

**Free tier notes:** the app sleeps after 15 idle minutes and takes about a minute to wake, so open it a few minutes before judging. Live map reports reset when it sleeps (the sample data reloads automatically). To update after a code change: `git add . && git commit -m "update" && git push`, and Render redeploys on its own.

AI and texting routes are rate-limited per visitor so a public link can't burn through your keys.

### On a phone without deploying
Sensors and the mic need HTTPS. In a second terminal:
```bash
npx localtunnel --port 3000
```
Open the https link on your phone. If it asks for a password, open https://loca.lt/mytunnelpassword on the laptop and enter that number. Voice input works best in Chrome on Android and Safari on iPhone.

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

## Files

```
server.js            Alerts, AI guidance, translation, event storage, hotspot API, CSV export
lib/seed.js          Sample Atlanta data (labeled as sample)
public/index.html    App screens
public/app.js        Trips, modes, crash flow, guidance, report
public/detector.js   Crash and near-miss detection per mode
public/guidance.js   Modes, triage questions, offline steps
public/talk.js       Language bridge
public/i18n.js       Languages, phrase cards, rights card
public/map.html/.js  City safety map
public/sw.js         Offline caching
```

Crashline gives general safety information. It is not a substitute for emergency services or legal advice.
