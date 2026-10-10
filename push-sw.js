/* ENDURA JC push-only service worker. Does not intercept app requests. */
self.addEventListener('push',event=>{
 let data={title:'ENDURA JC',body:'You have a new notification.',url:'./'};
 try{const payload=event.data?.json();if(payload&&typeof payload==='object')data={...data,...payload}}catch{}
 const url=new URL(data.url||'./',self.registration.scope);
 if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))url.href=self.registration.scope;
 event.waitUntil(self.registration.showNotification(String(data.title).slice(0,100),{body:String(data.body).slice(0,250),icon:'./icon-192.png',badge:'./icon-192.png',tag:String(data.tag||'endura-alert'),data:{url:url.href}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{const target=event.notification.data?.url||self.registration.scope;const windows=await clients.matchAll({type:'window',includeUncontrolled:true});for(const win of windows){if(new URL(win.url).origin===self.location.origin){await win.focus();return}}await clients.openWindow(target)})());
});
