// Régénère sitemap.xml en incluant les fiches de bugs et articles ajoutés dynamiquement
// (approuvés via la modération, ou générés chaque semaine par l'IA), en plus des pages de base.
// Écrit le résultat dans ./public/sitemap.xml, déployé ensuite vers Firebase Hosting (voir workflow).

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || "https://buglog-d884a-default-rtdb.europe-west1.firebasedatabase.app";
const SITE_ORIGIN = "https://buglog-d884a.web.app";

if(!FIREBASE_API_KEY){
  console.error("Secret manquant : FIREBASE_API_KEY.");
  process.exit(1);
}

// IDs des fiches/articles écrits en dur sur le site (à tenir à jour si tu en ajoutes manuellement
// directement dans index.html / blog.html plutôt que via la modération ou l'IA).
const BASE_BUG_IDS = [
  "win-0x7b","win-dwm","mac-kp","mac-spin","lin-fsck","lin-oom","hw-ram","hw-disk","hw-therm","hw-fan",
  "win-update","mac-wifi","hw-gpu","lin-grub","win-disk100","net-noip","print-file","kb-nodetect",
  "batt-drain","scr-black","usb-notrecog","mac-slow","son-absent","malware-pub","bt-disconnect","boot-slow",
  "xp-winlogon","xp-stop8e","xp-activation","vista-prep","vista-ram","win7-wga","win7-updatestuck",
  "win8-autorepair","win81-store","win10-1900101","win10-startmenu","win11-tpm","win11-taskbar",
  "srv-adds","srv-rdp","srv-gpo","win-dism","win-hello","win-taskbar-vanish","win-copyerror",
  "lin-apt-gpg","lin-nvidia-black","lin-sound-kernel","lin-permission-denied","lin-segfault",
  "lin-dpkg-lock","lin-grub-timeout","mac-error-43","mac-kernel-panic-code","mac-error-36","mac-code-153",
  "win-0xc000021a","win-inaccessible-boot2","lin-kernel-panic-vfs","lin-toomanyfiles","hw-psu-noboot",
  "hw-ram-blue-random","hw-ssd-notdetected","hw-overclock-crash","hw-monitor-noflicker",
  "sw-app-crash-startup","sw-memory-leak","sw-browser-highcpu","hw-battery-notcharging",
  "hw-usb-power-drop","sw-office-recovery","net-wifi-drop","net-slow-speed","net-noip-static","net-vpn-noconnect",
  "win-dpc-watchdog","win-critical-process-died","win-appx-cant-run","win-activation-0xc004f074","win-defender-false-positive",
  "mac-disk-not-readable","mac-time-machine-fail","mac-trackpad-click","mac-bluetooth-audio-stutter",
  "lin-systemd-resolved-dns","lin-inode-full","lin-docker-not-starting","lin-ssh-permission-denied",
  "hw-cmos-battery-dead","hw-ram-xmp-not-detected","hw-monitor-hdmi-notdetected","hw-keyboard-spill",
  "net-router-reboot-loop","net-captive-portal-notopening"
];
const BASE_ARTICLE_IDS = [
  "pourquoi-ecran-bleu","surchauffe-pc","disque-dur-signes","code-43-gpu",
  "wifi-connecte-sans-internet","batterie-portable-usure"
];

async function firebaseSignInAnonymous(){
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok || !data.idToken) throw new Error("Échec auth Firebase : " + JSON.stringify(data));
  return data.idToken;
}

async function fetchJsonList(idToken, key){
  const res = await fetch(`${FIREBASE_DB_URL}/buglog/${key}.json?auth=${idToken}`);
  if(!res.ok) return [];
  const raw = await res.json();
  if(!raw) return [];
  try{ return JSON.parse(raw); }catch(e){ return []; }
}

function urlBlock(loc, changefreq, priority){
  return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

async function main(){
  const idToken = await firebaseSignInAnonymous();

  const customBugs = await fetchJsonList(idToken, 'custom-bugs');
  const customArticles = await fetchJsonList(idToken, 'custom-articles');

  const allBugIds = [...BASE_BUG_IDS, ...customBugs.map(b => b.id).filter(Boolean)];
  const allArticleIds = [...BASE_ARTICLE_IDS, ...customArticles.map(a => a.id).filter(Boolean)];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlBlock(`${SITE_ORIGIN}/index.html`, 'weekly', '1.0'),
    urlBlock(`${SITE_ORIGIN}/index.html?lang=en`, 'weekly', '0.7'),
    urlBlock(`${SITE_ORIGIN}/blog.html`, 'weekly', '0.8'),
    ...allBugIds.map(id => urlBlock(`${SITE_ORIGIN}/index.html?bug=${id}`, 'monthly', '0.6')),
    ...allArticleIds.map(id => urlBlock(`${SITE_ORIGIN}/blog.html?article=${id}`, 'monthly', '0.65')),
    '</urlset>'
  ];

  const fs = await import('node:fs/promises');
  await fs.mkdir('./public', { recursive: true });
  await fs.writeFile('./public/sitemap.xml', lines.join('\n') + '\n', 'utf-8');

  console.log(`✅ sitemap.xml généré : ${allBugIds.length} fiches + ${allArticleIds.length} articles + 3 pages de base.`);
}

main().catch(err => {
  console.error("❌ Échec de la génération du sitemap :", err);
  process.exit(1);
});
