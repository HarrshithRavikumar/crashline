// Sign-in / create-account panel used in Setup and Settings.
import { toast } from './util.js';
import { socialEnabled, appleEnabled, signInWith, signInEmail, signUpEmail, authError, clearAuthError } from './auth.js';

const GOOGLE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>';
const APPLE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1.1-3.2-1 .1-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg>';

export function renderAuthPanel(container, { onSignedIn, startWith = 'signup' } = {}) {
  let mode = startWith;
  const draw = () => {
    const err = authError();
    container.innerHTML = `
      ${err ? '<p class="auth-error" role="alert"></p>' : ''}
      <div class="social">
        <button type="button" class="social-btn google" data-p="google">${GOOGLE}<span>Continue with Google</span></button>
        <button type="button" class="social-btn apple" data-p="apple">${APPLE}<span>Continue with Apple</span></button>
        <p class="social-msg muted small" aria-live="polite" hidden></p>
        <div class="or"><span>or use email</span></div>
      </div>
      <div class="seg" role="tablist">
        <button type="button" role="tab" data-m="signup" aria-selected="${mode === 'signup'}">Create account</button>
        <button type="button" role="tab" data-m="login" aria-selected="${mode === 'login'}">Sign in</button>
      </div>
      <form class="stack-sm auth-form" novalidate>
        <label ${mode === 'signup' ? '' : 'hidden'}>Name <input name="name" autocomplete="name"></label>
        <label>Email <input name="email" type="email" autocomplete="email" required inputmode="email"></label>
        <label>Password <input name="password" type="password" minlength="8" required autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="${mode === 'signup' ? 'At least 8 characters' : ''}"></label>
        <p class="auth-msg muted small" aria-live="polite"></p>
        <button class="primary" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>
`;
    if (err) container.querySelector('.auth-error').textContent = err;

    container.querySelectorAll('[data-p]').forEach((b) => {
      b.onclick = () => {
        const msg = container.querySelector('.social-msg');
        const p = b.dataset.p;
        const ready = p === 'apple' ? appleEnabled() : socialEnabled();
        if (!ready) {
          msg.hidden = false;
          msg.textContent = p === 'apple'
            ? (socialEnabled() ? 'Apple sign-in is coming soon. Use Google or email for now.' : 'Apple sign-in is coming soon. Use email for now.')
            : 'Google sign-in isn’t connected on this server yet. Use email for now.';
          return;
        }
        clearAuthError();
        b.disabled = true;
        msg.hidden = false;
        msg.textContent = `Opening ${p === 'apple' ? 'Apple' : 'Google'}…`;
        signInWith(p).catch((e) => { b.disabled = false; msg.textContent = `Couldn’t open sign-in: ${e?.message || e}`; });
      };
    });
    container.querySelectorAll('[data-m]').forEach((b) => {
      b.onclick = () => { mode = b.dataset.m; draw(); };
    });
    const form = container.querySelector('form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = container.querySelector('.auth-msg');
      const btn = form.querySelector('button[type=submit]');
      const email = form.email.value.trim(), password = form.password.value;
      if (!email || !password) { msg.textContent = 'Enter your email and password.'; return; }
      btn.disabled = true;
      msg.textContent = mode === 'signup' ? 'Creating your account…' : 'Signing in…';
      try {
        const u = mode === 'signup' ? await signUpEmail(email, password, form.name.value.trim()) : await signInEmail(email, password);
        clearAuthError();
        onSignedIn?.(u, mode);
      } catch (err2) {
        msg.textContent = err2.message;
        if (/already an account/i.test(err2.message)) { mode = 'login'; draw(); container.querySelector('input[name=email]').value = email; container.querySelector('.auth-msg').textContent = err2.message; }
      } finally {
        btn.disabled = false;
      }
    };
  };
  draw();
}
