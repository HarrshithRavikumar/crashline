// "Install app" card: native prompt on Android/Chrome, instructions on iPhone.
import { $, store, toast } from './util.js';

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initInstall() {
  const card = $('#installCard');
  const btn = $('#installBtn');
  let deferred = null;

  if (isStandalone() || store.get('crashline.installDismissed', false)) return;

  const showCard = () => { card.hidden = false; };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.textContent = 'Install';
    showCard();
  });

  if (isIOS()) {
    btn.textContent = 'How?';
    showCard();
  }

  btn.onclick = async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      if (outcome === 'accepted') card.hidden = true;
      return;
    }
    $('#installHint').innerHTML = 'Tap the <b>Share</b> button <span aria-hidden="true">(square with an arrow)</span>, scroll down, and choose <b>Add to Home Screen</b>.';
    btn.hidden = true;
  };

  $('#installClose').onclick = () => {
    card.hidden = true;
    store.set('crashline.installDismissed', true);
  };

  window.addEventListener('appinstalled', () => {
    card.hidden = true;
    toast('Crashline installed. Open it from your home screen.');
  });
}
