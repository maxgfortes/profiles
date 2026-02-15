import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  collection
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

/* ================= SISTEMA DE CACHE ================= */

const CACHE_KEY_PREFIX = 'profile_cache_';
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 dias em milissegundos

function salvarNoCache(username, dados) {
  try {
    const cacheData = {
      timestamp: Date.now(),
      data: dados
    };
    localStorage.setItem(CACHE_KEY_PREFIX + username.toLowerCase(), JSON.stringify(cacheData));
  } catch (error) {
    console.warn('Erro ao salvar cache:', error);
  }
}

function buscarNoCache(username) {
  try {
    const cached = localStorage.getItem(CACHE_KEY_PREFIX + username.toLowerCase());
    if (!cached) return null;

    const cacheData = JSON.parse(cached);
    const agora = Date.now();

    // Verificar se o cache ainda é válido (30 dias)
    if (agora - cacheData.timestamp > CACHE_DURATION) {
      // Cache expirado, remover
      localStorage.removeItem(CACHE_KEY_PREFIX + username.toLowerCase());
      return null;
    }

    return cacheData.data;
  } catch (error) {
    console.warn('Erro ao buscar cache:', error);
    return null;
  }
}

function limparCacheAntigo() {
  try {
    const agora = Date.now();
    const keys = Object.keys(localStorage);
    
    keys.forEach(key => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        try {
          const cacheData = JSON.parse(localStorage.getItem(key));
          if (agora - cacheData.timestamp > CACHE_DURATION) {
            localStorage.removeItem(key);
          }
        } catch (e) {
          // Se houver erro ao parsear, remover o item
          localStorage.removeItem(key);
        }
      }
    });
  } catch (error) {
    console.warn('Erro ao limpar cache antigo:', error);
  }
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
  if (!nascimento) return 'Não informada';
  const hoje = new Date();
  const nasc = nascimento.toDate ? nascimento.toDate() : new Date(nascimento);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mes = hoje.getMonth() - nasc.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nasc.getDate())) {
    idade--;
  }
  return idade + ' anos';
}

function traduzirGenero(genero) {
  const generos = {
    'masculino': 'Masculino',
    'feminino': 'Feminino',
    'outro': 'Outro',
    'prefiro_nao_dizer': 'Prefiro não dizer'
  };
  return generos[genero?.toLowerCase()] || 'Não informado';
}

function mostrarErro(mensagem) {
  document.querySelector('.full-profile-container').innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 20px;">
      <i class="fas fa-exclamation-circle" style="font-size: 64px; color: #f85149; margin-bottom: 20px;"></i>
      <h2 style="color: #f8f9f9; margin-bottom: 10px;">Ops!</h2>
      <p style="color: #aaa; text-align: center;">${mensagem}</p>
      <a href="index.html" style="margin-top: 20px; color: #4A90E2; text-decoration: none;">← Voltar para home</a>
    </div>
  `;
}

/* ================= CARREGAR DADOS DO FIRESTORE ================= */

async function carregarDadosUsuario(uid) {
  try {
    // Documento principal do usuário
    const userDoc = await getDoc(doc(db, "users", uid));
    if (!userDoc.exists()) {
      mostrarErro("Perfil não encontrado");
      return null;
    }

    const userData = userDoc.data();

    // Carregar mídia (pfp, banner, cores)
    const mediaDoc = await getDoc(doc(db, `users/${uid}/user-infos/user-media`));
    const mediaData = mediaDoc.exists() ? mediaDoc.data() : {};

    // Carregar gostos/likes
    const likesDoc = await getDoc(doc(db, `users/${uid}/user-infos/likes`));
    const likesData = likesDoc.exists() ? likesDoc.data() : {};

    // Carregar sobre
    const aboutDoc = await getDoc(doc(db, `users/${uid}/user-infos/about`));
    const aboutData = aboutDoc.exists() ? aboutDoc.data() : {};

    // Carregar more-infos (bio)
    const moreInfosDoc = await getDoc(doc(db, `users/${uid}/user-infos/more-infos`));
    const moreInfosData = moreInfosDoc.exists() ? moreInfosDoc.data() : {};

    return {
      ...userData,
      media: mediaData,
      likes: likesData,
      about: aboutData,
      moreInfos: moreInfosData
    };
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
    return null;
  }
}

async function carregarPerfilPorUsername(username) {
  try {
    // Tentar buscar no cache primeiro
    const dadosCache = buscarNoCache(username);
    
    if (dadosCache) {
      console.log('Carregando perfil do cache...');
      preencherPerfil(dadosCache);
      
      // Buscar UID para listeners em tempo real
      const usernameDoc = await getDoc(doc(db, "usernames", username.toLowerCase()));
      if (usernameDoc.exists()) {
        const uid = usernameDoc.data().uid;
        isOwnProfile = currentUser && currentUser.uid === uid;
        setupRealtimeListeners(uid);
      }
      
      // Atualizar cache em background
      atualizarCacheEmBackground(username);
      return;
    }

    // Se não há cache, carregar normalmente
    console.log('Carregando perfil do Firestore...');
    
    // Buscar UID pelo username
    const usernameDoc = await getDoc(doc(db, "usernames", username.toLowerCase()));
    
    if (!usernameDoc.exists()) {
      mostrarErro("Perfil não encontrado");
      return;
    }

    const uid = usernameDoc.data().uid;
    
    // Verificar se é o próprio perfil
    isOwnProfile = currentUser && currentUser.uid === uid;
    
    // Carregar todos os dados
    const dadosCompletos = await carregarDadosUsuario(uid);
    
    if (dadosCompletos) {
      preencherPerfil(dadosCompletos);
      
      // Salvar no cache
      salvarNoCache(username, dadosCompletos);
      
      // Listener em tempo real
      setupRealtimeListeners(uid);
    }
  } catch (error) {
    console.error("Erro ao carregar perfil:", error);
    mostrarErro("Erro ao carregar perfil");
  }
}

async function atualizarCacheEmBackground(username) {
  try {
    const usernameDoc = await getDoc(doc(db, "usernames", username.toLowerCase()));
    if (usernameDoc.exists()) {
      const uid = usernameDoc.data().uid;
      const dadosCompletos = await carregarDadosUsuario(uid);
      if (dadosCompletos) {
        salvarNoCache(username, dadosCompletos);
        console.log('Cache atualizado em background');
      }
    }
  } catch (error) {
    console.warn('Erro ao atualizar cache em background:', error);
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
  // Nome e username - usa displayName se existir, senão usa name
  const displayName = dados.displayName || dados.name || 'Usuário';
  const username = dados.username || 'usuario';
  
  document.getElementById('displayname').textContent = displayName;
  document.getElementById('headername').textContent = username; // Sempre usa username na navbar
  document.getElementById('username').textContent = '' + username;
  document.getElementById('nomeUsuario').textContent = username;

  // Bio
  const bioElement = document.getElementById('bio');
  if (bioElement) {
    bioElement.textContent = dados.moreInfos?.bio || '';
  }

  // Pronomes (ao lado do username)
  const pronomes = [];
  if (dados.about?.pronom1) pronomes.push(dados.about.pronom1);
  if (dados.about?.pronom2) pronomes.push(dados.about.pronom2);
  
  if (pronomes.length > 0) {
    const handleElement = document.getElementById('username');
    handleElement.innerHTML = `<span style="color: #888; font-size: 0.9em;">${pronomes.join('/')}</span>`;
  }

  // Foto de perfil
  if (dados.media?.pfp) {
    document.querySelector('.profile-pic').src = dados.media.pfp;
  }

  // Banner
  if (dados.media?.banner) {
    document.querySelector('.profile-banner').style.backgroundImage = `url(${dados.media.banner})`;
  }

  // Verificado
  if (dados.verified) {
    document.querySelector('.verificado').classList.add('active');
  }
  

  // Informações básicas
  document.getElementById('nomeRealUsuario').textContent = 
  dados.name || 'Não informado';

  document.getElementById('generoUsuario').textContent = 
    traduzirGenero(dados.gender) || 'Não informado';
  
  document.getElementById('estadoCivilUsuario').textContent = 
    dados.about?.maritalStatus || 'Não informado';
  
  document.getElementById('localizacaoUsuario').textContent = 
    dados.about?.location || dados.location || 'Não informada';
  
  document.getElementById('idadeUsuario').textContent = 
    calcularIdade(dados.birthDate);

  // Música
  if (dados.likes?.music) {
    document.getElementById('musicTitle').textContent = dados.likes.music;
  }


  // Preencher seção "Sobre"
  preencherSecaoAbout(dados.about || {});

  // Preencher seção "Gostos"
  preencherSecaoGostos(dados.likes || {});

  // Preencher links
  carregarLinks(dados.links || []);
}

/* ================= PREENCHER SEÇÕES ================= */

function preencherSecaoAbout(about) {
  const aboutContainer = document.querySelector('.visao-tab .about-container');
  
  const secoes = [
    { titulo: 'Buscando', campo: 'searching', key: 'searching' },
    { titulo: 'Visão geral', campo: 'overview', key: 'overview' },
    { titulo: 'Meu Estilo', campo: 'style', key: 'style' },
    { titulo: 'Minha personalidade', campo: 'personality', key: 'personality' },
  ];

  const html = secoes.map(secao => {
    const conteudo = about[secao.key] || 'Ainda não há nada por aqui...';
    return `
      <div class="about-box">
        <p class="about-title">${secao.titulo}</p>
        <p>${conteudo}</p>
      </div>
    `;
  }).join('');

  aboutContainer.innerHTML = html;
}

function preencherSecaoGostos(likes) {
  const gostosContainer = document.querySelector('.gostos-tab .about-container');
  
  const secoes = [
    { titulo: 'Músicas', key: 'music' },
    { titulo: 'Filmes e Séries', key: 'movies' },
    { titulo: 'Livros', key: 'books' },
    { titulo: 'Personagens', key: 'characters' },
    { titulo: 'Comidas e Bebidas', key: 'foods' },
    { titulo: 'Hobbies', key: 'hobbies' },
    { titulo: 'Jogos favoritos', key: 'games' },
    { titulo: 'Outros gostos', key: 'others' }
  ];

  const html = secoes.map(secao => {
    const conteudo = likes[secao.key] || 'Ainda não há nada por aqui...';
    return `
      <div class="about-box">
        <p class="about-title">${secao.titulo}</p>
        <p>${conteudo}</p>
      </div>
    `;
  }).join('');

  gostosContainer.innerHTML = html;
}

function carregarLinks(links) {
  const linksContainer = document.querySelector('.links-tab .about-container');
  
  if (!links || links.length === 0) {
    linksContainer.innerHTML = `
      <div class="about-box" style="text-align: center; padding: 20px;">
      <div class="icon-area"><div class="icon-place"><i class="fas fa-link" style="font-size: 38px; color: #f8f9f9; ;"></i></div></div>
        <h3 style="color: #f8f9f9; margin-bottom: 12px;">Nenhum link adicionado</h3>
        <p style="color: #aaa;">Este usuário ainda não adicionou links</p>
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

/* ================= ATUALIZAÇÕES EM TEMPO REAL ================= */

function atualizarDadosPrincipais(dados) {
  const displayName = dados.displayName || dados.name || 'Usuário';
  const username = dados.username || 'usuario';
  
  document.getElementById('displayname').textContent = displayName;
  document.getElementById('headername').textContent = username; // Sempre usa username na navbar
  document.getElementById('generoUsuario').textContent = traduzirGenero(dados.gender);
}

function atualizarMidia(media) {
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
  preencherSecaoGostos(likes);
  if (likes.music) {
    document.getElementById('musicTitle').textContent = likes.music;
  }
}

function atualizarAbout(about) {
  preencherSecaoAbout(about);
  
  // Atualizar localização
  if (about.location) {
    document.getElementById('localizacaoUsuario').textContent = about.location;
  }
  
  // Atualizar pronomes
  const pronomes = [];
  if (about.pronom1) pronomes.push(about.pronom1);
  if (about.pronom2) pronomes.push(about.pronom2);
  
  if (pronomes.length > 0) {
    const username = document.getElementById('username').textContent.replace('@', '').split(' ')[0];
    document.getElementById('username').innerHTML = 
      `<span style="color: #888; font-size: 0.9em;">${pronomes.join('/')}</span>`;
  }
}

function atualizarMoreInfos(moreInfos) {
  // Atualizar bio
  const bioElement = document.getElementById('bio');
  if (bioElement && moreInfos.bio) {
    bioElement.textContent = moreInfos.bio;
  }
}

/* ================= BOTÃO EDITAR ================= */


/* ================= INICIALIZAÇÃO ================= */

// Limpar cache antigo na inicialização
limparCacheAntigo();

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
        mostrarErro("Perfil não encontrado. Complete seu cadastro.");
      }
    } catch (error) {
      console.error("Erro ao buscar usuário:", error);
      mostrarErro("Erro ao carregar perfil");
    }
  } else {
    // Não logado e sem username na URL
    mostrarErro("Faça login ou acesse um perfil específico usando ?username=usuario");
  }
});