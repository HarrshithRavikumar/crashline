// Getting emergency contacts from the phone's address book.
// Android Chrome: the built-in contact picker. iPhone and computers:
// import a contact card (.vcf), e.g. Contacts → Share Contact → Save to Files.
export const pickerSupported = () => 'contacts' in navigator && 'ContactsManager' in window;

export async function pickContacts() {
  const props = ['name', 'tel'];
  try {
    const avail = await navigator.contacts.getProperties();
    if (avail.includes('email')) props.push('email');
  } catch { /* older Chrome */ }
  const picked = await navigator.contacts.select(props, { multiple: true });
  return picked.map((c) => ({
    name: (c.name?.[0] || '').trim(),
    phone: (c.tel || []).find(Boolean) || '',
    email: (c.email || []).find(Boolean) || '',
  })).filter((c) => c.phone || c.email);
}

// Minimal vCard parser: FN/N, TEL (prefers cell), EMAIL. Handles folded lines.
export function parseVcards(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  return cards.map((card) => {
    const lines = card.split('\n');
    let name = '', n = '', email = '';
    const tels = [];
    for (const line of lines) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).toUpperCase();
      const val = line.slice(i + 1).trim();
      const base = key.replace(/^ITEM\d+\./, '').split(';')[0];
      if (base === 'FN') name = val;
      else if (base === 'N') n = val.split(';').slice(0, 2).reverse().filter(Boolean).join(' ');
      else if (base === 'TEL') tels.push({ val: val.replace(/^tel:/i, ''), cell: /CELL|MOBILE|IPHONE/.test(key) });
      else if (base === 'EMAIL' && !email) email = val;
    }
    const tel = (tels.find((t) => t.cell) || tels[0])?.val || '';
    return { name: (name || n).replace(/\\,/g, ',').trim(), phone: tel, email };
  }).filter((c) => c.phone || c.email);
}

export function readVcardFiles(files) {
  return Promise.all([...files].map((f) => f.text())).then((texts) => texts.flatMap(parseVcards));
}
