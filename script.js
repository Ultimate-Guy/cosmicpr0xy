const $=id=>document.getElementById(id);
const frame=$('pageFrame'),addr=$('addressBar'),status=$('status');
let history=JSON.parse(localStorage.getItem('cosmicHistory')||'[]');
let favorites=JSON.parse(localStorage.getItem('cosmicFavorites')||'[]');
let shortcuts=JSON.parse(localStorage.getItem('cosmicShortcuts')||'null')||[
{name:'YouTube',url:'https://www.youtube.com',icon:'▶'},
{name:'GitHub',url:'https://github.com',icon:'◈'},
{name:'Wikipedia',url:'https://www.wikipedia.org',icon:'W'},
{name:'Google',url:'https://www.google.com',icon:'G'}];
function normalize(v){v=(v||'').trim();if(!v)return '';if(/^https?:\/\//i.test(v))return v;if(v.includes('.')&&!v.includes(' '))return 'https://'+v;return 'https://www.google.com/search?q='+encodeURIComponent(v)}
function save(){localStorage.setItem('cosmicHistory',JSON.stringify(history.slice(0,60)));localStorage.setItem('cosmicFavorites',JSON.stringify(favorites));localStorage.setItem('cosmicShortcuts',JSON.stringify(shortcuts))}
function card(s,i,kind='shortcut'){return `<button class="shortcut" data-kind="${kind}" data-i="${i}"><div class="shortcut-icon">${s.icon||'✦'}</div><strong>${s.name||s.title||'Saved page'}</strong><small>${(s.url||'').replace(/^https?:\/\//,'').replace(/\/$/,'')}</small></button>`}
function renderShortcuts(){const html=shortcuts.map((s,i)=>card(s,i)).join('');$('shortcuts').innerHTML=html;$('appsGrid').innerHTML=html;bindCards()}
function renderFavorites(){const html=favorites.map((s,i)=>card(s,i,'favorite')).join('');$('favoritesGrid').innerHTML=html||'<p class="muted">Nothing saved yet.</p>';bindCards()}
function bindCards(){document.querySelectorAll('.shortcut').forEach(b=>b.onclick=()=>{const arr=b.dataset.kind==='favorite'?favorites:shortcuts;navigate(arr[+b.dataset.i].url)})}
function renderHistory(){const box=$('historyList');box.innerHTML=history.length?history.map((h,i)=>`<div class="history-item" data-i="${i}"><strong>${h.title||h.url}</strong><small>${h.url}</small></div>`).join(''):'<p class="muted" style="padding:18px">No pages visited yet.</p>';box.querySelectorAll('.history-item').forEach(x=>x.onclick=()=>navigate(history[+x.dataset.i].url))}
function show(name){document.querySelectorAll('.view').forEach(v=>v.hidden=true);document.querySelectorAll('.nav[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===name));const el=$(name+'View');if(el)el.hidden=false}
function navigate(raw){const url=normalize(raw);if(!url)return;addr.value=url;show('page');$('loading').hidden=false;$('embedFallback').hidden=true;status.textContent='Loading';$('loadingText').textContent=url;frame.src=url;history.unshift({url,title:url});save();renderHistory()}
function saveCurrent(){const url=normalize(addr.value||frame.src);if(!url)return;const exists=favorites.some(x=>x.url===url);favorites=exists?favorites.filter(x=>x.url!==url):[...favorites,{name:url.replace(/^https?:\/\//,'').split('/')[0],url,icon:'★'}];save();renderFavorites();$('favoriteBtn').textContent=exists?'☆':'★'}
frame.addEventListener('load',()=>{$('loading').hidden=true;status.textContent='Ready';$('favoriteBtn').textContent=favorites.some(x=>x.url===frame.src)?'★':'☆'});
$('addressForm').onsubmit=e=>{e.preventDefault();navigate(addr.value)};
$('homeSearch').onsubmit=e=>{e.preventDefault();navigate($('homeInput').value)};
$('backBtn').onclick=()=>{try{frame.contentWindow.history.back()}catch{status.textContent='Back unavailable'}};
$('forwardBtn').onclick=()=>{try{frame.contentWindow.history.forward()}catch{status.textContent='Forward unavailable'}};
$('reloadBtn').onclick=()=>{if(!document.getElementById('pageView').hidden)frame.src=frame.src};
$('homeBtn').onclick=()=>show('home');$('brandHome').onclick=()=>show('home');$('clearBtn').onclick=()=>addr.value='';$('favoriteBtn').onclick=saveCurrent;
$('openBtn').onclick=()=>{if(addr.value)window.open(normalize(addr.value),'_blank','noopener,noreferrer')};
$('fallbackOpen').onclick=()=>window.open(frame.src,'_blank','noopener,noreferrer');
$('fullscreenBtn').onclick=()=>document.documentElement.requestFullscreen?.();
$('themeBtn').onclick=()=>{document.body.classList.toggle('light');$('themeMode').value=document.body.classList.contains('light')?'light':'dark'};
document.querySelectorAll('.nav[data-view]').forEach(n=>n.onclick=()=>show(n.dataset.view));
$('addShortcut').onclick=()=>{const name=prompt('Shortcut name');if(!name)return;const url=normalize(prompt('Website address')||'');if(!url)return;shortcuts.push({name,url,icon:'✦'});save();renderShortcuts()};
$('collapseBtn').onclick=()=>document.querySelector('.sidebar').classList.toggle('collapsed');
$('newTab').onclick=()=>show('home');
$('themeMode').onchange=e=>{document.body.classList.toggle('light',e.target.value==='light')};
$('sidebarMode').onchange=e=>document.querySelector('.sidebar').classList.toggle('collapsed',e.target.value==='compact');
$('homepageMode').onchange=e=>localStorage.setItem('cosmicHome',e.target.value);
renderShortcuts();renderFavorites();renderHistory();show('home');
window.CosmicBrowser={navigate,show,addShortcut:(name,url)=>{shortcuts.push({name,url:normalize(url),icon:'✦'});save();renderShortcuts()},getHistory:()=>[...history],getFavorites:()=>[...favorites],saveCurrent};