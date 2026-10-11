// Instant alert invites: each profile gets a private alert channel. Contacts
// open the invite link once and allow notifications; after that a crash
// alert reaches their phone automatically.
import { postJSON } from './util.js';

export async function ensureChannel(profile, persist) {
  if (!profile) return null;
  if (profile.channel?.id && profile.channel?.key) {
    if (profile.channel.name !== profile.name) {
      postJSON(`/api/channels/${profile.channel.id}/name`, { key: profile.channel.key, name: profile.name }).catch(() => {});
      profile.channel.name = profile.name;
      persist();
    }
    return profile.channel;
  }
  try {
    const c = await postJSON('/api/channels', { name: profile.name }, 8000);
    profile.channel = { id: c.id, key: c.key, name: profile.name };
    persist();
    return profile.channel;
  } catch {
    return null;
  }
}

export const inviteLink = (channel) => `${location.origin}/join.html?c=${encodeURIComponent(channel.id)}`;

export async function listSubscribers(channel) {
  if (!channel) return [];
  try {
    const r = await postJSON(`/api/channels/${channel.id}/subscribers`, { key: channel.key }, 8000);
    return r.subscribers || [];
  } catch {
    return null;
  }
}

export function inviteText(profile, link) {
  return `Hi! I added you as an emergency contact in Crashline. Tap this once and allow notifications, so you get an instant alert with my location if I'm ever in a crash: ${link}`;
}

export function smsInviteHref(phone, body) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? `sms:${phone}&body=${encodeURIComponent(body)}` : `sms:${phone}?body=${encodeURIComponent(body)}`;
}
