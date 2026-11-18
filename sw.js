const C='sdo-desk-v66';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./fflate.js','./drive.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C&&k!=='sdo-alarm').map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||!e.request.url.startsWith(self.location.origin))return;
 e.respondWith(fetch(e.request.url,{cache:'no-cache',credentials:'same-origin'}).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'./';e.waitUntil(clients.matchAll({type:'window'}).then(ws=>{if(ws.length){const c=ws[0];return (c.navigate?c.navigate(u).catch(()=>c):Promise.resolve(c)).then(x=>(x||c).focus())}return clients.openWindow(u)}))});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){}e.waitUntil(pushNote(d))});
self.addEventListener('periodicsync',e=>{if(e.tag==='sdo-check')e.waitUntil(bgCheck())});
const ymdS=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
function addD(s,n){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return ymdS(d)}
function alarmLines(st,now){const t=ymdS(now),dow=(now.getDay()+6)%7,ws=addD(t,-dow),out=[];
 Object.values(st.subs||{}).forEach(x=>{const n=st.ws===ws?x.n:0,s=st.ws===ws?x.sub:0,nm=x.name;
  if(x.all){if(s>=3)return;const pm=n>s?' ('+(n-s)+' inspected, note not uploaded)':'';if(dow===2&&n===0)out.push('No inspection yet this week. 3 notes needed by Friday.');else if(dow===3&&s<2)out.push(s+' of 3 inspection notes submitted'+pm+'. Target Friday.');else if(dow===4)out.push(s+' of 3 inspection notes submitted'+pm+'. Today is the target day.');else if(dow===5)out.push('Final day: '+s+' of 3 inspection notes submitted'+pm+'.');return}
  if(dow===2&&n===0)out.push(nm+': no inspection yet this week. 3 needed by Friday.');
  else if(dow===3&&n<2)out.push(nm+': only '+n+' of 3 inspected. Notes due Friday.');
  else if(dow===4&&(n<3||s<3))out.push(n<3?nm+': only '+n+' of 3 inspected. Today is the target day.':nm+': '+s+' of 3 notes submitted. Submit today.');
  else if(dow===5&&(n<3||s<3))out.push('Final: '+nm+' '+n+'/3 inspected, '+s+'/3 notes to Division.')});
 const od=(st.dates||[]).filter(d=>d<t).length,dt=(st.dates||[]).filter(d=>d===t).length;if(od||dt)out.push(od+' overdue, '+dt+' due today');
 (st.ev||[]).filter(x=>x.d===t).forEach(x=>out.push('Today: '+(x.tm?x.tm+' ':'')+x.t));if(st.ib)out.push(st.ib+' quick note'+(st.ib>1?'s':'')+' to sort');return out}
function eveLines(st,now){const t=ymdS(now),out=[];if(st.opened!==t)out.push('You have not opened SDO Desk today.');
 const od=(st.dates||[]).filter(d=>d<=t).length;if(od)out.push(od+' item'+(od>1?'s':'')+' overdue or due today');
 if(st.pend)out.push(st.pend+' inspection note'+(st.pend>1?'s':'')+' not uploaded on eFOES');
 if((st.vis||[]).includes(t)&&!(st.veh||[]).includes(t))out.push('Fill today\'s vehicle log');
 if(st.owed)out.push('Petrol pump bill pending');return out}
async function bgCheck(){try{const c=await caches.open('sdo-alarm');const r=await c.match('./__alarm.json');if(!r)return;const st=await r.json();if(st.on===false)return;
 const now=new Date(),h=now.getHours(),t=ymdS(now);
 if(st.eve&&h>=st.eve&&h<23){const l=await c.match('./__last_e.txt');if(!(l&&(await l.text())===t)){const lines=eveLines(st,now);if(lines.length){await self.registration.showNotification('SDO Desk · evening',{body:lines.join('\n'),icon:'icon-192.png',badge:'icon-192.png',tag:'sdo-eve'});await c.put('./__last_e.txt',new Response(t))}}return}
 if(h<(st.remHour||8)||h>=21)return;const l=await c.match('./__last.txt');if(l&&(await l.text())===t)return;
 const lines=alarmLines(st,now);if(!lines.length)return;await self.registration.showNotification('SDO Desk',{body:lines.join('\n'),icon:'icon-192.png',badge:'icon-192.png',tag:'sdo-daily'});await c.put('./__last.txt',new Response(t))}catch(e){}}
async function pushNote(d){let st=null;try{const c=await caches.open('sdo-alarm');const r=await c.match('./__alarm.json');if(r)st=await r.json()}catch(x){}
 const now=new Date(),t=ymdS(now);const eve=d.slot==='eve'||(d.slot!=='am'&&now.getHours()>=14);let lines=[];
 if(st&&st.on!==false){lines=eve?eveLines(st,now):alarmLines(st,now);if(eve){const n=st.addedOn===t?(st.added||0):0;lines.unshift(n?'Logged today: '+n+' new or updated item'+(n>1?'s':'')+'.':'Nothing logged today. Add today\'s directions and follow-ups now.')}}
 if(!lines.length)lines=[eve?'Anything new today? Log it before you forget.':'Open SDO Desk to plan today.'];
 return self.registration.showNotification(eve?'SDO Desk · evening check':'SDO Desk · today',{body:lines.join('\n'),icon:'icon-192.png',badge:'icon-192.png',tag:eve?'sdo-eve':'sdo-daily',renotify:true,data:{url:eve?'./#qlog':'./#home'}})}
