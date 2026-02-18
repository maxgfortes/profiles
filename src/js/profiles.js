import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  collection,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCHA1ZPOCOK_zKkfJfYHF2aBFdykIvvOxc",
  authDomain: "profiles-4-instagram.firebaseapp.com",
  projectId: "profiles-4-instagram",
  storageBucket: "profiles-4-instagram.firebasestorage.app",
  messagingSenderId: "35795561568",
  appId: "1:35795561568:web:3c539d38409097098ae705"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let isOwnProfile = false;
let profileUserId = null; // UID do perfil sendo visualizado
let currentProfileData = null;
let inlineEditorReady = false;
let isSavingInlineProfile = false;
const IMGBB_API_KEY = "fc8497dcdf559dc9cbff97378c82344c";

// Exportar para uso nos outros módulos
export { db, auth, currentUser, isOwnProfile, profileUserId };

/* ================= SISTEMA DE TRADUÇÃO ================= */

let languages = {};
let currentLanguage = 'pt';

// Carregar arquivo de idiomas
async function loadLanguages() {
  try {
    const response = await fetch('./languages.json');
    languages = await response.json();
    
    // Carregar idioma salvo ou usar português como padrão
    currentLanguage = localStorage.getItem('selectedLanguage') || 'pt';
    applyTranslations();
  } catch (error) {
    console.error('Erro ao carregar idiomas:', error);
    // Se falhar, usar português como padrão
    currentLanguage = 'pt';
  }
}

// Função para pegar tradução
function t(path) {
  try {
    const keys = path.split('.');
    let value = languages[currentLanguage]?.translations;
    
    for (const key of keys) {
      value = value?.[key];
    }
    
    return value || path;
  } catch (error) {
    console.warn('Tradução não encontrada:', path);
    return path;
  }
}

// Exportar função de tradução
export { t };

/*  Aplicar traduções na página
function applyTranslations() {
  // Menu
  document.querySelector('.menu-header h3').textContent = t('menu.title');
  
  const menuItems = document.querySelectorAll('.menu-item-link span');
  menuItems[0].textContent = t('menu.home'); // Início
  menuItems[1].textContent = t('menu.myProfile'); // Meu Perfil
  menuItems[2].textContent = t('menu.editProfile'); // Editar Perfil
  menuItems[3].textContent = t('menu.shareProfile'); // Compartilhar
  menuItems[4].textContent = t('menu.language'); // Idioma
  
  // Seção de login/logout
  document.querySelector('.section-title').textContent = t('menu.login');
  document.querySelector('.menu-item-link.login span').textContent = t('menu.login');
  document.querySelector('.menu-item-link.logoff span').textContent = t('menu.logout');
  
  // Stats do perfil
  document.querySelectorAll('.stat-label')[0].textContent = t('profile.friends');
  document.querySelectorAll('.stat-label')[1].textContent = t('profile.followers');
  document.querySelectorAll('.stat-label')[2].textContent = t('profile.following');
  
  
  // Botões de ação
  const actionBtns = document.querySelectorAll('.action-btn');
  if (actionBtns[0]) actionBtns[0].textContent = t('profile.addFriend');
  if (actionBtns[0]) actionBtns[1].textContent = t('profile.edit');
  if (actionBtns[1]) actionBtns[2].textContent = t('profile.shareProfile');

  document.querySelectorAll('.info-label')[0].textContent = t('profile.name');
  document.querySelectorAll('.info-label')[1].textContent = t('profile.gender');
  document.querySelectorAll('.info-label')[2].textContent = t('profile.maritalstatus');
  document.querySelectorAll('.info-label')[3].textContent = t('profile.livein');
  document.querySelectorAll('.info-label')[4].textContent = t('profile.birthday');
  
  // Tabs do profile-menu NÃO são traduzidas (só têm ícones)
  
  // Modal de idiomas
  document.querySelector('.language-header h3').textContent = t('languageModal.title');
}

// Atualizar idioma
function changeLanguage(langCode) {
  currentLanguage = langCode;
  localStorage.setItem('selectedLanguage', langCode);
  applyTranslations();
  
  // Re-preencher seções se os dados já estiverem carregados
  const aboutContainer = document.querySelector('.visao-tab .about-container');
  if (aboutContainer && aboutContainer.children.length > 0) {
    // Recarregar as traduções das seções
    updateSectionTranslations();
  }
}

// Atualizar traduções das seções dinâmicas
function updateSectionTranslations() {
  // Atualizar títulos da seção About
  const aboutTitles = document.querySelectorAll('.visao-tab .about-title');
  const aboutKeys = ['searching', 'overview', 'myStyle', 'myPersonality'];
  aboutTitles.forEach((title, index) => {
    if (aboutKeys[index]) {
      title.textContent = t(`aboutSection.${aboutKeys[index]}`);
    }
  });
  
  // Atualizar títulos da seção Gostos
  const likesTitles = document.querySelectorAll('.gostos-tab .about-title');
  const likesKeys = ['music', 'movies', 'books', 'characters', 'foods', 'hobbies', 'games', 'others'];
  likesTitles.forEach((title, index) => {
    if (likesKeys[index]) {
      title.textContent = t(`likesSection.${likesKeys[index]}`);
    }
  });
}

/* ================= SISTEMA DE CACHE ================= */

const CACHE_KEY_PREFIX = 'profile_cache_';
const CACHE_DURATION    = 7 * 24 * 60 * 60 * 1000;  // 7 dias — válido para exibir
const CACHE_STALE       = 5 * 60 * 1000;             // 5 min — revalida em background se mais velho

function salvarNoCache(username, dados) {
  try {
    localStorage.setItem(
      CACHE_KEY_PREFIX + username.toLowerCase(),
      JSON.stringify({ timestamp: Date.now(), data: dados })
    );
  } catch (e) {
    // localStorage cheio — limpa tudo do app e tenta de novo
    limparCacheAntigo(true);
    try {
      localStorage.setItem(
        CACHE_KEY_PREFIX + username.toLowerCase(),
        JSON.stringify({ timestamp: Date.now(), data: dados })
      );
    } catch (_) {}
  }
}

function buscarNoCache(username) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + username.toLowerCase());
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(CACHE_KEY_PREFIX + username.toLowerCase());
      return null;
    }
    // devolve os dados + flag indicando se precisa revalidar
    data.__stale = (Date.now() - timestamp) > CACHE_STALE;
    return data;
  } catch (e) {
    return null;
  }
}

function limparCacheAntigo(force = false) {
  try {
    Object.keys(localStorage).forEach(key => {
      if (!key.startsWith(CACHE_KEY_PREFIX)) return;
      if (force) { localStorage.removeItem(key); return; }
      try {
        const { timestamp } = JSON.parse(localStorage.getItem(key));
        if (Date.now() - timestamp > CACHE_DURATION) localStorage.removeItem(key);
      } catch { localStorage.removeItem(key); }
    });
  } catch {}
}

/* ================= CORES (sem transparência) ================= */
/* function applySolidProfileColor(hex) {
  if (!hex) return;
  try {
    // Normaliza: remove aspas, espaços e garante '#' no começo
    let h = String(hex).trim();
    h = h.replace(/^\"|\"$|^\'|\'$/g, '');
    if (!h.startsWith('#')) h = '#' + h;
    // Validate 3 or 6 hex digits
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) {
      console.warn('applySolidProfileColor: valor de cor inválido', hex);
      return;
    }

    // Aplica também uma variável sólida para uso no CSS
    document.documentElement.style.setProperty('--profile-color', h);
    document.documentElement.style.setProperty('--profile-color-solid', h);

    // Aplicar cor ao fundo da página (fundo sólido por padrão)
    try {
      document.body.style.background = h;
    } catch (e) {
      console.warn('Não foi possível aplicar a cor de fundo ao body', e);
    }

    // ícones dentro das caixas About
    document.querySelectorAll('.about-box i').forEach(el => {
      el.style.color = h;
    });

    // títulos das seções
    document.querySelectorAll('.about-title').forEach(el => {
      el.style.color = h;
    });

    // slider (barra móvel)
    document.querySelectorAll('.slide').forEach(el => {
      el.style.backgroundColor = h;
    });

    // se houver elementos .slide com gradiente, aplicar cor de fundo sólida
    document.querySelectorAll('.slide').forEach(el => {
      el.style.background = h;
    });
  } catch (e) {
    console.error('applySolidProfileColor error', e);
  }
}

/* ================= UTILITÁRIOS ================= */

function getUsernameFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('username') || params.get('u') || params.get('user');
}

function calcularIdade(nascimento) {
  if (!nascimento) return t('common.notInformed');
  const hoje = new Date();
  const nasc = nascimento.toDate ? nascimento.toDate() : new Date(nascimento);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mes = hoje.getMonth() - nasc.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nasc.getDate())) {
    idade--;
  }
  return idade + ' ' + t('common.years');
}

function traduzirGenero(genero) {
  const generos = {
    'masculino': t('gender.male'),
    'feminino': t('gender.female'),
    'outro': t('gender.other'),
    'prefiro_nao_dizer': t('gender.preferNotToSay'),
    'male': t('gender.male'),
    'female': t('gender.female'),
    'other': t('gender.other'),
    'prefer_not_to_say': t('gender.preferNotToSay')
  };
  return generos[genero?.toLowerCase()] || t('common.notInformed');
}

function mostrarErro(mensagem) {
  document.querySelector('.full-profile-container').innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 20px;">
      <i class="fas fa-exclamation-circle" style="font-size: 64px; color: #f85149; margin-bottom: 20px;"></i>
      <h2 style="color: #f8f9f9; margin-bottom: 10px;">${t('errors.oops')}</h2>
      <p style="color: #aaa; text-align: center;">${mensagem}</p>
      <a href="index.html" style="margin-top: 20px; color: #4A90E2; text-decoration: none;">${t('common.backToHome')}</a>
    </div>
  `;
}

/* ================= CARREGAR DADOS DO FIRESTORE ================= */

async function carregarDadosUsuario(uid) {
  try {
    // Todas as leituras em paralelo — reduz latência de 4x para 1x
    const [userDoc, mediaDoc, likesDoc, aboutDoc, moreInfosDoc] = await Promise.all([
      getDoc(doc(db, "users", uid)),
      getDoc(doc(db, `users/${uid}/user-infos/user-media`)),
      getDoc(doc(db, `users/${uid}/user-infos/likes`)),
      getDoc(doc(db, `users/${uid}/user-infos/about`)),
      getDoc(doc(db, `users/${uid}/user-infos/more-infos`)),
    ]);

    if (!userDoc.exists()) { mostrarErro("Perfil não encontrado"); return null; }

    return {
      ...userDoc.data(),
      uid,
      media:     mediaDoc.exists()     ? mediaDoc.data()     : {},
      likes:     likesDoc.exists()     ? likesDoc.data()     : {},
      about:     aboutDoc.exists()     ? aboutDoc.data()     : {},
      moreInfos: moreInfosDoc.exists() ? moreInfosDoc.data() : {},
    };
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
    return null;
  }
}

async function carregarPerfilPorUsername(username) {
  const usernameKey = username.toLowerCase();

  try {
    const dadosCache = buscarNoCache(username);

    if (dadosCache) {
      // Exibe instantaneamente do cache
      preencherPerfil(dadosCache);

      // Busca UID e decide se revalida — tudo em paralelo
      const usernameDoc = await getDoc(doc(db, "usernames", usernameKey));
      if (!usernameDoc.exists()) return;

      const uid = usernameDoc.data().uid;
      profileUserId = uid;
      isOwnProfile  = currentUser && currentUser.uid === uid;

      // Listeners em tempo real sempre ativos
      setupRealtimeListeners(uid);
      initDynamicModules(uid);

      // Revalida cache em background se stale
      if (dadosCache.__stale) {
        carregarDadosUsuario(uid).then(dados => {
          if (dados) salvarNoCache(username, dados);
        });
      }
      return;
    }

    // Sem cache — busca UID e dados em paralelo
    const usernameDoc = await getDoc(doc(db, "usernames", usernameKey));
    if (!usernameDoc.exists()) { mostrarErro("Perfil não encontrado"); return; }

    const uid = usernameDoc.data().uid;
    profileUserId = uid;
    isOwnProfile  = currentUser && currentUser.uid === uid;

    const dadosCompletos = await carregarDadosUsuario(uid);
    if (!dadosCompletos) return;

    preencherPerfil(dadosCompletos);
    salvarNoCache(username, dadosCompletos);
    setupRealtimeListeners(uid);
    initDynamicModules(uid);

  } catch (error) {
    console.error("Erro ao carregar perfil:", error);
    mostrarErro("Erro ao carregar perfil");
  }
}

// Inicializar módulos dinâmicos (botões e contadores)
async function initDynamicModules(uid) {
  try {
    // Importar e inicializar botões dinâmicos
    const buttonsModule = await import('./src/js/buttons-dynamic.js');
    await buttonsModule.initButtons(isOwnProfile, uid);
    
    // Importar e inicializar contadores
    const counterModule = await import('./src/js/counter.js');
    counterModule.initCounters(uid);
  } catch (error) {
    console.error('Erro ao inicializar módulos dinâmicos:', error);
  }
}


/* ================= LISTENERS EM TEMPO REAL ================= */

function setupRealtimeListeners(uid) {
  // Listener para dados principais
  onSnapshot(doc(db, "users", uid), (snapshot) => {
    if (snapshot.exists()) {
      atualizarDadosPrincipais(snapshot.data());
    }
  });

  // Listener para mídia
  onSnapshot(doc(db, `users/${uid}/user-infos/user-media`), (snapshot) => {
    if (snapshot.exists()) {
      atualizarMidia(snapshot.data());
    }
  });

  // Listener para likes
  onSnapshot(doc(db, `users/${uid}/user-infos/likes`), (snapshot) => {
    if (snapshot.exists()) {
      atualizarLikes(snapshot.data());
    }
  });

  // Listener para about
  onSnapshot(doc(db, `users/${uid}/user-infos/about`), (snapshot) => {
    if (snapshot.exists()) {
      atualizarAbout(snapshot.data());
    }
  });

  // Listener para more-infos (bio)
  onSnapshot(doc(db, `users/${uid}/user-infos/more-infos`), (snapshot) => {
    if (snapshot.exists()) {
      atualizarMoreInfos(snapshot.data());
    }
  });
}

/* ================= PREENCHER PERFIL ================= */

function preencherPerfil(dados) {
  currentProfileData = dados;

  const displayName = dados.displayName || dados.name || 'Usuário';
  const username = dados.username || 'usuario';
  
  document.getElementById('displayname').textContent = displayName;
  document.getElementById('headername').textContent = username;
  document.getElementById('view-more-username').textContent = displayName;

  const usernameEl = document.getElementById('username');
  if (usernameEl) {
    // Pronomes
    const pronomes = [];
    if (dados.about?.pronom1) pronomes.push(dados.about.pronom1);
    if (dados.about?.pronom2) pronomes.push(dados.about.pronom2);
    if (pronomes.length > 0) {
      usernameEl.innerHTML = `<span style="color:#888;font-size:0.9em;">${pronomes.join('/')}</span>`;
    } else {
      usernameEl.textContent = '@' + username;
    }
  }

  const nomeUsuarioEl = document.getElementById('nomeUsuario');
  if (nomeUsuarioEl) nomeUsuarioEl.textContent = username;

  // Bio
  const bioElement = document.getElementById('bio');
  if (bioElement) bioElement.textContent = dados.moreInfos?.bio || '';

  // Foto de perfil
  if (dados.media?.pfp) document.querySelector('.profile-pic').src = dados.media.pfp;

  // Banner
  if (dados.media?.banner) {
    document.querySelector('.profile-banner').style.backgroundImage = `url(${dados.media.banner})`;
  }

  // Verificado
  if (dados.verified) document.querySelector('.verificado').classList.add('active');

  // Música
  if (dados.likes?.music) document.getElementById('musicTitle').textContent = dados.likes.music;

  // Preencher links (tab 3 — mantida)
  carregarLinks(dados.links || []);

  // Posts e Reposts (tabs 1 e 2)
  carregarPosts();
  carregarReposts();

  // Preencher modal com todas as informações
  preencherModalInfos(dados);

  if (isOwnProfile) setupInlineEditor();
}

/* ================= PREENCHER MODAL ================= */

function preencherModalInfos(dados) {
  const el = (cls) => document.querySelector(`.${cls} span`);
  const set = (cls, value, fallback = 'Não informado') => {
    const node = el(cls);
    if (node) node.textContent = value || fallback;
  };

  // Título do modal
  const usernameModal = document.getElementById('username-modal');
  if (usernameModal) usernameModal.textContent = dados.displayName || dados.name || dados.username || 'usuário';

  // Informações básicas
  set('modal-info-nome',         dados.name);
  set('modal-info-genero',       traduzirGenero(dados.gender));
  set('modal-info-aniversario',  formatarAniversarioModal(dados.birthDate));
  set('modal-info-estado-civil', dados.about?.maritalStatus);
  set('modal-info-entrou',       formatarDataEntradaModal(dados.createdAt));
  set('modal-info-buscando',     dados.about?.searching);
  set('modal-info-localizacao',  dados.about?.location || dados.location);

  // Sobre
  set('modal-info-overview',    dados.about?.overview,    'Ainda não há nada por aqui...');
  set('modal-info-style',       dados.about?.style,       'Ainda não há nada por aqui...');
  set('modal-info-personality', dados.about?.personality, 'Ainda não há nada por aqui...');

  // Gostos
  set('modal-info-music',       dados.likes?.music,       'Ainda não há nada por aqui...');
  set('modal-info-movies',      dados.likes?.movies,      'Ainda não há nada por aqui...');
  set('modal-info-books',       dados.likes?.books,       'Ainda não há nada por aqui...');
  set('modal-info-characters',  dados.likes?.characters,  'Ainda não há nada por aqui...');
  set('modal-info-foods',       dados.likes?.foods,       'Ainda não há nada por aqui...');
  set('modal-info-hobbies',     dados.likes?.hobbies,     'Ainda não há nada por aqui...');
  set('modal-info-games',       dados.likes?.games,       'Ainda não há nada por aqui...');
  set('modal-info-others',      dados.likes?.others,      'Ainda não há nada por aqui...');
}

function formatarAniversarioModal(birthDate) {
  if (!birthDate) return null;
  try {
    const d = birthDate.toDate ? birthDate.toDate() : new Date(birthDate);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  } catch { return null; }
}

function formatarDataEntradaModal(createdAt) {
  if (!createdAt) return null;
  try {
    const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return null; }
}

/* ================= PREENCHER SEÇÕES (desativadas das tabs) ================= */

function preencherSecaoAbout(about) {
  // Renderização removida das tabs — dados agora exibidos apenas no modal
  if (currentProfileData) preencherModalInfos(currentProfileData);
}

function preencherSecaoGostos(likes) {
  // Renderização removida das tabs — dados agora exibidos apenas no modal
  if (currentProfileData) preencherModalInfos(currentProfileData);
}

function carregarLinks(links) {
  const linksContainer = document.querySelector('.links-tab .about-container');
  
  if (!links || links.length === 0) {
    linksContainer.innerHTML = `
      <div class="about-box" style="text-align: center; padding: 20px;">
      <div class="icon-area"><div class="icon-place"><i class="fas fa-link" style="font-size: 38px; color: #f8f9f9; ;"></i></div></div>
        <h3 style="color: #f8f9f9; margin-bottom: 12px;">${t('linksSection.noLinks')}</h3>
        <p style="color: #aaa;">${t('linksSection.noLinksDesc')}</p>
      </div>
    `;
    return;
  }

  const icones = {
    instagram: '<i class="fab fa-instagram"></i>',
    twitter: '<i class="fab fa-twitter"></i>',
    tiktok: '<i class="fab fa-tiktok"></i>',
    youtube: '<i class="fab fa-youtube"></i>',
    github: '<i class="fab fa-github"></i>',
    linkedin: '<i class="fab fa-linkedin"></i>',
    discord: '<i class="fab fa-discord"></i>',
    spotify: '<i class="fab fa-spotify"></i>',
    link: '<i class="fas fa-link"></i>'
  };

  const html = links.map(link => `
    <div class="about-box">
      <a href="${link.url}" target="_blank" rel="noopener noreferrer" 
         style="display: flex; align-items: center; gap: 12px; color: #f8f9f9; text-decoration: none; padding: 8px;">
        <span style="font-size: 24px;">${icones[link.type] || icones.link}</span>
        <span style="font-weight: 500;">${link.title || link.url}</span>
      </a>
    </div>
  `).join('');

  linksContainer.innerHTML = html;
}

function carregarPosts() {
  const postsContainer = document.querySelector('.visao-tab');
  if (!postsContainer) return;

  postsContainer.innerHTML = `
    <div class="about-box" style="text-align: center; padding: 20px;">
      <div class="icon-area"><div class="icon-place"><i class="fa-regular fa-camera" style="font-size: 38px; color: #f8f9f9;"></i></div></div>
      <h3 style="color: #f8f9f9; margin-bottom: 12px;">Nenhum post ainda</h3>
      <p style="color: #aaa;">Quando houver posts, eles aparecerão aqui.</p>
    </div>
  `;
}

function carregarReposts() {
  const repostsContainer = document.querySelector('.gostos-tab');
  if (!repostsContainer) return;

  repostsContainer.innerHTML = `
    <div class="about-box" style="text-align: center; padding: 20px;">
      <div class="icon-area"><div class="icon-place"><i class="fa-solid fa-repeat" style="font-size: 38px; color: #f8f9f9;"></i></div></div>
      <h3 style="color: #f8f9f9; margin-bottom: 12px;">Nenhum repost ainda</h3>
      <p style="color: #aaa;">Quando houver reposts, eles aparecerão aqui.</p>
    </div>
  `;
}


/* ================= ATUALIZAÇÕES EM TEMPO REAL ================= */

function atualizarDadosPrincipais(dados) {
  currentProfileData = { ...(currentProfileData || {}), ...dados };

  const displayName = dados.displayName || dados.name || 'Usuário';
  const username = dados.username || 'usuario';
  
  document.getElementById('displayname').textContent = displayName;
  document.getElementById('view-more-username').textContent = displayName;
  document.getElementById('headername').textContent = username;

  if (currentProfileData) preencherModalInfos(currentProfileData);
}

function atualizarMidia(media) {
  currentProfileData = {
    ...(currentProfileData || {}),
    media: {
      ...(currentProfileData?.media || {}),
      ...media
    }
  };

  if (media.pfp) {
    document.querySelector('.profile-pic').src = media.pfp;
  }
  if (media.banner) {
    document.querySelector('.profile-banner').style.backgroundImage = `url(${media.banner})`;
  }
  // aceita `color` (ex: "a2a2a2") ou `color1`
  const perfilColorRealtime = media.color || media.color1;
  if (perfilColorRealtime) {
    applySolidProfileColor(perfilColorRealtime);
  }
  if (media.color2) {
    document.documentElement.style.setProperty('--profile-color-secondary', media.color2);
    try {
      const primary = getComputedStyle(document.documentElement).getPropertyValue('--profile-color').trim();
      let secondary = String(media.color2).trim();
      if (!secondary.startsWith('#')) secondary = '#' + secondary;
      if (primary) {
        document.body.style.background = `linear-gradient(180deg, ${primary}, ${secondary})`;
      } else {
        document.body.style.background = secondary;
      }
    } catch (e) {
      console.warn('Erro ao aplicar gradiente de fundo em atualização de mídia', e);
    }
  }
}

function atualizarLikes(likes) {
  currentProfileData = {
    ...(currentProfileData || {}),
    likes: { ...(currentProfileData?.likes || {}), ...likes }
  };

  if (likes.music) document.getElementById('musicTitle').textContent = likes.music;
  if (currentProfileData) preencherModalInfos(currentProfileData);
}

function atualizarAbout(about) {
  currentProfileData = {
    ...(currentProfileData || {}),
    about: { ...(currentProfileData?.about || {}), ...about }
  };

  preencherSecaoAbout(about);

  // Pronomes
  const pronomes = [];
  if (about.pronom1) pronomes.push(about.pronom1);
  if (about.pronom2) pronomes.push(about.pronom2);
  const usernameEl = document.getElementById('username');
  if (pronomes.length > 0 && usernameEl) {
    usernameEl.innerHTML = `<span style="color:#888;font-size:0.9em;">${pronomes.join('/')}</span>`;
  }
}

function atualizarMoreInfos(moreInfos) {
  currentProfileData = {
    ...(currentProfileData || {}),
    moreInfos: {
      ...(currentProfileData?.moreInfos || {}),
      ...moreInfos
    }
  };

  // Atualizar bio
  const bioElement = document.getElementById('bio');
  if (bioElement && moreInfos.bio) {
    bioElement.textContent = moreInfos.bio;
  }
}

/* ================= INICIALIZAÇÃO ================= */

// Limpar cache antigo na inicialização
limparCacheAntigo();

// Carregar idiomas
loadLanguages();

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  
  const usernameFromURL = getUsernameFromURL();
  
  if (usernameFromURL) {
    // Carregar perfil específico da URL
    await carregarPerfilPorUsername(usernameFromURL);
  } else if (user) {
    // Usuário logado sem username na URL - redirecionar para seu perfil
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        window.location.href = `profile.html?username=${userData.username}`;
      } else {
        mostrarErro(t('errors.completeRegistration'));
      }
    } catch (error) {
      console.error("Erro ao buscar usuário:", error);
      mostrarErro(t('errors.loadError'));
    }
  } else {
    // Não logado e sem username na URL
    mostrarErro(t('errors.loginOrAccess'));
  }
});

// Exportar função de mudança de idioma para uso no HTML
window.changeLanguage = changeLanguage;