// S&F League Hub service worker: phone alerts and the Home Screen icon's red number only (no offline caching, so the hub always shows the newest data)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = {body: e.data ? e.data.text() : ""}; }
  e.waitUntil(self.registration.showNotification(d.title || "S&F Baseball", {body: d.body || "", tag: d.tag || undefined, icon: "img/app-192.png?v=2", badge: "img/icon-48.png?v=3", data: {url: d.url || ""}}).then(() => iconBadge(d.badge)));
});
// the red number on the Home Screen icon = alerts still waiting in Notification Center (the hub sets its own count once it's opened)
// Since Nov 23 every alert carries the manager's real unread count (chat + offers waiting), the same number the hub shows inside;
// counting the alerts left in Notification Center gave 66 after a chat night that had already been read.
function iconBadge(n){
  if (!self.navigator || !self.navigator.setAppBadge) return;
  if (typeof n === "number" && n >= 0) return (n ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {});
  return self.registration.getNotifications().then(L => L.length ? self.navigator.setAppBadge(L.length) : self.navigator.clearAppBadge()).catch(() => self.navigator.setAppBadge(1).catch(() => {}));
}
self.addEventListener("notificationclick", e => {
  e.notification.close(); iconBadge();
  const url = new URL("./" + (e.notification.data && e.notification.data.url || ""), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(ws => {
    // an open hub: bring it forward and tell it which page to show, no reload (a reload while iPhone is still waking the app gave the page the wrong screen height; Show, Nov 22)
    for (const w of ws) if (w.url.startsWith(self.registration.scope) && "focus" in w) return w.focus().then(f => (f || w).postMessage({type: "go", url})).catch(() => w.navigate(url).catch(() => {}));
    return self.clients.openWindow(url);
  }));
});
