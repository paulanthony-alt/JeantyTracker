// Sunset push notifications.
//
// Reliable server-initiated push needs a backend with VAPID keys, which a static
// app can't host. Instead we use the best options available to an installed PWA:
//   1. Local notifications fired from the service worker.
//   2. Periodic Background Sync (Chromium/Android) to re-check daily in the
//      background and alert without the app open.
//   3. A foreground check every time the app is opened, as a reliable fallback
//      that works everywhere including iOS.

import { loadSettings, saveSettings } from './config.js';
import { fetchConditions } from './api.js';
import { sunsetForecast, sunsetLabel } from './sunset.js';

let swReg = null;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register('./sw.js');
    return swReg;
  } catch (e) {
    console.warn('SW registration failed', e);
    return null;
  }
}

// Hand the service worker the config it needs for background sunset checks
// (it can't read localStorage). Stored in a dedicated cache the SW reads.
export async function pushConfigToSW() {
  const s = loadSettings();
  const payload = {
    location: s.location,
    notifyEnabled: s.notifyEnabled,
    sunsetThreshold: s.sunsetThreshold,
    lastNotifiedDate: s.lastNotifiedDate,
  };
  try {
    const reg = swReg || (await navigator.serviceWorker.getRegistration());
    if (reg && reg.active) {
      reg.active.postMessage({ type: 'config', payload });
    }
  } catch { /* ignore */ }
}

export function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

export function permissionState() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  return result;
}

async function showNotification(title, options) {
  const reg = swReg || (await navigator.serviceWorker.getRegistration());
  if (reg) {
    await reg.showNotification(title, options);
  } else if (Notification.permission === 'granted') {
    new Notification(title, options);
  }
}

export async function sendTestNotification() {
  if (Notification.permission !== 'granted') {
    const p = await requestPermission();
    if (p !== 'granted') return false;
  }
  await showNotification('Jeanty Tracker', {
    body: '🌅 Test alert — this is how you\'ll hear about beautiful sunsets.',
    icon: './assets/logo.svg',
    badge: './assets/logo.svg',
    tag: 'jeanty-test',
  });
  return true;
}

// Attempt to register periodic background sync (best effort).
export async function enableBackgroundChecks() {
  try {
    const reg = swReg || (await navigator.serviceWorker.getRegistration());
    if (reg && 'periodicSync' in reg) {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state === 'granted') {
        await reg.periodicSync.register('sunset-check', {
          minInterval: 12 * 60 * 60 * 1000, // twice a day
        });
        return true;
      }
    }
  } catch { /* not supported — foreground check still runs */ }
  return false;
}

/**
 * Foreground check: on app open, look at upcoming sunsets and notify once per
 * day for the soonest sunset that beats the user's threshold.
 */
export async function checkSunsetAlerts() {
  const s = loadSettings();
  if (!s.notifyEnabled || !s.location) return;
  if (permissionState() !== 'granted') return;

  let data;
  try {
    data = await fetchConditions(s.location.lat, s.location.lon);
  } catch { return; }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sunsetForecast(data).filter(
    (d) => d.date >= today && d.sunsetDate && d.sunsetDate > new Date()
  );

  const hit = upcoming.find((d) => d.score != null && d.score >= s.sunsetThreshold);
  if (!hit) return;
  if (s.lastNotifiedDate === hit.date) return; // already alerted for this one

  const time = hit.sunsetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  await showNotification('Beautiful sunset ahead 🌅', {
    body: `${sunsetLabel(hit.score)} sunset forecast (${hit.score}/100) at ${time}. Head out with the boat!`,
    icon: './assets/logo.svg',
    badge: './assets/logo.svg',
    tag: `jeanty-sunset-${hit.date}`,
    data: { url: './index.html#/sunset' },
  });

  s.lastNotifiedDate = hit.date;
  saveSettings(s);
}
