import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, getDocs, addDoc, onSnapshot,
  collection, query, orderBy, where, setDoc, updateDoc,
  deleteDoc, increment, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ═══════════════════════════════════════════════════════════
// FIREBASE CONFIG
// ═══════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyCHA1ZPOCOK_zKkfJfYHF2aBFdykIvvOxc",
  authDomain: "profiles-4-instagram.firebaseapp.com",
  projectId: "profiles-4-instagram",
  storageBucket: "profiles-4-instagram.firebasestorage.app",
  messagingSenderId: "35795561568",
  appId: "1:35795561568:web:3c539d38409097098ae705",
  measurementId: "G-Q7TE6TKZKD"
};

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
export { db, auth };

// ═══════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════
let currentUser        = null;
let currentUserId      = null;
let isOwnProfile       = false;
let profileUserId      = null;
let profileUsername    = '';
let currentProfileData = null;
let postsDoUsuario     = [];
const _unsubs          = [];

// ═══════════════════════════════════════════════════════════
// HELPERS DOM
// ═══════════════════════════════════════════════════════════
const $    = id  => document.getElementById(id);
const $q   = sel => document.querySelector(sel);
const $qa  = sel => document.querySelectorAll(sel);

function urlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
function getDisplayName(d) {
  return d?.displayName || d?.displayname || d?.name || d?.username || 'Usuário';
}
function getUsername(d) { return d?.username || ''; }

function formatTs(ts) {
  if (!ts) return '';
  try {
    const d = typeof ts.toDate === 'function' ? ts.toDate()
            : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    const diff = Date.now() - d.getTime();
    const m   = Math.floor(diff / 60000);
    const h   = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    const sem = Math.floor(day / 7);
    const mes = Math.floor(day / 30);
    const ano = Math.floor(day / 365);
    if (m < 1)     return 'Agora';
    if (m < 60)    return `Há ${m} ${m === 1 ? 'minuto' : 'minutos'}`;
    if (h < 24)    return `Há ${h} ${h === 1 ? 'hora' : 'horas'}`;
    if (day < 7)   return `Há ${day} ${day === 1 ? 'dia' : 'dias'}`;
    if (day < 30)  return `Há ${sem} ${sem === 1 ? 'semana' : 'semanas'}`;
    if (day < 365) return `Há ${mes} ${mes === 1 ? 'mes' : 'meses'}`;
    return `Há ${ano} ${ano === 1 ? 'ano' : 'anos'}`;
  } catch { return ''; }
}

function formatPost(txt) {
  if (!txt) return '';
  return String(txt)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/#(\w+)/g,'<span class="hashtag">#$1</span>')
    .replace(/@(\w+)/g,'<span class="mention">@$1</span>')
    .replace(/\n/g,'<br>');
}

function traduzirGenero(g) {
  const m = {
    masculino:'Masculino', feminino:'Feminino', outro:'Outro',
    prefiro_nao_dizer:'Prefiro não dizer', male:'Masculino',
    female:'Feminino', other:'Outro', prefer_not_to_say:'Prefiro não dizer'
  };
  return m[String(g || '').toLowerCase()] || 'Não informado';
}

function mostrarErro(msg) {
  const c = $q('.full-profile-container');
  if (!c) return;
  c.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                height:80vh;padding:20px;text-align:center;">
      <i class="fas fa-exclamation-circle" style="font-size:56px;color:#f85149;margin-bottom:16px;"></i>
      <h2 style="color:#f8f9f9;margin-bottom:8px;">Ops!</h2>
      <p style="color:#aaa;">${msg}</p>
      <a href="index.html" style="margin-top:20px;color:#4A90E2;text-decoration:none;">← Voltar ao início</a>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// CACHE LOCAL
// ═══════════════════════════════════════════════════════════
const memCache = { users: new Map(), photos: new Map() };
const LS_PFX   = 'profile_cache_';
const LS_TTL   = 7 * 24 * 60 * 60 * 1000;   // 7 dias
const LS_STALE = 5 * 60 * 1000;              // 5 min

function lsSave(key, data) {
  try { localStorage.setItem(LS_PFX + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}
function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PFX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > LS_TTL) { localStorage.removeItem(LS_PFX + key); return null; }
    data.__stale = (Date.now() - ts) > LS_STALE;
    return data;
  } catch { return null; }
}
function lsClean() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(LS_PFX))
      .forEach(k => {
        try {
          const { ts } = JSON.parse(localStorage.getItem(k));
          if (Date.now() - ts > LS_TTL) localStorage.removeItem(k);
        } catch { localStorage.removeItem(k); }
      });
  } catch {}
}

async function getUserData(uid) {
  if (!uid) return {};
  if (memCache.users.has(uid)) return memCache.users.get(uid);
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const d = snap.exists() ? snap.data() : {};
    memCache.users.set(uid, d);
    return d;
  } catch { return {}; }
}

async function getUserPhoto(uid) {
  if (!uid) return './src/img/default.jpg';
  if (memCache.photos.has(uid)) return memCache.photos.get(uid);
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'user-infos', 'user-media'));
    const d = snap.exists() ? snap.data() : {};
    const p = d.pfp || d.userphoto || './src/img/default.jpg';
    memCache.photos.set(uid, p);
    return p;
  } catch { return './src/img/default.jpg'; }
}

// ═══════════════════════════════════════════════════════════
// MUSIC PLAYER (YouTube IFrame API)
// ═══════════════════════════════════════════════════════════
let musicPlayer     = null;
let musicPlaying    = false;
let musicCurrentUrl = null;
let _ytApiReady     = false;
let _ytPendingId    = null;

window.onYouTubeIframeAPIReady = () => {
  _ytApiReady = true;
  if (_ytPendingId) { createMusicPlayer(_ytPendingId); _ytPendingId = null; }
};

function extractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (String(url).match(/^[A-Za-z0-9_-]{11}$/) ? url : null);
}

function createMusicPlayer(videoId) {
  if (musicPlayer && typeof musicPlayer.destroy === 'function') {
    try { musicPlayer.destroy(); } catch {}
    musicPlayer = null;
    musicPlaying = false;
  }
  document.getElementById('music-player')?.remove();
  const div = document.createElement('div');
  div.id = 'music-player';
  div.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;';
  document.body.appendChild(div);

  musicPlayer = new YT.Player('music-player', {
    height: '1', width: '1', videoId,
    playerVars: {
      autoplay:0, controls:0, disablekb:1, fs:0,
      modestbranding:1, rel:0, iv_load_policy:3,
      playsinline:1, enablejsapi:1, loop:1, playlist:videoId
    },
    events: {
      onReady(e) {
        e.target.setVolume(60);
        fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
          .then(r => r.json()).then(d => setMusicTitle(d.title)).catch(() => {});
      },
      onStateChange(e) {
        if (e.data === YT.PlayerState.ENDED) { e.target.seekTo(0); e.target.playVideo(); }
      }
    }
  });
}

function toggleMusic() {
  if (!musicPlayer || typeof musicPlayer.playVideo !== 'function') return;
  musicPlaying ? musicPlayer.pauseVideo() : musicPlayer.playVideo();
  musicPlaying = !musicPlaying;
  updateMusicUI(musicPlaying);
}

function updateMusicUI(playing) {
  $('btnPauseMusic')?.classList.toggle('playing', playing);
  $('play')?.classList.toggle('active', !playing);
  $('pause')?.classList.toggle('active', playing);
  $q('.music-bars')?.classList.toggle('visible', playing);
  $('musicTitle')?.classList.toggle('shifted', playing);
}

function setMusicTitle(title) {
  if ($('musicTitle'))    $('musicTitle').textContent   = title;
  if ($('music-title'))   $('music-title').textContent  = title;
}

function initMusicPlayer(url) {
  const videoId      = extractYouTubeId(url);
  const musicSection = $q('.music');
  if (!videoId) {
    if (musicSection) musicSection.style.display = 'none';
    return;
  }
  if (musicSection) musicSection.style.display = '';
  if (url === musicCurrentUrl) return;
  updateMusicUI(false);
  musicCurrentUrl = url;

  if (!$('_yt_api_script')) {
    const s = document.createElement('script');
    s.id  = '_yt_api_script';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }
  if (_ytApiReady) createMusicPlayer(videoId);
  else _ytPendingId = videoId;

  // Reanexa listeners no botão
  ['btnPauseMusic', 'music-toggle-btn'].forEach(id => {
    const old = $(id); if (!old) return;
    const btn = old.cloneNode(true);
    old.parentNode.replaceChild(btn, old);
    btn.addEventListener('click', toggleMusic);
  });
}

// ═══════════════════════════════════════════════════════════
// CARREGAR DADOS DO PERFIL
// ═══════════════════════════════════════════════════════════
async function resolveUsername(raw) {
  const key = raw.trim().toLowerCase();
  try {
    const snap = await getDoc(doc(db, 'usernames', key));
    if (snap.exists() && snap.data().uid) return snap.data().uid;
  } catch {}
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('username', '==', key)));
    if (!snap.empty) return snap.docs[0].id;
  } catch {}
  return null;
}

async function carregarDados(uid) {
  try {
    const [userDoc, mediaDoc, likesDoc, aboutDoc, moreDoc, linksDoc] = await Promise.all([
      getDoc(doc(db, 'users', uid)),
      getDoc(doc(db, `users/${uid}/user-infos/user-media`)),
      getDoc(doc(db, `users/${uid}/user-infos/likes`)),
      getDoc(doc(db, `users/${uid}/user-infos/about`)),
      getDoc(doc(db, `users/${uid}/user-infos/more-infos`)),
      getDoc(doc(db, `users/${uid}/user-infos/links`)),
    ]);
    if (!userDoc.exists()) { mostrarErro('Perfil não encontrado.'); return null; }
    return {
      ...userDoc.data(), uid,
      media:     mediaDoc.exists() ? mediaDoc.data() : {},
      likes:     likesDoc.exists() ? likesDoc.data() : {},
      about:     aboutDoc.exists() ? aboutDoc.data() : {},
      moreInfos: moreDoc.exists()  ? moreDoc.data()  : {},
      linksData: linksDoc.exists() ? linksDoc.data() : {},
    };
  } catch (e) {
    console.error('carregarDados:', e);
    mostrarErro('Erro ao carregar perfil.');
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// LISTENERS TEMPO REAL
// ═══════════════════════════════════════════════════════════
function setupListeners(uid) {
  _unsubs.forEach(u => u());
  _unsubs.length = 0;

  const on = (ref, fn) => _unsubs.push(
    onSnapshot(ref, snap => { if (snap.exists()) fn(snap.data()); })
  );

  on(doc(db, 'users', uid), d => {
    memCache.users.set(uid, d);
    currentProfileData = { ...(currentProfileData || {}), ...d };
    renderPrincipal(d);
    renderStatsContadores(d);
  });
  on(doc(db, `users/${uid}/user-infos/user-media`), d => {
    currentProfileData = { ...(currentProfileData || {}), media: { ...(currentProfileData?.media || {}), ...d } };
    renderMidia(d);
  });
  on(doc(db, `users/${uid}/user-infos/likes`), d => {
    currentProfileData = { ...(currentProfileData || {}), likes: { ...(currentProfileData?.likes || {}), ...d } };
    renderGostos(d);
    renderModal(currentProfileData);
  });
  on(doc(db, `users/${uid}/user-infos/about`), d => {
    currentProfileData = { ...(currentProfileData || {}), about: { ...(currentProfileData?.about || {}), ...d } };
    renderVisaoGeral(d);
    renderPronomes(d);
    renderModal(currentProfileData);
  });
  on(doc(db, `users/${uid}/user-infos/more-infos`), d => {
    currentProfileData = { ...(currentProfileData || {}), moreInfos: { ...(currentProfileData?.moreInfos || {}), ...d } };
    const bioEl = $('bio');
    if (bioEl && d.bio !== undefined) bioEl.textContent = d.bio;
  });
  _unsubs.push(onSnapshot(doc(db, `users/${uid}/user-infos/links`), snap => {
    renderLinks(snap.exists() ? snap.data() : {});
  }));
}

// ═══════════════════════════════════════════════════════════
// RENDER — PERFIL PRINCIPAL
// ═══════════════════════════════════════════════════════════
function preencherPerfil(dados) {
  currentProfileData = dados;
  profileUsername    = getUsername(dados);

  renderPrincipal(dados);
  renderPronomes(dados.about || {});

  const bioEl = $('bio');
  if (bioEl) bioEl.textContent = dados.moreInfos?.bio || '';

  renderMidia(dados.media    || {});
  renderLinks(dados.linksData || {});
  renderModal(dados);
  renderVisaoGeral(dados.about || {});
  renderGostos(dados.likes   || {});
  renderStatsContadores(dados);
}

function renderPrincipal(d) {
  const un = getUsername(d);
  const dn = getDisplayName(d);
  const verificado = !!d.verified;
  const badge = verificado ? `<i class="fa-solid fa-circle-check"></i>` : '';

  // Navbar — texto puro
  if ($('headername')) $('headername').innerHTML = un + badge;
  if ($('view-more-username')) $('view-more-username').textContent = un;

  // Corpo do perfil
  if ($('displayname')) $('displayname').textContent = dn;
  if ($('nomeUsuario')) $('nomeUsuario').textContent  = dn;

  // Badge entre nome e pronomes (injeta no elemento .verificado)
  const verEl = $q('.verificado');
  if (verEl) { verEl.innerHTML = verificado ? badge : ''; verEl.classList.toggle('active', verificado); }

  renderModal(currentProfileData);
}

function renderPronomes(about) {
  const el = $('username'); if (!el) return;
  const pronomes = [about?.pronom1, about?.pronom2].filter(Boolean);
  el.innerHTML = pronomes.length
    ? `<span style="color:#888;font-size:0.9em;">${pronomes.join('/')}</span>`
    : '';
}

function renderMidia(media) {
  const foto = media.pfp || media.userphoto;
  if (foto) {
    $qa('.profile-pic, .user-pic').forEach(el => {
      el.src = foto;
      el.onerror = () => { el.src = './src/img/default.jpg'; };
    });
    if (profileUserId) memCache.photos.set(profileUserId, foto);
  }

  const bannerSrc  = media.banner || media.headerphoto;
  const bannerArea = $q('.pf-banner-area');
  const bannerEl   = $q('.profile-banner');
  if (bannerArea && bannerEl) {
    if (bannerSrc) {
      bannerEl.style.backgroundImage = `url(${bannerSrc})`;
      bannerArea.classList.remove('hidden');
    } else {
      bannerArea.classList.add('hidden');
    }
  }

  if (media.profileColor) {
    document.documentElement.style.setProperty('--profile-color', media.profileColor);
  }

  const musicSec = $q('.music');
  if (media.musicTheme) {
    initMusicPlayer(media.musicTheme);
    if (musicSec) {
      musicSec.style.transition = 'opacity 0.5s ease';
      musicSec.style.opacity = '0';
      musicSec.style.display = 'flex';
      requestAnimationFrame(() => requestAnimationFrame(() => { musicSec.style.opacity = '1'; }));
    }
  }
}
function renderModal(d) {
  if (!d) return;
  const set = (cls, val, fb = 'Não informado') => {
    const n = $q(`.${cls} span`);
    if (n) n.textContent = val || fb;
  };
  const unEl = $('username-modal');
  if (unEl) unEl.textContent = d.username || '';

  set('modal-info-nome',         d.name || d.displayName || d.displayname);
  set('modal-info-genero',       traduzirGenero(d.gender || d.about?.gender));
  set('modal-info-estado-civil', d.about?.maritalStatus);
  set('modal-info-localizacao',  d.about?.location || d.location);
  set('modal-info-buscando',     d.about?.searching);
  set('modal-info-overview',     d.about?.overview,    'Ainda não há nada por aqui...');
  set('modal-info-style',        d.about?.style,       'Ainda não há nada por aqui...');
  set('modal-info-personality',  d.about?.personality, 'Ainda não há nada por aqui...');
  set('modal-info-music',        d.likes?.music,       'Ainda não há nada por aqui...');
  set('modal-info-movies',       d.likes?.movies,      'Ainda não há nada por aqui...');
  set('modal-info-books',        d.likes?.books,       'Ainda não há nada por aqui...');
  set('modal-info-characters',   d.likes?.characters,  'Ainda não há nada por aqui...');
  set('modal-info-foods',        d.likes?.foods,       'Ainda não há nada por aqui...');
  set('modal-info-hobbies',      d.likes?.hobbies,     'Ainda não há nada por aqui...');
  set('modal-info-games',        d.likes?.games,       'Ainda não há nada por aqui...');
  set('modal-info-others',       d.likes?.others,      'Ainda não há nada por aqui...');
}

function renderVisaoGeral(a) {
  const tab = $q('.visao-tab .about-container'); if (!tab) return;
  const b   = tab.querySelectorAll('.about-box');
  const safe = v => v || 'Não informado';
  if (b[0]) b[0].innerHTML = `<p class="about-title">Visão geral:</p><p>${safe(a.overview)}</p>`;
  if (b[1]) b[1].innerHTML = `<p class="about-title">Tags:</p><p>${safe(a.tags)}</p>`;
  if (b[2]) b[2].innerHTML = `<p class="about-title">Meu Estilo:</p><p>${safe(a.style || a.styles)}</p>`;
  if (b[3]) b[3].innerHTML = `<p class="about-title">Personalidade:</p><p>${safe(a.personality)}</p>`;
  if (b[4]) b[4].innerHTML = `<p class="about-title">Sonhos:</p><p>${safe(a.dreams)}</p>`;
  if (b[5]) b[5].innerHTML = `<p class="about-title">Medos:</p><p>${safe(a.fears)}</p>`;
}

function renderGostos(l) {
  const tab = $q('.gostos-tab .about-container'); if (!tab) return;
  const b   = tab.querySelectorAll('.about-box');
  const safe = v => v || 'Não informado';
  if (b[0]) b[0].innerHTML = `<p class="about-title">Músicas:</p><p>${safe(l.music)}</p>`;
  if (b[1]) b[1].innerHTML = `<p class="about-title">Filmes e Séries:</p><p>${safe(l.movies)}</p>`;
  if (b[2]) b[2].innerHTML = `<p class="about-title">Livros:</p><p>${safe(l.books)}</p>`;
  if (b[3]) b[3].innerHTML = `<p class="about-title">Personagens:</p><p>${safe(l.characters)}</p>`;
  if (b[4]) b[4].innerHTML = `<p class="about-title">Comidas:</p><p>${safe(l.foods)}</p>`;
  if (b[5]) b[5].innerHTML = `<p class="about-title">Hobbies:</p><p>${safe(l.hobbies)}</p>`;
  if (b[6]) b[6].innerHTML = `<p class="about-title">Jogos:</p><p>${safe(l.games)}</p>`;
  if (b[7]) b[7].innerHTML = `<p class="about-title">Outros:</p><p>${safe(l.others)}</p>`;
}

function renderLinks(dados) {
  const c = $q('.links-tab .about-container'); if (!c) return;
  const redes = {
    instagram: { base:'https://instagram.com/',          icon:'fab fa-instagram', label:'Instagram' },
    x:         { base:'https://x.com/',                  icon:'fab fa-twitter',   label:'X'         },
    tiktok:    { base:'https://tiktok.com/@',            icon:'fab fa-tiktok',    label:'TikTok'    },
    youtube:   { base:'https://youtube.com/',            icon:'fab fa-youtube',   label:'YouTube'   },
    github:    { base:'https://github.com/',             icon:'fab fa-github',    label:'GitHub'    },
    discord:   { base:'https://discord.com/users/',      icon:'fab fa-discord',   label:'Discord'   },
    pinterest: { base:'https://pinterest.com/',          icon:'fab fa-pinterest', label:'Pinterest' },
    spotify:   { base:'https://open.spotify.com/user/', icon:'fab fa-spotify',   label:'Spotify'   },
    linkedin:  { base:'https://linkedin.com/in/',        icon:'fab fa-linkedin',  label:'LinkedIn'  },
    twitch:    { base:'https://twitch.tv/',              icon:'fab fa-twitch',    label:'Twitch'    },
    reddit:    { base:'https://reddit.com/u/',           icon:'fab fa-reddit',    label:'Reddit'    },
  };
  const src   = (dados.links && typeof dados.links === 'object') ? dados.links : dados;
  const itens = [];
  Object.entries(src).forEach(([k, v]) => {
    if (!v || typeof v !== 'string' || !v.trim()) return;
    const val   = v.trim();
    const r     = redes[k];
    const href  = r ? (val.startsWith('http') ? val : r.base + val) : (val.startsWith('http') ? val : 'https://' + val);
    const icon  = r ? `<i class="${r.icon}"></i>` : `<i class="fas fa-external-link-alt"></i>`;
    const label = r ? r.label : k.charAt(0).toUpperCase() + k.slice(1);
    itens.push(`
      <div class="about-box">
        <a href="${href}" target="_blank" rel="noopener noreferrer"
           style="display:flex;align-items:center;gap:12px;color:#f8f9f9;text-decoration:none;padding:8px;">
          <span style="font-size:24px;">${icon}</span>
          <div>
            <div style="font-weight:600;">${label}</div>
            <div style="font-size:13px;color:#888;">${val}</div>
          </div>
        </a>
      </div>`);
  });
  c.innerHTML = itens.length ? itens.join('') : `
    <div class="about-box" style="text-align:center;padding:30px;">
      <div class="icon-area"><div class="icon-place">
        <i class="fas fa-link" style="font-size:38px;color:#fff;"></i>
      </div></div>
      <h3 style="color:#fff;margin-bottom:12px;">Nenhum link ainda</h3>
      <p style="color:#555;">Este usuário ainda não adicionou nenhum link.</p>
    </div>`;
}



// ═══════════════════════════════════════════════════════════
// ESTATÍSTICAS: posts | curtidas | visitas
// ═══════════════════════════════════════════════════════════
function renderStatsContadores(userData) {
  const visitas  = userData?.visitCount || 0;
  const curtidas = userData?.likeCount  || 0;
  // Usa animação se os contadores já tiverem valor (não na primeira renderização)
  const elV = $('seguindoCount');
  const elC = $('seguidoresCount');
  if (elV) {
    const prev = parseInt(elV.textContent) || -1;
    if (prev >= 0 && prev !== visitas) animarContador(elV, visitas);
    else if (prev < 0) elV.textContent = visitas;
  }
  if (elC) {
    const prev = parseInt(elC.textContent) || -1;
    if (prev >= 0 && prev !== curtidas) animarContador(elC, curtidas);
    else if (prev < 0) elC.textContent = curtidas;
  }
}

async function atualizarStats(uid) {
  try {
    // Conta posts
    let postCount = 0;
    try {
      const snap = await getDocs(query(collection(db, 'posts'), where('creatorid', '==', uid)));
      postCount = snap.size;
    } catch {
      const snap = await getDocs(collection(db, 'posts'));
      snap.forEach(d => { if (d.data().creatorid === uid) postCount++; });
    }
    if ($('amigosCount')) $('amigosCount').textContent = postCount;

    // Curtidas e visitas do doc do usuário
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) renderStatsContadores(userSnap.data());
  } catch (e) { console.error('atualizarStats:', e); }
}

// Registra visita: incrementa visitCount apenas se não é o próprio perfil
async function registrarVisita(targetUid) {
  if (!targetUid) return;
  if (currentUserId && currentUserId === targetUid) return; // não conta visita própria
  try {
    await updateDoc(doc(db, 'users', targetUid), { visitCount: increment(1) });
  } catch (e) { console.error('registrarVisita:', e); }
}



// ═══════════════════════════════════════════════════════════
// CURTIR / DESCURTIR PERFIL
// ═══════════════════════════════════════════════════════════
async function verificarCurtida(viewerUid, targetUid) {
  try {
    const snap = await getDoc(doc(db, 'users', targetUid, 'profile-likes', viewerUid));
    return snap.exists();
  } catch (e) {
    // Sem permissão ou erro: trata como não curtido
    return false;
  }
}

async function curtirPerfil(viewerUid, targetUid) {
  // Tenta registrar o like na subcoleção (pode falhar se regras não permitirem)
  // e incrementa o contador no doc principal
  const ops = [
    updateDoc(doc(db, 'users', targetUid), { likeCount: increment(1) })
  ];
  try {
    // profile-likes precisa de regra: match /profile-likes/{uid} { allow read,write: if isAuthenticated(); }
    await setDoc(doc(db, 'users', targetUid, 'profile-likes', viewerUid), { ts: serverTimestamp() });
  } catch {}
  await Promise.all(ops);
}

async function descurtirPerfil(viewerUid, targetUid) {
  await Promise.all([
    deleteDoc(doc(db, 'users', targetUid, 'profile-likes', viewerUid)),
    updateDoc(doc(db, 'users', targetUid), { likeCount: increment(-1) })
  ]);
}

// ═══════════════════════════════════════════════════════════
// BOTÕES DINÂMICOS
// ═══════════════════════════════════════════════════════════
async function configurarBotoes(targetUid) {
  const btnArea = $q('.actions-btn');
  if (!btnArea) return;
  btnArea.innerHTML = '';

  // Botão compartilhar (sempre presente)
  const shareBtn = document.createElement('button');
  shareBtn.className = 'action-btn share';
  shareBtn.textContent = 'Compartilhar';
  shareBtn.addEventListener('click', compartilharPerfil);

  if (isOwnProfile) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn mypf';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => { window.location.href = 'edit.html'; });
    btnArea.appendChild(editBtn);
    btnArea.appendChild(shareBtn);

    // SVG de criação visível apenas para o dono
    const createLink = $('create-post-btn') || $q('.navbar-top .top-right a');
    if (createLink) {
      createLink.style.display  = '';
      createLink.style.cursor   = 'pointer';
      createLink.style.pointerEvents = 'auto';
      // Remove listener duplicado
      const newLink = createLink.cloneNode(true);
      createLink.parentNode.replaceChild(newLink, createLink);
      newLink.addEventListener('click', e => { e.preventDefault(); abrirModalPost(); });
    }
  } else {
    // Verifica curtida prévia
    let jaCurtiu = currentUserId ? await verificarCurtida(currentUserId, targetUid) : false;

    const likeBtn = document.createElement('button');
    likeBtn.className = 'action-btn friend mypf';

    const atualizarLike = (curtido) => {
      likeBtn.textContent = curtido ? 'Curtido' : 'Curtir';
      likeBtn.style.background = curtido ? '#2b2f33' : '';
    };
    atualizarLike(jaCurtiu);

    likeBtn.addEventListener('click', async () => {
      if (!currentUserId) { window.location.href = 'login.html'; return; }
      if (jaCurtiu) return; // já curtiu — não permite descurtir
      likeBtn.disabled = true;
      try {
        await curtirPerfil(currentUserId, targetUid);
        jaCurtiu = true;
        atualizarLike(true);
        await atualizarStats(targetUid);
      } catch (e) { console.error('curtir:', e); }
      likeBtn.disabled = false;
    });

    btnArea.appendChild(likeBtn);
    btnArea.appendChild(shareBtn);

    // Esconde botão de criação para visitantes
    const createLink = $('create-post-btn') || $q('.navbar-top .top-right a');
    if (createLink) createLink.style.display = 'none';
  }
}

function compartilharPerfil() {
  const url = `${location.origin}${location.pathname}?username=${encodeURIComponent(profileUsername)}`;
  if (navigator.share) {
    navigator.share({ title: `Profiles de ${profileUsername}`, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url)
      .then(() => alert('Link copiado!'))
      .catch(() => alert(url));
  }
}

// ═══════════════════════════════════════════════════════════
// MODAL DE CRIAÇÃO (Post / Nota) — slide da esquerda
// ═══════════════════════════════════════════════════════════
function abrirModalPost() {
  const layer = $('postLayer'); if (!layer) return;
  layer.style.cssText += ';display:block;transform:translateX(-100%);transition:transform 0.35s cubic-bezier(0.4,0,0.2,1);';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    layer.style.transform = 'translateX(0)';
  }));
}

function fecharModalPost() {
  const layer = $('postLayer'); if (!layer) return;
  layer.style.transform = 'translateX(-100%)';
  setTimeout(() => { layer.style.display = 'none'; }, 360);
}

// Upload ImgBB
const IMGBB_KEY = 'fc8497dcdf559dc9cbff97378c82344c';
async function uploadImgBB(file) {
  const form = new FormData();
  form.append('image', file);
  const res  = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message || 'Falha no upload');
  return data.data.url;
}

async function uploadImgBBComProgresso(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('image', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 55) + 20; // 20~75%
        onProgress(pct);
      }
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (!data.success) reject(new Error(data.error?.message || 'Falha no upload'));
        else resolve(data.data.url);
      } catch (e) { reject(e); }
    };
    xhr.onerror = () => reject(new Error('Erro de rede'));
    xhr.send(form);
  });
}

function setupModalPost() {
  const layer     = $('postLayer');
  const closeBtn  = $('closeLayerBtn');
  const btnBubble = $('btn-bubble');
  const btnPost   = $('btn-post');
  const fileInput = $('post-file-input');
  const preview   = $q('.image-preview-post');
  const previewImg = preview?.querySelector('img');
  const removeBtn  = preview?.querySelector('.remove-image-post');

  if (!layer) return;
  layer.style.display = 'none';

  // Remove botão "Publicar" se existir no HTML
  layer.querySelector('.send-final-btn')?.remove();

  if (closeBtn) closeBtn.addEventListener('click', fecharModalPost);

  let pendingFile = null;

  // Injetar estilos do botão de remover imagem
  if (!document.getElementById('img-upload-styles')) {
    const st = document.createElement('style');
    st.id = 'img-upload-styles';
    st.textContent = `.image-preview-post{position:relative;display:inline-block;width:100%;}
      .image-preview-post img{width:100%;border-radius:12px;display:block;}
      .remove-image-post{position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.7);
        border:none;color:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;font-size:14px;z-index:10;}`;
    document.head.appendChild(st);
  }

  // Seleção de imagem
  if (fileInput) {
    fileInput.style.cursor = 'pointer';
    fileInput.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', () => {
        const file = inp.files[0]; inp.remove();
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { alert('Imagem deve ter no máximo 5MB.'); return; }
        pendingFile = file;
        const reader = new FileReader();
        reader.onload = ev => {
          if (previewImg) previewImg.src = ev.target.result;
          if (preview)    preview.style.display = '';
          if (fileInput)  fileInput.style.display = 'none'; // some o botão
        };
        reader.readAsDataURL(file);
      });
      inp.click();
    });
  }
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      pendingFile = null;
      if (preview)    preview.style.display = 'none';
      if (previewImg) previewImg.src = '';
      if (fileInput)  fileInput.style.display = ''; // mostra o botão de novo
    });
  }

  async function publicar(tipo) {
    if (!currentUserId) { alert('Voce precisa estar logado.'); return; }
    const textarea = layer.querySelector('.np-text-input');
    const content  = textarea?.value?.trim() || '';

    if (!content && !pendingFile) { alert('Escreva algo antes de publicar.'); return; }
    if (content.length > 360)     { alert('Texto muito longo (max. 360 caracteres).'); return; }

    const btn = tipo === 'bubble' ? btnBubble : btnPost;

    // Fecha o modal imediatamente
    fecharModalPost();

    // Mostra barra de carregamento abaixo do navbar do perfil
    let progressBar = $('post-upload-progress');
    if (!progressBar) {
      progressBar = document.createElement('div');
      progressBar.id = 'post-upload-progress';
      progressBar.style.cssText = `
        position:fixed;top:60px;left:0;right:0;height:3px;z-index:9999999;
        background:transparent;overflow:hidden;
      `;
      const fill = document.createElement('div');
      fill.id = 'post-upload-fill';
      fill.style.cssText = `
        height:100%;width:0%;
        background: #4A90E2;
        border-radius:0;
        transition:width 0.4s cubic-bezier(0.4,0,0.2,1);
      `;
      progressBar.appendChild(fill);
      document.body.appendChild(progressBar);
    }
    const fill = $('post-upload-fill');

    function setProgress(pct) {
      if (fill) fill.style.width = pct + '%';
    }

    function fecharProgressBar() {
      setProgress(100);
      setTimeout(() => {
        if (fill) {
          fill.style.transition = 'opacity 0.3s';
          fill.style.opacity = '0';
        }
        setTimeout(() => { progressBar?.remove(); }, 320);
      }, 320);
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Publicando...'; }

    try {
      const now = serverTimestamp();
      setProgress(15);

      if (tipo === 'bubble') {
        setProgress(40);
        const expiresAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
        await addDoc(collection(db, 'notes'), {
          content, creatorid: currentUserId, createdAt: now, expiresAt,
        });
        setProgress(85);
      } else {
        let imgUrl = '';
        if (pendingFile) {
          setProgress(20);
          imgUrl = await uploadImgBBComProgresso(pendingFile, setProgress);
        } else {
          setProgress(60);
        }
        setProgress(80);
        await addDoc(collection(db, 'posts'), {
          content, img: imgUrl, creatorid: currentUserId,
          createdAt: now, create: now, likes: 0,
        });
        setProgress(92);
      }

      if (textarea)   textarea.value = '';
      pendingFile = null;
      if (preview)    preview.style.display = 'none';
      if (previewImg) previewImg.src = '';

      fecharProgressBar();
      await carregarPosts(currentUserId);
      await atualizarStats(currentUserId);

    } catch (e) {
      console.error('publicar:', e);
      fecharProgressBar();
      alert('Erro ao publicar. Tente novamente.');
    } finally {
      if (btnBubble) { btnBubble.disabled = false; btnBubble.textContent = 'Nota'; }
      if (btnPost)   { btnPost.disabled   = false; btnPost.textContent   = 'Post'; }
    }
  }

  btnBubble?.addEventListener('click', () => publicar('bubble'));
  btnPost?.addEventListener('click',   () => publicar('post'));
}

// ═══════════════════════════════════════════════════════════
// POSTS
// ═══════════════════════════════════════════════════════════
async function carregarPosts(uid) {
  const c = $('muralPosts') || $q('.mural-tab');
  if (!c || !uid) return;
  c.innerHTML = `<div class="loading-container"><div class="loading-spinner"></div><p>Carregando posts...</p></div>`;

  let posts = [];
  try {
    // Tenta com query ordenada
    const snap = await getDocs(query(
      collection(db, 'posts'),
      where('creatorid', '==', uid),
      orderBy('createdAt', 'desc')
    ));
    snap.forEach(d => posts.push({ id: d.id, data: d.data() }));
  } catch {
    try {
      // Fallback: sem orderBy (índice pode não existir)
      const snap = await getDocs(query(collection(db, 'posts'), where('creatorid', '==', uid)));
      snap.forEach(d => posts.push({ id: d.id, data: d.data() }));
    } catch {
      // Último fallback: scan completo
      const snap = await getDocs(collection(db, 'posts'));
      snap.forEach(d => { if (d.data().creatorid === uid) posts.push({ id: d.id, data: d.data() }); });
    }
    // Ordena no cliente
    posts.sort((a, b) => {
      const ts = x => {
        const v = x?.createdAt || x?.create;
        return v?.toDate?.()?.getTime() || (v?.seconds ? v.seconds * 1000 : new Date(v || 0).getTime());
      };
      return ts(b.data) - ts(a.data);
    });
  }

  postsDoUsuario = posts.map(p => ({ id: p.id, userid: uid, data: p.data }));
  c.innerHTML = '';

  if (!posts.length) {
    c.classList.add('empty-posts');
    c.innerHTML = `
      <div class="about-box" style="text-align:center;padding:30px;width:100%!important;">
        <div class="icon-area"><div class="icon-place">
          <i class="fa-regular fa-camera" style="font-size:38px;color:#fff;"></i>
        </div></div>
        <h3 style="color:#fff;margin-bottom:12px;">Nenhum post ainda</h3>
        <p style="color:#555;">${isOwnProfile
          ? 'Use o botão + acima para criar seu primeiro post!'
          : 'Este usuário ainda não fez nenhum post.'}</p>
      </div>`;
    return;
  }

  c.classList.remove('empty-posts');
  posts.forEach(p => c.appendChild(criarPreview(p.data, p.id)));

  // Atualiza contador
  if ($('amigosCount')) $('amigosCount').textContent = posts.length;
}

function criarPreview(postData, postId) {
  const el = document.createElement('div');
  el.className = 'postpreview';
  if (postData.img?.trim()) {
    el.innerHTML = `<img src="${postData.img}" class="post-preview-img" loading="lazy"
      onerror="this.parentElement.innerHTML='<div class=post-preview-error>Erro</div>'">`;
  } else {
    const txt = postData.content || '';
    el.innerHTML = `<div class="post-preview-text-container">
      <p class="post-preview-text">${txt.length > 80 ? txt.slice(0, 80) + '…' : txt}</p>
    </div>`;
  }
  el.onclick = () => {
    const i = postsDoUsuario.findIndex(p => p.id === postId);
    abrirFeed(i >= 0 ? i : 0);
  };
  return el;
}

// ═══════════════════════════════════════════════════════════
// FEED EXPANDIDO
// ═══════════════════════════════════════════════════════════

// Animação do contador de visitas
function animarContador(el, novoValor) {
  if (!el) return;
  const valorAtual = parseInt(el.textContent) || 0;
  if (valorAtual === novoValor) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;overflow:hidden;display:inline-block;height:1.2em;vertical-align:bottom;';

  const atual = document.createElement('span');
  atual.style.cssText = 'display:block;animation:counterOut 0.35s cubic-bezier(0.4,0,1,1) forwards;';
  atual.textContent = valorAtual;

  const novo = document.createElement('span');
  novo.style.cssText = 'display:block;animation:counterIn 0.35s cubic-bezier(0,0,0.2,1) forwards;';
  novo.textContent = novoValor;

  if (!document.getElementById('counter-anim-style')) {
    const s = document.createElement('style');
    s.id = 'counter-anim-style';
    s.textContent = `
      @keyframes counterOut { from{transform:translateY(0);opacity:1} to{transform:translateY(-100%);opacity:0} }
      @keyframes counterIn  { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
    `;
    document.head.appendChild(s);
  }

  wrapper.appendChild(atual);
  wrapper.appendChild(novo);

  // Preserva conteúdo do pai e troca
  const parent = el.parentNode;
  const label = el.nextSibling; // guarda o label ao lado se existir
  el.replaceWith(wrapper);

  setTimeout(() => {
    el.textContent = novoValor;
    wrapper.replaceWith(el);
  }, 380);
}

// Override renderStatsContadores para animar
const _renderStatsOriginal = window._renderStatsOriginal || null;
function renderStatsContadoresAnimado(userData) {
  const visitas  = userData?.visitCount || 0;
  const curtidas = userData?.likeCount  || 0;
  const elVisitas  = $('seguindoCount');
  const elCurtidas = $('seguidoresCount');
  if (elVisitas)  animarContador(elVisitas,  visitas);
  if (elCurtidas) animarContador(elCurtidas, curtidas);
}

// Sobrescreve a função original
window.renderStatsContadores = renderStatsContadoresAnimado;

// Modal de 3 pontinhos do feed
function abrirFeedOptionsModal(postId) {
  if ($('feed-options-modal')) return;

  const backdrop = document.createElement('div');
  backdrop.id = 'feed-options-modal';
  backdrop.style.cssText = `
    position:fixed;inset:0;z-index:999999999;
    background: var(--bg-modal);
    display:flex;align-items:flex-end;justify-content:center;
    opacity:0;transition:opacity 0.22s;
  `;

  const sheet = document.createElement('div');
  sheet.style.cssText = `
    width:100%;max-width:500px;
    background:#202020;
    border-radius:20px 20px 0 0;
    padding: 18px 16px max(50px,env(safe-area-inset-bottom));
    transform:translateY(100%);
    transition:transform 0.35s cubic-bezier(0.32,0.72,0,1);
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;

  sheet.innerHTML = `
    <button id="feed-opt-delete" style="display:flex;align-items:center;gap:14px;padding:16px 24px;width:100%;background:#373737;border:none; border-radius: 14px; color:#ff4444;font-size:18px;font-weight:500;cursor:pointer;text-align: center;">
     Apagar post
    </button>
    <button id="feed-opt-cancel" style="display:flex;align-items:center;gap:14px;padding:16px 24px;width:100%;background:#373737;border:none; border-radius:14px;color:#aaa;font-size:18px;font-weight:500;cursor:pointer; text-align: center;">
      Cancelar
    </button>
  `;

  function fecharFeedOptions() {
    sheet.style.transform = 'translateY(100%)';
    backdrop.style.opacity = '0';
    setTimeout(() => backdrop.remove(), 380);
  }

  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    sheet.style.transform  = 'translateY(0)';
  }));

  backdrop.addEventListener('click', e => { if (e.target === backdrop) fecharFeedOptions(); });
  sheet.querySelector('#feed-opt-cancel').addEventListener('click', fecharFeedOptions);
  sheet.querySelector('#feed-opt-delete').addEventListener('click', async () => {
    if (!currentUserId || !isOwnProfile) { fecharFeedOptions(); return; }
    try {
      const { deleteDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      await deleteDoc(doc(db, 'posts', postId));
      fecharFeedOptions();
      // Remove o card do feed
      const card = $(`fp-${postId}`);
      if (card) {
        card.style.transition = 'opacity 0.25s,transform 0.25s';
        card.style.opacity    = '0';
        card.style.transform  = 'scale(0.95)';
        setTimeout(() => card.remove(), 260);
      }
      await carregarPosts(currentUserId);
      await atualizarStats(currentUserId);
    } catch(e) { console.error('apagar post:', e); fecharFeedOptions(); }
  });
}

function abrirFeed(startIdx) {
  if ($('feed-overlay')) return;

  const style = document.createElement('style');
  style.id = 'feed-overlay-css';
  style.textContent = `
    #feed-overlay-header {
      position:fixed;top:0;left:0;right:0;z-index:10;
      height:56px;
      display:grid;
      grid-template-columns:56px 1fr 56px;
      align-items:center;
      background:var(--bg-primary);
      border-bottom:1px solid #1e1e1e;
    }
    #feed-overlay-header .foh-back {
      background:none;border:none;color:#f8f9f9;
      width:56px;height:56px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
    }
    #feed-overlay-header .foh-center {
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      line-height:1.3;
    }

    #feed-overlay-header .foh-center-user {
      font-size:15px;font-weight:700;color:#f8f9f9;
    }
    #feed-overlay-header .foh-center-user i { color:#4A90E2;font-size:11px;margin-left:3px; }
    #feed-overlay-header .foh-right-spacer { width:56px; }
    #feed-overlay { padding-top:56px; }
    .feed-post { border-bottom:1px solid #1a1a1a;position:relative; }
    .feed-post-header { display:flex;align-items:center;justify-content:space-between;padding:12px 12px 8px; }
    .feed-post-header-left { display:flex;align-items:center;gap:10px; }
    .feed-post-dots { background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:8px;display:flex;align-items:center; }
  `;
  document.head.appendChild(style);

  const foto = currentProfileData?.media?.pfp || currentProfileData?.media?.userphoto || './src/img/default.jpg';
  const un   = profileUsername;
  const verified = !!currentProfileData?.verified;

  const overlay = document.createElement('div');
  overlay.id = 'feed-overlay';

  // Header profissional
  const header = document.createElement('div');
  header.id = 'feed-overlay-header';
  header.innerHTML = `
    <button class="foh-back" id="feed-header-back">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 298 511.93" width="18" fill="#f8f9f9"><path d="M285.77 441c16.24 16.17 16.32 42.46.15 58.7-16.16 16.24-42.45 16.32-58.69.16l-215-214.47c-16.24-16.16-16.32-42.45-.15-58.69L227.23 12.08c16.24-16.17 42.53-16.09 58.69.15 16.17 16.24 16.09 42.54-.15 58.7l-185.5 185.04L285.77 441z"/></svg>
    </button>
    <div class="foh-center">
      <span class="foh-center-label">posts</span>
      <span class="foh-center-user">${un}${verified ? '<i class="fa-solid fa-circle-check"></i>' : ''}</span>
    </div>
    <div class="foh-right-spacer"></div>
  `;
  overlay.appendChild(header);

  header.querySelector('#feed-header-back').addEventListener('click', () => {
    overlay.remove(); style.remove(); document.body.style.overflow = '';
  });

  postsDoUsuario.forEach(({ data, id }) => {
    const postEl = document.createElement('div');
    postEl.className = 'feed-post';
    postEl.id = `fp-${id}`;
    const ts = data.createdAt || data.create;

    // Monta header do post
    const postHeader = document.createElement('div');
    postHeader.className = 'feed-post-header';
    postHeader.innerHTML = `
      <div class="feed-post-header-left">
        <img class="feed-post-pfp" src="${foto}" onerror="this.src='./src/img/default.jpg'">
        <div>
          <div class="feed-post-name">${un}${verified ? '<i class="fa-solid fa-circle-check"></i>' : ''}</div>
          <div class="feed-post-time">${formatTs(ts)}</div>
        </div>
      </div>
      ${isOwnProfile ? `<button class="feed-post-dots" data-id="${id}"><i class="fas fa-ellipsis-v"></i></button>` : ''}
    `;
    postEl.appendChild(postHeader);

    if (data.img) {
      const img = document.createElement('img');
      img.className = 'feed-post-img';
      img.src = data.img;
      img.loading = 'lazy';
      img.onclick = () => window.abrirModalImagem(data.img);
      postEl.appendChild(img);
    }
    if (data.content) {
      const cnt = document.createElement('div');
      cnt.className = 'feed-post-content';
      cnt.innerHTML = formatPost(data.content);
      postEl.appendChild(cnt);
    }

    overlay.appendChild(postEl);
  });

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Delega clique nos 3 pontinhos de cada post
  overlay.addEventListener('click', e => {
    const dotsBtn = e.target.closest('.feed-post-dots');
    if (dotsBtn) abrirFeedOptionsModal(dotsBtn.dataset.id);
  });

  // Rola até o post clicado
  requestAnimationFrame(() => {
    const target = $(`fp-${postsDoUsuario[startIdx]?.id}`);
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
  });
}

// ═══════════════════════════════════════════════════════════
// MODAL DE IMAGEM
// ═══════════════════════════════════════════════════════════
window.abrirModalImagem = url => {
  const m = document.createElement('div');
  m.className = 'image-modal';
  m.innerHTML = `<div class="modal-overlay" onclick="window.fecharModal()">
    <div class="modal-content" onclick="event.stopPropagation()">
      <button class="modal-close" onclick="window.fecharModal()"><i class="fas fa-times"></i></button>
      <img src="${url}" class="modal-image">
    </div></div>`;
  document.body.appendChild(m);
  document.body.style.overflow = 'hidden';
};
window.fecharModal = () => {
  const m = $q('.image-modal');
  if (m) { m.remove(); document.body.style.overflow = ''; }
};

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function configurarTabs(uid) {
  const items  = $qa('.menu-item');
  const tabs   = $qa('.tab');
  const slider = $q('.slider');
  if (!items.length || !tabs.length || !slider) return;
  let busy = false;

  const mover = i => { slider.style.transform = `translateX(${i * 100}%)`; };

  const trocar = async i => {
    if (busy) return; busy = true;
    const atual = $q('.tab.active');
    if (atual) {
      atual.classList.add('fade-out');
      await new Promise(r => setTimeout(r, 200));
      atual.classList.remove('active', 'fade-out');
    }
    if (tabs[i]) {
      tabs[i].classList.add('active', 'fade-in');
      await new Promise(r => setTimeout(r, 300));
      tabs[i].classList.remove('fade-in');
    }
    busy = false;
  };

  items.forEach((item, i) => {
    item.addEventListener('click', async () => {
      if (busy || item.classList.contains('active')) return;
      items.forEach(m => m.classList.remove('active'));
      item.classList.add('active');
      mover(i);
      await trocar(i);
    });
  });

  items[0]?.classList.add('active');
  tabs[0]?.classList.add('active');
  mover(0);
}

// ═══════════════════════════════════════════════════════════
// MODAL "VER MAIS SOBRE"
// ═══════════════════════════════════════════════════════════
function setupViewMoreModal() {
  const overlay  = $q('.more-overlay');
  const modal    = $q('.more-info-modal');
  const openBtn  = $q('.view-more');
  const dragArea = $q('.header-area');
  if (!overlay || !modal || !openBtn) return;

  function openMoreModal()  {
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeMoreModal() {
    modal.style.transition  = 'transform 0.38s cubic-bezier(0.32,0.72,0,1)';
    modal.style.transform   = 'translateY(100%)';
    overlay.style.opacity   = '0';
    setTimeout(() => {
      overlay.classList.remove('active');
      modal.style.transform  = '';
      modal.style.transition = '';
      overlay.style.opacity  = '';
      document.body.style.overflow = '';
    }, 400);
  }

  const newBtn = openBtn.cloneNode(true);
  openBtn.parentNode?.replaceChild(newBtn, openBtn);
  newBtn.addEventListener('click', openMoreModal);

  overlay.addEventListener('click', e => { if (e.target === overlay) closeMoreModal(); });

  // Drag to close
  if (dragArea) {
    let startY = 0, curY = 0, dragging = false;
    dragArea.addEventListener('touchstart', e => {
      startY = e.touches[0].clientY; dragging = true;
      modal.style.transition = 'none';
    }, { passive: true });
    dragArea.addEventListener('touchmove', e => {
      if (!dragging) return;
      curY = e.touches[0].clientY;
      const diff = curY - startY;
      if (diff > 0) modal.style.transform = `translateY(${diff}px)`;
    }, { passive: true });
    dragArea.addEventListener('touchend', () => {
      if (!dragging) return; dragging = false;
      if (curY - startY > 80) closeMoreModal();
      else { modal.style.transition = 'transform 0.3s'; modal.style.transform = 'translateY(0)'; }
    });
  }

  // Botão editar: só aparece para o dono do perfil
  const btnEdit   = $('open-edit');
  const btnCancel = $('cancel-edit');
  const btnSave   = $('save-view-mode');
  const viewMode  = $q('.view-mode');
  const editMode  = $q('.edit-mode');

  // Helpers para mostrar/esconder respeitando tanto style.display quanto a classe .hidden
  function showEl(el)  { if (!el) return; el.style.display = ''; el.classList.remove('hidden'); }
  function hideEl(el)  { if (!el) return; el.style.display = 'none'; el.classList.add('hidden'); }

  // Estado: false = view, true = edit
  let _editando = false;

  function entrarModoView() {
    _editando = false;
    if (editMode) { editMode.classList.add('hidden'); editMode.style.display = 'none'; }
    if (viewMode) { viewMode.classList.remove('hidden'); viewMode.style.display = ''; }
    showEl(btnEdit);
    hideEl(btnCancel);
    hideEl(btnSave);
  }

  function entrarModoEdit() {
    _editando = true;
    if (viewMode) { viewMode.classList.add('hidden'); viewMode.style.display = 'none'; }
    if (editMode) { editMode.classList.remove('hidden'); editMode.style.display = ''; }
    hideEl(btnEdit);
    showEl(btnCancel);
    showEl(btnSave);
  }

  // Esconde botão editar para visitantes — chamado após boot via window._refreshEditBtn
  function atualizarVisibilidadeEdit() {
    // Só altera visibilidade se não estiver em modo edição
    if (_editando) return;
    if (isOwnProfile) {
      showEl(btnEdit);
    } else {
      hideEl(btnEdit);
      hideEl(btnCancel);
      hideEl(btnSave);
    }
  }

  // Inicialmente esconde tudo (isOwnProfile ainda não definido)
  hideEl(btnEdit);
  hideEl(btnCancel);
  hideEl(btnSave);

  // Garante que editMode começa escondido e viewMode visível
  if (editMode) { editMode.classList.add('hidden'); editMode.style.display = 'none'; }
  if (viewMode) { viewMode.classList.remove('hidden'); viewMode.style.display = ''; }

  // Expõe para chamada após boot
  window._refreshEditBtn = atualizarVisibilidadeEdit;

  // Preenche os inputs com dados atuais ao abrir edição
  function preencherInputsEdicao() {
    const d = currentProfileData || {};
    const a = d.about || {};
    const l = d.likes || {};
    const getInput = cls => editMode ? editMode.querySelector('.' + cls + ' .edit-input') : null;
    const set = (cls, val) => { const el = getInput(cls); if (el) el.value = val || ''; };
    set('modal-info-buscando',    a.searching);
    set('modal-info-overview',    a.overview);
    set('modal-info-style',       a.style);
    set('modal-info-personality', a.personality);
    set('modal-info-music',       l.music);
    set('modal-info-movies',      l.movies);
    set('modal-info-books',       l.books);
    set('modal-info-characters',  l.characters);
    set('modal-info-foods',       l.foods);
    set('modal-info-hobbies',     l.hobbies);
    set('modal-info-games',       l.games);
    set('modal-info-others',      l.others);
  }

  if (btnEdit) {
    btnEdit.addEventListener('click', () => {
      if (!isOwnProfile) return;
      preencherInputsEdicao();
      entrarModoEdit();
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      entrarModoView();
    });
  }

  // Salvar no Firestore
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      if (!currentUserId || !isOwnProfile) return;
      btnSave.disabled = true;
      const getVal = cls => {
        const el = editMode ? editMode.querySelector('.' + cls + ' .edit-input') : null;
        return el ? el.value.trim() : '';
      };
      try {
        await Promise.all([
          updateDoc(doc(db, 'users', currentUserId, 'user-infos', 'about'), {
            searching:   getVal('modal-info-buscando'),
            overview:    getVal('modal-info-overview'),
            style:       getVal('modal-info-style'),
            personality: getVal('modal-info-personality'),
          }),
          updateDoc(doc(db, 'users', currentUserId, 'user-infos', 'likes'), {
            music:      getVal('modal-info-music'),
            movies:     getVal('modal-info-movies'),
            books:      getVal('modal-info-books'),
            characters: getVal('modal-info-characters'),
            foods:      getVal('modal-info-foods'),
            hobbies:    getVal('modal-info-hobbies'),
            games:      getVal('modal-info-games'),
            others:     getVal('modal-info-others'),
          }),
        ]);
        entrarModoView();
      } catch(e) {
        console.error('salvar modal:', e);
        alert('Erro ao salvar. Tente novamente.');
      } finally {
        btnSave.disabled = false;
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════
// STICKY MENU
// ═══════════════════════════════════════════════════════════
function setupStickyMenu() {
  const profileMenu = $('profileMenu');
  const placeholder = $q('.menu-placeholder');
  if (!profileMenu || !placeholder) return;

  const navbarHeight   = 60;
  let menuOriginalTop  = profileMenu.offsetTop;

  // Recalcula após load completo
  window.addEventListener('load', () => { menuOriginalTop = profileMenu.offsetTop; });

  window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const isSticky  = scrollTop >= menuOriginalTop - navbarHeight;
    profileMenu.classList.toggle('sticky', isSticky);
    placeholder.classList.toggle('active', isSticky);
  }, { passive: true });
}



// ═══════════════════════════════════════════════════════════
// BOTÃO SAIR + COMPARTILHAR SIDEBAR
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  $q('.logoff')?.addEventListener('click', async e => {
    e.preventDefault();
    try { await signOut(auth); } catch {}
    window.location.href = 'login.html';
  });

  // Compartilhar meu perfil da sidebar — compartilha o perfil do usuário logado
  document.querySelectorAll('.menu-item-link').forEach(link => {
    const span = link.querySelector('span');
    if (span && span.textContent.trim() === 'Compartilhar Meu Perfil') {
      link.addEventListener('click', async e => {
        e.preventDefault();
        let url;
        if (currentUserId) {
          try {
            const ud = await getDoc(doc(db, 'users', currentUserId));
            const un = ud.exists() ? ud.data().username : null;
            url = un
              ? `${location.origin}${location.pathname}?username=${encodeURIComponent(un)}`
              : location.href;
          } catch { url = location.href; }
        } else {
          url = location.href;
        }
        if (navigator.share) {
          navigator.share({ title: 'Meu perfil no Profiles', url }).catch(() => {});
        } else {
          navigator.clipboard?.writeText(url)
            .then(() => alert('Link copiado!'))
            .catch(() => alert(url));
        }
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════
// INICIALIZAÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════
lsClean();

document.addEventListener('DOMContentLoaded', () => {
  setupViewMoreModal();
  setupModalPost();
});

onAuthStateChanged(auth, async user => {
  currentUser   = user;
  currentUserId = user?.uid || null;

  const usernameURL = urlParam('username') || urlParam('u') || urlParam('user');
  const useridURL   = urlParam('userid')   || urlParam('uid');

  async function boot(uid) {
    // Registra visita antes de tudo (apenas para visitantes)
    registrarVisita(uid);
    await Promise.all([configurarBotoes(uid), atualizarStats(uid)]);
    await carregarPosts(uid);
    configurarTabs(uid);
    setupStickyMenu();
    if (currentProfileData?.media) renderMidia(currentProfileData.media);
    // Re-aplica visibilidade do botão editar após boot (isOwnProfile já definido)
    if (typeof window._refreshEditBtn === 'function') window._refreshEditBtn();
  }

  if (usernameURL) {
    const uid = await resolveUsername(usernameURL);
    if (!uid) { mostrarErro('Perfil não encontrado. Verifique o username.'); return; }

    profileUserId = uid;
    isOwnProfile  = !!(user && user.uid === uid);

    const cacheKey = usernameURL.toLowerCase().trim();
    const cached   = lsGet(cacheKey);
    if (cached) {
      preencherPerfil(cached);
      setupListeners(uid);
      if (cached.__stale) {
        carregarDados(uid).then(d => { if (d) lsSave(cacheKey, d); });
      }
    } else {
      const dados = await carregarDados(uid);
      if (!dados) return;
      preencherPerfil(dados);
      lsSave(cacheKey, dados);
      setupListeners(uid);
    }
    await boot(uid);

  } else if (useridURL) {
    profileUserId = useridURL;
    isOwnProfile  = !!(user && user.uid === useridURL);
    const dados = await carregarDados(useridURL);
    if (!dados) return;
    preencherPerfil(dados);
    setupListeners(useridURL);
    await boot(useridURL);

  } else if (user) {
    try {
      const ud = await getDoc(doc(db, 'users', user.uid));
      if (ud.exists()) {
        window.location.href = `profile.html?username=${ud.data().username}`;
      } else {
        mostrarErro('Complete seu cadastro para acessar o perfil.');
      }
    } catch { mostrarErro('Erro ao redirecionar.'); }

  } else {
    mostrarErro('Faça login para acessar esta página.');
  }
});