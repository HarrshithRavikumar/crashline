// Detects the phone's OS and builds OS-specific setup guides.
export function platform() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return { ios, android, desktop: !ios && !android, standalone, name: ios ? 'iPhone' : android ? 'Android' : 'computer' };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function phoneGuide(p, origin) {
  const link = (mode) => `${origin}/?start=${mode}`;
  const copyRow = (label, mode) =>
    `<div class="copy-row"><span>${esc(label)}</span><code>${esc(link(mode))}</code><button class="ghost small" data-copy="${esc(link(mode))}">Copy</button></div>`;

  const links = `
    <p class="muted small">Automation links. Opening one starts a trip in that mode:</p>
    ${copyRow('Drive', 'car')}${copyRow('Bike', 'bike')}${copyRow('Scooter', 'scooter')}${copyRow('Walk', 'walk')}`;

  if (p.ios) {
    return `
      <ol class="guide">
        <li><b>Add to Home Screen</b> (Share → Add to Home Screen) so it runs full screen and offline.</li>
        <li><b>Start drives automatically with CarPlay or your car’s Bluetooth:</b> open the <b>Shortcuts</b> app → Automation → New → <b>CarPlay</b> (or <b>Bluetooth</b> and pick your car) → “When connects” → Run Immediately → add <b>Open URLs</b> with the Drive link below.</li>
        <li><b>Turn on Emergency SOS and Medical ID</b> in iPhone Settings. Crashline works alongside them, and covers bikes, scooters, and walking.</li>
        <li>iPhone asks for <b>motion access</b> each time you start a trip. That’s an Apple rule for websites, so a trip opened from an automation shows a big Start button to tap.</li>
      </ol>${links}`;
  }
  if (p.android) {
    return `
      <ol class="guide">
        <li><b>Install</b> from the card on the home screen (or Chrome menu → Install app).</li>
        <li><b>Start drives automatically when your car connects:</b> in Samsung <b>Modes and Routines</b> (or a free app like MacroDroid), add “Bluetooth device connected → your car” and the action “Open website” with the Drive link below.</li>
        <li><b>Connect to your car</b> with a Bluetooth OBD-II adapter in the Car section to read real speed from the car.</li>
        <li>Keep Crashline on screen during trips (phone mount). Android lets it keep the screen awake.</li>
      </ol>${links}`;
  }
  return `
    <p>You’re on a computer. Crashline’s sensors are on your phone. Scan this code to open it there:</p>
    <div class="qr" id="qrBox"></div>
    <p class="muted small">${esc(origin)}</p>`;
}
