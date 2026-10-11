// Experimental car connection: reads live speed from a Bluetooth LE OBD-II
// adapter (ELM327-style, ~$15) using Web Bluetooth. Works in Chrome on Android
// and on computers. iPhone browsers don't support Web Bluetooth.
const SERVICES = [
  0xfff0, 0xffe0, 0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // common iCar/Vgate BLE adapters
];

export const obdSupported = () => !!navigator.bluetooth;

export async function connectObd({ onSpeed, onStatus }) {
  if (!navigator.bluetooth) throw new Error('Car connection needs Chrome on Android or a computer. iPhone browsers can’t use Bluetooth.');
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  onStatus?.(`Connecting to ${device.name || 'adapter'}…`);
  const server = await device.gatt.connect();

  let notifyChar = null, writeChar = null;
  for (const id of SERVICES) {
    let svc;
    try { svc = await server.getPrimaryService(id); } catch { continue; }
    const chars = await svc.getCharacteristics();
    notifyChar = chars.find((c) => c.properties.notify || c.properties.indicate) || null;
    writeChar = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse) || null;
    if (notifyChar && writeChar) break;
  }
  if (!notifyChar || !writeChar) { device.gatt.disconnect(); throw new Error('That device doesn’t look like an OBD-II adapter.'); }

  let buffer = '';
  let waiting = null;
  await notifyChar.startNotifications();
  notifyChar.addEventListener('characteristicvaluechanged', (e) => {
    buffer += new TextDecoder().decode(e.target.value);
    if (buffer.includes('>') && waiting) {
      const text = buffer.replace('>', '').trim();
      buffer = '';
      waiting(text);
      waiting = null;
    }
  });

  const send = (cmd, ms = 3000) => new Promise((resolve) => {
    waiting = resolve;
    buffer = '';
    const data = new TextEncoder().encode(`${cmd}\r`);
    (writeChar.properties.writeWithoutResponse ? writeChar.writeValueWithoutResponse(data) : writeChar.writeValue(data)).catch(() => resolve(''));
    setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(''); } }, ms);
  });

  for (const cmd of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) await send(cmd, cmd === 'ATZ' ? 4000 : 2000);
  onStatus?.(`Connected to ${device.name || 'car'}. Reading speed…`);

  let timer = null;
  let stopped = false;
  const poll = async () => {
    if (stopped) return;
    const r = (await send('010D')).replace(/\s/g, '').toUpperCase();
    const i = r.indexOf('410D');
    if (i >= 0) {
      const kmh = parseInt(r.slice(i + 4, i + 6), 16);
      if (!Number.isNaN(kmh)) onSpeed?.(kmh / 3.6);
    }
    timer = setTimeout(poll, 1000);
  };
  poll();

  device.addEventListener('gattserverdisconnected', () => { stopped = true; clearTimeout(timer); onStatus?.('Car disconnected.'); });
  return {
    name: device.name || 'OBD-II adapter',
    disconnect() { stopped = true; clearTimeout(timer); try { device.gatt.disconnect(); } catch { /* ignore */ } },
  };
}
