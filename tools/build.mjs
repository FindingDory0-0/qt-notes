// 정리본 HTML을 비밀번호로 암호화해서 site/index.html 로 만든다.
//   node tools/build.mjs            (비밀번호는 ~/.qt-pass 에서 읽음)
// 저장소에는 암호문만 올라가고, 비밀번호와 원본은 올라가지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(SITE, '..', '승진시험 정리본.html');
const ITER = 600000;

const pass = readFileSync(join(homedir(), '.qt-pass'), 'utf8').replace(/\r?\n$/, '');
if (pass.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다 (~/.qt-pass)');
const salt = Buffer.from(readFileSync(join(SITE, 'tools', 'salt.txt'), 'utf8').trim(), 'base64');

// 복호화된 페이지에 붙는 스크립트: 서비스워커 등록 + 새 버전 알림
const UPDATE_SNIPPET = `
<div id="qt-update" style="display:none;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99;background:#1a1a18;color:#fff;border-radius:999px;padding:10px 16px;font-size:13.5px;box-shadow:0 6px 20px rgba(0,0,0,.18);align-items:center;gap:12px;white-space:nowrap">
  새 버전이 있습니다 <button onclick="location.reload()" style="font:inherit;font-weight:700;border:0;background:#fff;color:#1a1a18;border-radius:999px;padding:4px 12px;cursor:pointer">새로고침</button>
</div>
<script>
(function(){
  if(!('serviceWorker' in navigator)) return;
  const show=()=>{document.getElementById('qt-update').style.display='flex'};
  navigator.serviceWorker.addEventListener('message',e=>{ if(e.data&&e.data.type==='page-updated') show(); });
  const v=document.querySelector('meta[name=qt-build]');
  const mine=v?v.content:'';
  // 열려 있는 동안에도 가끔 새 버전 확인
  setInterval(()=>{ fetch('./version.txt',{cache:'no-store'}).then(r=>r.text()).then(t=>{ if(mine&&t.trim()&&t.trim()!==mine) show(); }).catch(()=>{}); }, 10*60*1000);
})();
</script>
<div id="qt-install" style="display:none;position:fixed;left:12px;right:12px;bottom:14px;z-index:98;max-width:420px;margin:0 auto;background:#fff;border:1px solid #e6e6e1;border-radius:16px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.14);font-size:14px;color:#1a1a18">
  <div style="display:flex;align-items:center;gap:12px">
    <img src="icons/icon-192.png" alt="" style="width:40px;height:40px;border-radius:10px;flex:none">
    <div style="flex:1;line-height:1.45"><b>홈 화면에 설치할까요?</b><br><span id="qt-install-msg" style="font-size:12.5px;color:#8a8a84">앱처럼 바로 열리고, 인터넷이 없어도 볼 수 있어요.</span></div>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
    <button id="qt-install-later" style="font:inherit;font-size:13.5px;border:1px solid #cfcfc8;background:#fff;color:#4a4a45;border-radius:10px;padding:8px 14px;cursor:pointer">나중에</button>
    <button id="qt-install-go" style="font:inherit;font-size:13.5px;font-weight:700;border:0;background:#1f5f5b;color:#fff;border-radius:10px;padding:8px 16px;cursor:pointer">설치</button>
  </div>
</div>
<script>
(function(){
  // 이미 홈 화면 앱으로 열었으면 안내하지 않음
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
  const KEY='qt-install-later', box=document.getElementById('qt-install');
  try { const t=+localStorage.getItem(KEY); if (t && Date.now()-t < 3*864e5) return; } catch(e) {}
  const later=()=>{ box.style.display='none'; try{localStorage.setItem(KEY,String(Date.now()))}catch(e){} };
  document.getElementById('qt-install-later').onclick=later;
  const go=document.getElementById('qt-install-go');
  function ready(){
    go.textContent='설치'; go.style.display='';
    go.onclick=async()=>{ const p=window.__qtInstall; if(!p) return; p.prompt(); const r=await p.userChoice.catch(()=>null); window.__qtInstall=null; box.style.display='none'; if(!r||r.outcome!=='accepted') later(); };
    box.style.display='block';
  }
  if (window.__qtInstall) ready(); else addEventListener('qt-installable', ready, { once:true });
  addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); window.__qtInstall=e; ready(); });
  addEventListener('appinstalled', ()=>{ box.style.display='none'; });
  // 브라우저가 설치 신호를 주지 않는 경우(아이폰 Safari 등): 메뉴로 추가하는 방법 안내
  setTimeout(()=>{ if (window.__qtInstall || box.style.display==='block') return;
    const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
    document.getElementById('qt-install-msg').textContent = ios ? '공유 버튼 → "홈 화면에 추가"를 눌러 주세요.' : '브라우저 메뉴에서 "홈 화면에 추가" 또는 "앱 설치"를 눌러 주세요.';
    go.style.display='none'; document.getElementById('qt-install-later').textContent='닫기';
    box.style.display='block';
  }, 6000);
})();
</script>
`;

const build = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 13); // KST, 예: 20261026T1130
let html = readFileSync(SOURCE, 'utf8');
// 잠금 해제 후 문서가 교체돼도 앱 설치 정보(manifest·아이콘)가 남도록 같이 넣는다
const APP_HEAD = `<meta name="qt-build" content="${build}">
<meta name="robots" content="noindex, nofollow, noarchive">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="theme-color" content="#ffffff">`;
html = html.replace('<head>', '<head>\n' + APP_HEAD);
html = html.replace('</body>', UPDATE_SNIPPET + '</body>');

const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(html)));

const payload = JSON.stringify({ v: 1, iter: ITER, salt: salt.toString('base64'), iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') });
const tpl = readFileSync(join(SITE, 'tools', 'lock.html'), 'utf8');
writeFileSync(join(SITE, 'index.html'), tpl.replace('__PAYLOAD__', payload).replace('__BUILD__', build));
writeFileSync(join(SITE, 'version.txt'), build + '\n');
console.log(`index.html 생성 (build ${build}, ${(ct.length / 1024).toFixed(0)} KB 암호문)`);
