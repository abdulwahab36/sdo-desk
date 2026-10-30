const C='sdo-desk-v28';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./fflate.js','./drive.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C&&k!=='sdo-alarm').map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||!e.request.url.startsWith(self.location.origin))return;
 e.respondWith(fetch(e.request.url,{cache:'no-cache',credentials:'same-origin'}).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(ws=>ws.length?ws[0].focus():clients.openWindow('./')))});
self.addEventListener('periodicsync',e=>{if(e.tag==='sdo-check')e.waitUntil(bgCheck())});
const ymdS=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
function addD(s,n){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return ymdS(d)}
function alarmLines(st,now){const t=ymdS(now),dow=(now.getDay()+6)%7,ws=addD(t,-dow),out=[];
 Object.values(st.subs||{}).forEach(x=>{const n=st.ws===ws?x.n:0,s=st.ws===ws?x.sub:0,nm=x.name;
  if(dow===2&&n===0)out.push(nm+': no inspection yet this week. 3 needed by Friday.');
  else if(dow===3&&n<2)out.push(nm+': only '+n+' of 3 inspected. Notes due Friday.');
  else if(dow===4&&(n<3||s<3))out.push(n<3?nm+': only '+n+' of 3 inspected. Today is the target day.':nm+': '+s+' of 3 notes submitted. Submit today.');
  else if(dow===5&&(n<3||s<3))out.push('Final: '+nm+' '+n+'/3 inspected, '+s+'/3 notes to Division.')});
 const od=(st.dates||[]).filter(d=>d<t).length,dt=(st.dates||[]).filter(d=>d===t).length;if(od||dt)out.push(od+' overdue, '+dt+' due today');
 (st.ev||[]).filter(x=>x.d===t).forEach(x=>out.push('Today: '+(x.tm?x.tm+' ':'')+x.t));if(st.ib)out.push(st.ib+' quick note'+(st.ib>1?'s':'')+' to sort');return out}
async function bgCheck(){try{const c=await caches.open('sdo-alarm');const r=await c.match('./__alarm.json');if(!r)return;const st=await r.json();if(st.on===false)return;
 const now=new Date(),h=now.getHours();if(h<(st.remHour||8)||h>=21)return;const t=ymdS(now);const l=await c.match('./__last.txt');if(l&&(await l.text())===t)return;
 const lines=alarmLines(st,now);if(!lines.length)return;await self.registration.showNotification('SDO Desk',{body:lines.join('\n'),icon:'icon-192.png',badge:'icon-192.png',tag:'sdo-daily'});await c.put('./__last.txt',new Response(t))}catch(e){}}
