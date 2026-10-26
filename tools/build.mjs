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
