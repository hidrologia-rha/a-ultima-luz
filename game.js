'use strict';
/* =============================================================================
 * A ÚLTIMA LUZ — CRÔNICAS DA NOITE ETERNA
 * Beat 'em up de fantasia sombria em estilo 16 bits.
 * Canvas 2D (320x180 ampliado sem suavização) + Web Audio · JavaScript puro.
 * Funciona via file:// — sem módulos ES, sem fetch, sem nenhum recurso externo.
 * ========================================================================== */
(function () {

  // ===========================================================================
  // 1. CONSTANTES E UTILIDADES
  // A lógica usa coordenadas de mundo 1280x720; a imagem é desenhada em 320x180
  // (1 pixel de tela = 4 unidades de mundo) e ampliada com pixels nítidos.
  // ===========================================================================
  const W = 1280, H = 720;
  const LW = 320, LH = 180, PX = 4;
  const ARENA = { left: 95, right: 1185, top: 462, bottom: 688 };
  const FLOOR_Y = 392, FLOOR_PY = FLOOR_Y / PX;
  const STEP = 1 / 60;
  const MAX_FRAME_DT = 0.1;
  const MAX_STEPS = 5;
  const TAU = Math.PI * 2;
  const NARRATIVE_DURATION = 13;
  const CHAR_SCALE = 1.6;              // tamanho dos personagens em unidades de mundo
  const SPR = CHAR_SCALE / PX;         // escala do esqueleto dentro do sprite (pixels)
  const PAD_FAR = 8, PAD_MID = 16, PAD_FORE = 24;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randRange = r => rand(r[0], r[1]);
  const smooth = t => t * t * (3 - 2 * t);
  const easeOut = t => 1 - (1 - t) * (1 - t);
  const sign = v => (v < 0 ? -1 : 1);
  const approach = (v, target, delta) => (v < target ? Math.min(v + delta, target) : Math.max(v - delta, target));
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => BAYER4[(y & 3) * 4 + (x & 3)] / 16;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // ===========================================================================
  // 2. AJUSTES DE JOGO (centralizados para balanceamento)
  // ===========================================================================
  const PLAYER_BASE = {
    maxHp: 100, damage: 10, defense: 2, speed: 300, depthFactor: 0.62, accel: 2600, friction: 2200,
    bloodMax: 100, specialCost: 50,
    dodgeTime: 0.36, dodgeIFrames: 0.26, dodgeSpeed: 660, dodgeCooldown: 0.45,
    parryStance: 0.36, parryRecover: 0.24, parryWindow: 0.15, parryCooldown: 0.1,
    hurtIFrames: 0.6, counterWindow: 0.9, counterMult: 1.5, staggerMult: 1.35,
  };

  const BLOOD_GAIN = { kill: 8, perfectParry: 20, block: 4, evade: 3, comboMilestone: 5 };

  const UPGRADES = {
    blade: { name: 'Lâmina Afiada', desc: '+20% de dano em todos os golpes.', max: 3 },
    vigor: { name: 'Vigor Sombrio', desc: '+25 de vida máxima, +1 de defesa e cura completa.', max: 3 },
    discipline: { name: 'Disciplina de Sangue', desc: 'Aparo perfeito +0,04 s e +25% de sangue obtido.', max: 2 },
  };
  const UPGRADE_IDS = ['blade', 'vigor', 'discipline'];

  const PROGRESSION = {
    xpToNext: level => 50 + (level - 1) * 40,
    levelUpHeal: 20,
    waveClearHeal: 0.35,
    waveClearScore: 250,
  };

  function computeStats(up) {
    return {
      maxHp: PLAYER_BASE.maxHp + up.vigor * 25,
      damage: PLAYER_BASE.damage * (1 + 0.2 * up.blade),
      defense: PLAYER_BASE.defense + up.vigor,
      speed: PLAYER_BASE.speed,
      parryWindow: PLAYER_BASE.parryWindow + 0.04 * up.discipline,
      bloodGain: 1 + 0.25 * up.discipline,
    };
  }

  // Cada golpe: duração, janela ativa [início, fim], quando pode ser cancelado, alcance etc.
  const PLAYER_ATTACKS = {
    light1: { id: 'light1', poseA: 'l1a', poseB: 'l1b', dur: 0.34, active: [0.09, 0.17], cancel: 0.19, mult: 1.0, range: 108, back: 18, depth: 36, knock: 150, stun: 0.34, poise: 10, blood: 2, hitstop: 0.045, shake: 1.5, step: 55, sfx: 'light', next: 'light2' },
    light2: { id: 'light2', poseA: 'l2a', poseB: 'l2b', dur: 0.36, active: [0.09, 0.18], cancel: 0.2, mult: 1.1, range: 110, back: 18, depth: 36, knock: 160, stun: 0.36, poise: 10, blood: 2, hitstop: 0.05, shake: 1.5, step: 60, sfx: 'light', next: 'light3' },
    light3: { id: 'light3', poseA: 'l3a', poseB: 'l3b', dur: 0.54, active: [0.16, 0.26], cancel: 0.4, mult: 1.75, range: 120, back: 14, depth: 40, knock: 300, stun: 0.55, poise: 24, blood: 5, hitstop: 0.08, shake: 4, step: 85, sfx: 'heavy', next: null },
    heavy: { id: 'heavy', poseA: 'hva', poseB: 'hvb', dur: 0.74, active: [0.33, 0.45], cancel: 0.58, mult: 2.5, range: 128, back: 14, depth: 42, knock: 380, stun: 0.7, poise: 45, blood: 5, hitstop: 0.1, shake: 7, step: 90, sfx: 'heavy', next: null },
    special: { id: 'special', poseA: 'spA', poseB: 'spB', dur: 0.95, active: [0.42, 0.56], cancel: 0.8, mult: 4.0, radius: 230, depth: 110, knock: 460, stun: 0.9, poise: 90, blood: 0, hitstop: 0.12, shake: 12, step: 0, sfx: null, area: true, next: null },
  };

  const ENEMY_TYPES = {
    soldier: {
      name: 'Soldado Corrompido', look: 'soldier', hp: 42, defense: 1, speed: 135, depthSpeed: 85, radius: 22,
      windup: 0.5, active: 0.12, recovery: 0.65, cooldown: [0.8, 1.6], damage: 9, range: 84, depthTol: 30,
      knock: 170, stun: 0.3, parryable: true, lunge: 110, wind: 'wind', hit: 'hit',
      poise: 0, stunMult: 1, knockMult: 1, parryStagger: 1.2, xp: 20, score: 100, think: [0.2, 0.6], hesitate: 0.3,
    },
    executioner: {
      name: 'Carrasco', look: 'executioner', hp: 150, defense: 6, speed: 75, depthSpeed: 60, radius: 32,
      windup: 1.0, active: 0.16, recovery: 1.15, cooldown: [1.2, 2.0], damage: 22, range: 150, depthTol: 40,
      knock: 340, stun: 0.5, parryable: true, lunge: 70, wind: 'wind', hit: 'hit',
      poise: 40, stunMult: 0.6, knockMult: 0.45, parryStagger: 1.5, xp: 60, score: 350, think: [0.4, 0.9], hesitate: 0,
    },
    beast: {
      name: 'Criatura Sanguínea', look: 'beast', hp: 55, defense: 0, speed: 250, depthSpeed: 175, radius: 24,
      windup: 0.3, active: 0.14, recovery: 0.55, cooldown: [0.5, 1.1], damage: 7, range: 72, depthTol: 32,
      knock: 120, stun: 0.25, parryable: true, lunge: 380, wind: 'wind', hit: 'hit',
      poise: 0, stunMult: 1.1, knockMult: 1.2, parryStagger: 1.0, xp: 30, score: 160, think: [0.1, 0.3], hesitate: 0,
      zigzag: true, hitAndRun: true,
    },
  };

  const BOSS_DEF = {
    name: 'Cavaleiro da Noite Eterna', look: 'boss', hp: 850, defense: 8, speed: 115, depthSpeed: 80, radius: 40,
    xp: 300, score: 5000, poise: 100, specialResist: 0.6, stunMult: 1, knockMult: 0.15, think: [0.45, 0.85],
  };

  // Ataques do chefe: cada um tem uma sequência de golpes ("strikes").
  const BOSS_ATTACKS = {
    sweep: {
      kind: 'melee', recovery: 0.85, want: 150,
      strikes: [{ windup: 0.72, active: 0.16, damage: 15, range: 180, depthTol: 50, knock: 300, stun: 0.45, parryable: true, lunge: 170, wind: 'sweepW', hit: 'sweepH' }],
    },
    charge: {
      kind: 'charge', recovery: 1.15,
      strikes: [{ windup: 0.85, active: 1.0, damage: 19, range: 50, depthTol: 44, knock: 420, stun: 0.55, parryable: true, speed: 760, wind: 'chargeW', hit: 'chargeRun' }],
    },
    slam: {
      kind: 'slam', recovery: 1.25, want: 125,
      strikes: [{ windup: 1.05, active: 0.14, damage: 23, radius: 150, offset: 120, depthTol: 62, knock: 380, stun: 0.6, parryable: false, wind: 'overW', hit: 'slamH' }],
    },
    flurry: {
      kind: 'melee', recovery: 1.0, want: 150, phase2: true,
      strikes: [
        { windup: 0.5, active: 0.13, damage: 12, range: 175, depthTol: 50, knock: 160, stun: 0.35, parryable: true, lunge: 130, wind: 'sweepW', hit: 'sweepH' },
        { windup: 0.32, active: 0.13, damage: 12, range: 170, depthTol: 50, knock: 160, stun: 0.35, parryable: true, lunge: 130, wind: 'backW', hit: 'backH' },
        { windup: 0.62, active: 0.15, damage: 20, range: 190, depthTol: 54, knock: 380, stun: 0.55, parryable: false, lunge: 190, wind: 'overW', hit: 'overH' },
      ],
    },
  };
  const BOSS_PHASE_MODS = [null, { windup: 1, recovery: 1, speed: 1 }, { windup: 0.86, recovery: 0.72, speed: 1.2 }];
  const SHOCKWAVE_STRIKE = { damage: 14, knock: 260, stun: 0.4, parryable: false };

  // Os alcances acima foram pensados para personagens de tamanho 1; com sprites maiores
  // os alcances horizontais crescem na mesma proporção (a profundidade não muda).
  (function scaleRanges(k) {
    for (const id in PLAYER_ATTACKS) { const a = PLAYER_ATTACKS[id]; a.range = (a.range || 0) * k; a.back = (a.back || 0) * k; if (a.radius) a.radius *= k; a.step *= k; }
    for (const id in ENEMY_TYPES) { const e = ENEMY_TYPES[id]; e.range *= k; e.radius *= k; e.lunge *= k; }
    BOSS_DEF.radius *= k;
    for (const id in BOSS_ATTACKS) {
      const a = BOSS_ATTACKS[id];
      if (a.want) a.want *= k;
      for (const s of a.strikes) { for (const f of ['range', 'lunge', 'offset', 'radius']) if (s[f]) s[f] *= k; }
    }
  })(1.45);

  const WAVES = [
    { title: 'Onda I', subtitle: 'A Guarda Caída', maxAlive: 2, spawns: [['soldier', 0.4], ['soldier', 1.2], ['soldier', 2.5]] },
    { title: 'Onda II', subtitle: 'Fome Rubra', maxAlive: 3, spawns: [['soldier', 0.4], ['beast', 1.0], ['soldier', 2.5], ['beast', 2.5]] },
    { title: 'Onda III', subtitle: 'O Carrasco da Nave', maxAlive: 3, spawns: [['executioner', 0.4], ['soldier', 1.5], ['beast', 3.0], ['soldier', 2.0]] },
    { title: 'Encontro Final', subtitle: 'Cavaleiro da Noite Eterna', boss: true },
  ];

  const NARRATIVE = [
    'Há trezentos invernos o sol não nasce sobre o reino de Valdrenn.',
    'A Ordem da Chama Pálida caiu. Seus cavaleiros agora marcham para a Noite.',
    'Você é o último Guardião. Na Catedral Negra arde a última luz do mundo.',
    'Defenda-a — ou deixe que a escuridão termine o que começou.',
  ];

  // ===========================================================================
  // 3. FONTE BITMAP 5x7 (com acentos do português)
  // ===========================================================================
  const GLYPH_SRC = {
    A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
    C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
    E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
    G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
    I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
    K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
    M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
    O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
    Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
    S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
    U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
    W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
    Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
    0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
    2: '01110 10001 00001 00010 00100 01000 11111', 3: '11110 00001 00001 01110 00001 00001 11110',
    4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
    6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
    8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
    '.': '00000 00000 00000 00000 00000 01100 01100', ',': '00000 00000 00000 00000 01100 00100 01000',
    '!': '00100 00100 00100 00100 00100 00000 00100', '?': '01110 10001 00001 00010 00100 00000 00100',
    ':': '00000 01100 01100 00000 01100 01100 00000', '-': '00000 00000 00000 01110 00000 00000 00000',
    '+': '00000 00100 00100 11111 00100 00100 00000', '/': '00001 00010 00010 00100 01000 01000 10000',
    "'": '00100 00100 01000 00000 00000 00000 00000', '(': '00010 00100 01000 01000 01000 00100 00010',
    ')': '01000 00100 00010 00010 00010 00100 01000', '%': '11001 11010 00010 00100 01000 01011 10011',
    '·': '00000 00000 00000 01100 01100 00000 00000', '=': '00000 00000 11111 00000 11111 00000 00000',
    '▶': '01000 01100 01110 01111 01110 01100 01000', '◆': '00000 00100 01110 11111 01110 00100 00000',
    '↑': '00100 01110 10101 00100 00100 00100 00100', '↓': '00100 00100 00100 00100 10101 01110 00100',
    '←': '00000 00100 01000 11111 01000 00100 00000', '→': '00000 00100 00010 11111 00010 00100 00000',
    '✠': '00000 01010 11111 01110 11111 01010 00000',
  };
  const ACCENTS = { acute: ['00010', '00100'], grave: ['01000', '00100'], circ: ['00100', '01010'], tilde: ['01101', '10110'], ced: ['00100', '01000'] };
  const COMPOSED = {
    'Á': ['A', 'acute'], 'À': ['A', 'grave'], 'Â': ['A', 'circ'], 'Ã': ['A', 'tilde'], 'É': ['E', 'acute'], 'Ê': ['E', 'circ'],
    'Í': ['I', 'acute'], 'Ó': ['O', 'acute'], 'Ô': ['O', 'circ'], 'Õ': ['O', 'tilde'], 'Ú': ['U', 'acute'], 'Ç': ['C', 'ced'],
  };
  const NARROW = new Set(['.', ',', '!', ':', "'", '·']);

  const PF = {
    G: {}, cache: new Map(),
    init() {
      for (const ch in GLYPH_SRC) this.G[ch] = GLYPH_SRC[ch].split(' ').map(r => parseInt(r, 2));
      for (const k in ACCENTS) ACCENTS[k] = ACCENTS[k].map(r => parseInt(r, 2));
    },
    norm(text) { return String(text).toUpperCase().replace(/[—–]/g, '-').replace(/[“”"]/g, "'").replace(/…/g, '...'); },
    adv(ch) { return ch === ' ' ? 4 : NARROW.has(ch) ? 4 : 6; },
    width(text) { const t = this.norm(text); let w = 0; for (const ch of t) w += this.adv(ch); return Math.max(0, w - 1); },
    // Desenha o texto num canvas pequeno (cache). Altura 12: 2 linhas de acento, 7 de letra, 2 abaixo, 1 de sombra.
    render(text, color, shadow, grad) {
      const key = text + '|' + color + '|' + shadow + '|' + (grad ? grad.join() : '');
      let c = this.cache.get(key);
      if (c) return c;
      if (this.cache.size > 500) this.cache.clear();
      const t = this.norm(text);
      c = document.createElement('canvas');
      c.width = this.width(t) + 2; c.height = 12;
      const g = c.getContext('2d');
      const paint = (ox, oy, colFn) => {
        let x = ox;
        for (const ch of t) {
          let rows = this.G[ch], acc = null;
          if (!rows && COMPOSED[ch]) { rows = this.G[COMPOSED[ch][0]]; acc = COMPOSED[ch][1]; }
          if (rows) {
            for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (rows[r] & (16 >> b)) { g.fillStyle = colFn(r); g.fillRect(x + b, oy + 2 + r, 1, 1); }
            if (acc) {
              const a = ACCENTS[acc], ay = acc === 'ced' ? oy + 9 : oy;
              for (let r = 0; r < 2; r++) for (let b = 0; b < 5; b++) if (a[r] & (16 >> b)) { g.fillStyle = colFn(acc === 'ced' ? 6 : 0); g.fillRect(x + b, ay + r, 1, 1); }
            }
          }
          x += this.adv(ch);
        }
      };
      if (shadow) paint(1, 1, () => shadow);
      paint(0, 0, grad ? (r => grad[r < 2 ? 0 : r < 5 ? 1 : 2] || grad[grad.length - 1]) : () => color);
      this.cache.set(key, c);
      return c;
    },
    // y = topo das letras maiúsculas
    draw(ctx, text, x, y, color, align, scale, shadow) {
      const s = scale || 1;
      const c = this.render(text, color, shadow === undefined ? '#000000' : shadow, null);
      const w = (c.width - 2) * s;
      const dx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      ctx.drawImage(c, Math.round(dx), Math.round(y - 2 * s), c.width * s, c.height * s);
    },
  };
  PF.init();

  function wrapText(text, maxChars) {
    const words = String(text).split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // Converte o texto de um elemento DOM em pixel art (mantendo o texto para leitores de tela).
  function pxify(el) {
    const text = el.dataset.text != null ? el.dataset.text : el.textContent.trim().replace(/\s+/g, ' ');
    el.dataset.text = text;
    const scale = Number(el.dataset.px) || 3;
    const wrap = Number(el.dataset.wrap) || 0;
    const color = el.dataset.color || '#efe6d4';
    const grad = el.dataset.grad ? el.dataset.grad.split(',') : null;
    const shadow = el.dataset.shadow || '#05040a';
    const lines = wrap ? wrapText(text, Math.max(4, Math.floor(wrap / (6 * scale)))) : [text];
    const imgs = lines.map(l => PF.render(l, color, shadow, grad));
    const align = el.dataset.align || 'center';
    const w = Math.max(1, ...imgs.map(i => i.width)), h = lines.length * 11 + 1;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    imgs.forEach((im, i) => g.drawImage(im, align === 'center' ? Math.floor((w - im.width) / 2) : 0, i * 11));
    cv.className = 'pxt';
    cv.style.width = (w * scale) + 'px'; cv.style.height = (h * scale) + 'px';
    cv.setAttribute('aria-hidden', 'true');
    el.textContent = '';
    if (el.tagName === 'BUTTON') el.setAttribute('aria-label', text);
    else { const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = text; el.appendChild(sr); }
    el.appendChild(cv);
  }
  function setPx(el, text) { if (el.dataset.text === text && el.querySelector('canvas')) return; el.dataset.text = text; pxify(el); }

  // ===========================================================================
  // 4. POSES E VISUAL DOS PERSONAGENS
  // Ângulos dos membros: 0 = para baixo, +π/2 = para frente, π = para cima.
  // ===========================================================================
  const POSE_KEYS = ['lean', 'bob', 'fHip', 'fKnee', 'bHip', 'bKnee', 'fSh', 'fEl', 'bSh', 'bEl', 'wpn', 'head', 'fall'];
  function makePose(o) {
    const p = { lean: 0, bob: 0, fHip: 0.2, fKnee: -0.3, bHip: -0.2, bKnee: -0.2, fSh: 0.5, fEl: 0.8, bSh: -0.1, bEl: 0.4, wpn: 2.3, head: 0, fall: 0 };
    return o ? Object.assign(p, o) : p;
  }
  function copyPose(out, a) { for (let i = 0; i < POSE_KEYS.length; i++) out[POSE_KEYS[i]] = a[POSE_KEYS[i]]; return out; }
  function lerpPose(out, a, b, t) {
    for (let i = 0; i < POSE_KEYS.length; i++) { const k = POSE_KEYS[i]; out[k] = a[k] + (b[k] - a[k]) * t; }
    return out;
  }
  function walkPose(P, base, ph, amp) {
    copyPose(P, base);
    const s = Math.sin(ph);
    P.fHip = 0.05 + s * 0.5 * amp;
    P.fKnee = -0.12 - Math.max(0, Math.sin(ph - 1.2)) * 0.95 * amp;
    P.bHip = 0.05 - s * 0.5 * amp;
    P.bKnee = -0.12 - Math.max(0, Math.sin(ph + Math.PI - 1.2)) * 0.95 * amp;
    P.bSh += s * 0.35 * amp;
    P.fSh -= s * 0.12 * amp;
    P.lean += 0.06;
    P.bob -= Math.abs(Math.cos(ph)) * 1.5;
    return P;
  }
  // Ataque genérico: repouso → preparação (a) → golpe (b) → segura → repouso.
  function attackPose(out, rest, a, b, t, t0, t1, dur) {
    if (t < t0) return lerpPose(out, rest, a, easeOut(t / t0));
    if (t < t1) return lerpPose(out, a, b, easeOut((t - t0) / (t1 - t0)));
    const r = (t - t1) / Math.max(0.001, dur - t1);
    return lerpPose(out, b, rest, r < 0.45 ? 0 : smooth((r - 0.45) / 0.55));
  }

  const POSES = {
    guardian: {
      idle: makePose({ lean: 0.04, fHip: 0.22, fKnee: -0.32, bHip: -0.18, bKnee: -0.12, fSh: 0.55, fEl: 0.85, bSh: -0.1, bEl: 0.5, wpn: 2.35 }),
      l1a: makePose({ lean: -0.05, fHip: 0.3, fKnee: -0.4, bHip: -0.3, bKnee: -0.1, fSh: 2.7, fEl: 0.5, bSh: -0.4, bEl: 0.6, wpn: 3.9 }),
      l1b: makePose({ lean: 0.22, fHip: 0.55, fKnee: -0.6, bHip: -0.45, bKnee: -0.1, fSh: 1.05, fEl: 0.15, bSh: -0.7, bEl: 0.3, wpn: 0.75 }),
      l2a: makePose({ lean: 0.15, fHip: 0.45, fKnee: -0.55, bHip: -0.35, bKnee: -0.1, fSh: 0.2, fEl: 0.25, bSh: -0.3, bEl: 0.5, wpn: -0.5 }),
      l2b: makePose({ lean: 0.05, fHip: 0.35, fKnee: -0.4, bHip: -0.4, bKnee: -0.1, fSh: 2.35, fEl: 0.45, bSh: -0.8, bEl: 0.3, wpn: 3.0 }),
      l3a: makePose({ lean: -0.12, bob: -2, fHip: 0.2, fKnee: -0.2, bHip: -0.2, bKnee: -0.2, fSh: 3.05, fEl: 0.25, bSh: 2.7, bEl: 0.5, wpn: 3.7 }),
      l3b: makePose({ lean: 0.38, bob: 4, fHip: 0.8, fKnee: -0.9, bHip: -0.6, bKnee: -0.25, fSh: 1.25, fEl: 0.05, bSh: 1.1, bEl: 0.25, wpn: 1.05 }),
      hva: makePose({ lean: -0.2, bob: 3, fHip: 0.35, fKnee: -0.7, bHip: -0.45, bKnee: -0.5, fSh: 3.35, fEl: 0.35, bSh: 3.2, bEl: 0.5, wpn: 4.4 }),
      hvb: makePose({ lean: 0.45, bob: 6, fHip: 0.9, fKnee: -1.0, bHip: -0.7, bKnee: -0.2, fSh: 1.1, fEl: 0.0, bSh: 1.0, bEl: 0.15, wpn: 0.85 }),
      parry: makePose({ lean: -0.06, fHip: 0.3, fKnee: -0.45, bHip: -0.3, bKnee: -0.3, fSh: 1.1, fEl: 1.3, bSh: 1.25, bEl: 1.0, wpn: 2.95 }),
      dodge: makePose({ lean: 0.5, bob: 8, fHip: 1.0, fKnee: -1.3, bHip: -0.8, bKnee: -0.5, fSh: -0.6, fEl: 0.4, bSh: -0.9, bEl: 0.3, wpn: -0.9 }),
      dodgeBack: makePose({ lean: -0.35, bob: 6, fHip: 0.8, fKnee: -0.4, bHip: -0.6, bKnee: -0.9, fSh: 0.9, fEl: 0.7, bSh: -0.5, bEl: 0.4, wpn: 2.0 }),
      hurt: makePose({ lean: -0.35, fHip: 0.35, fKnee: -0.2, bHip: -0.25, bKnee: -0.3, fSh: -0.3, fEl: 0.6, bSh: -0.8, bEl: 0.5, wpn: 1.4, head: -0.35 }),
      spA: makePose({ lean: -0.08, bob: -4, fHip: 0.1, fKnee: -0.1, bHip: -0.1, bKnee: -0.1, fSh: 3.1, fEl: 0.0, bSh: 3.0, bEl: 0.1, wpn: 3.14, head: -0.25 }),
      spB: makePose({ lean: 0.4, bob: 12, fHip: 1.1, fKnee: -1.6, bHip: -0.8, bKnee: -0.9, fSh: 0.7, fEl: 0.15, bSh: 0.6, bEl: 0.2, wpn: 0.12, head: 0.2 }),
      dead: makePose({ lean: -0.2, fHip: 0.6, fKnee: -0.8, bHip: 0.2, bKnee: -0.6, fSh: -1.4, fEl: 0.4, bSh: -1.8, bEl: 0.3, wpn: -1.2, head: -0.4, fall: -1.45 }),
    },
    soldier: {
      idle: makePose({ lean: 0.18, fHip: 0.25, fKnee: -0.45, bHip: -0.22, bKnee: -0.3, fSh: 0.35, fEl: 0.7, bSh: 0.75, bEl: 0.9, wpn: 1.8, head: 0.12 }),
      wind: makePose({ lean: -0.08, fHip: 0.3, fKnee: -0.5, bHip: -0.35, bKnee: -0.2, fSh: 2.9, fEl: 0.45, bSh: 0.95, bEl: 1.0, wpn: 3.85, head: -0.05 }),
      hit: makePose({ lean: 0.42, fHip: 0.65, fKnee: -0.75, bHip: -0.5, bKnee: -0.1, fSh: 1.15, fEl: 0.1, bSh: 0.6, bEl: 0.8, wpn: 0.85, head: 0.2 }),
      hurt: makePose({ lean: -0.3, fHip: 0.3, fKnee: -0.2, bHip: -0.3, bKnee: -0.3, fSh: -0.3, fEl: 0.5, bSh: 0.2, bEl: 0.6, wpn: 1.0, head: -0.4 }),
      stagger: makePose({ lean: 0.55, bob: 5, fHip: 0.35, fKnee: -0.9, bHip: -0.15, bKnee: -1.0, fSh: -0.1, fEl: 0.2, bSh: 0.1, bEl: 0.3, wpn: 0.2, head: 0.6 }),
      dead: makePose({ lean: -0.25, fHip: 0.7, fKnee: -0.6, bHip: 0.3, bKnee: -0.7, fSh: -1.5, fEl: 0.3, bSh: -1.2, bEl: 0.4, wpn: -1.0, head: -0.5, fall: -1.45 }),
    },
    executioner: {
      idle: makePose({ lean: 0.1, fHip: 0.28, fKnee: -0.35, bHip: -0.25, bKnee: -0.2, fSh: 0.55, fEl: 0.55, bSh: 0.35, bEl: 0.85, wpn: 0.65, head: 0.1 }),
      wind: makePose({ lean: -0.28, bob: 2, fHip: 0.35, fKnee: -0.55, bHip: -0.4, bKnee: -0.35, fSh: 3.3, fEl: 0.3, bSh: 3.15, bEl: 0.45, wpn: 4.25, head: -0.15 }),
      hit: makePose({ lean: 0.5, bob: 8, fHip: 0.85, fKnee: -1.0, bHip: -0.65, bKnee: -0.2, fSh: 1.35, fEl: 0.0, bSh: 1.25, bEl: 0.12, wpn: 1.25, head: 0.25 }),
      hurt: makePose({ lean: -0.2, fHip: 0.3, fKnee: -0.25, bHip: -0.3, bKnee: -0.25, fSh: 0.2, fEl: 0.5, bSh: 0.0, bEl: 0.7, wpn: 0.5, head: -0.3 }),
      stagger: makePose({ lean: 0.5, bob: 6, fHip: 0.4, fKnee: -0.9, bHip: -0.2, bKnee: -1.0, fSh: 0.2, fEl: 0.2, bSh: 0.1, bEl: 0.3, wpn: 0.1, head: 0.55 }),
      dead: makePose({ lean: -0.3, fHip: 0.7, fKnee: -0.6, bHip: 0.3, bKnee: -0.7, fSh: -1.3, fEl: 0.3, bSh: -1.0, bEl: 0.4, wpn: -0.6, head: -0.5, fall: -1.45 }),
    },
    boss: {
      idle: makePose({ lean: 0.08, fHip: 0.3, fKnee: -0.4, bHip: -0.28, bKnee: -0.2, fSh: 0.75, fEl: 0.6, bSh: 0.6, bEl: 0.85, wpn: 2.25, head: 0.05 }),
      sweepW: makePose({ lean: -0.15, bob: 4, fHip: 0.45, fKnee: -0.75, bHip: -0.5, bKnee: -0.35, fSh: -1.1, fEl: 0.35, bSh: -0.95, bEl: 0.5, wpn: -1.45 }),
      sweepH: makePose({ lean: 0.35, bob: 3, fHip: 0.85, fKnee: -0.9, bHip: -0.6, bKnee: -0.1, fSh: 1.55, fEl: 0.1, bSh: 1.45, bEl: 0.2, wpn: 1.62, head: 0.1 }),
      backW: makePose({ lean: 0.3, fHip: 0.7, fKnee: -0.8, bHip: -0.5, bKnee: -0.15, fSh: 1.7, fEl: 0.2, bSh: 1.6, bEl: 0.3, wpn: 1.9 }),
      backH: makePose({ lean: -0.05, fHip: 0.5, fKnee: -0.5, bHip: -0.6, bKnee: -0.2, fSh: 2.6, fEl: 0.4, bSh: 2.5, bEl: 0.5, wpn: 3.4 }),
      overW: makePose({ lean: -0.22, bob: -3, fHip: 0.3, fKnee: -0.3, bHip: -0.35, bKnee: -0.3, fSh: 3.2, fEl: 0.2, bSh: 3.1, bEl: 0.3, wpn: 3.55, head: -0.2 }),
      overH: makePose({ lean: 0.5, bob: 12, fHip: 1.0, fKnee: -1.25, bHip: -0.75, bKnee: -0.4, fSh: 1.0, fEl: 0.08, bSh: 0.95, bEl: 0.18, wpn: 0.55, head: 0.25 }),
      slamH: makePose({ lean: 0.55, bob: 14, fHip: 1.05, fKnee: -1.35, bHip: -0.8, bKnee: -0.45, fSh: 0.75, fEl: 0.1, bSh: 0.7, bEl: 0.2, wpn: 0.12, head: 0.3 }),
      chargeW: makePose({ lean: 0.45, bob: 10, fHip: 0.9, fKnee: -1.2, bHip: -0.8, bKnee: -0.5, fSh: 1.3, fEl: 0.3, bSh: 1.2, bEl: 0.4, wpn: 1.62, head: 0.15 }),
      chargeRun: makePose({ lean: 0.5, fSh: 1.35, fEl: 0.25, bSh: 1.25, bEl: 0.35, wpn: 1.6, head: 0.15 }),
      hurt: makePose({ lean: -0.15, fHip: 0.35, fKnee: -0.35, bHip: -0.3, bKnee: -0.25, fSh: 0.6, fEl: 0.5, bSh: 0.4, bEl: 0.8, wpn: 1.9, head: -0.25 }),
      stagger: makePose({ lean: 0.6, bob: 9, fHip: 0.4, fKnee: -1.0, bHip: -0.2, bKnee: -1.1, fSh: 0.6, fEl: 0.2, bSh: 0.5, bEl: 0.3, wpn: 0.45, head: 0.55 }),
      roar: makePose({ lean: -0.3, fHip: 0.5, fKnee: -0.4, bHip: -0.5, bKnee: -0.3, fSh: 2.3, fEl: -0.1, bSh: -2.2, bEl: 0.2, wpn: 2.9, head: -0.55 }),
      kneel: makePose({ lean: 0.4, fHip: 1.5, fKnee: -1.6, bHip: -0.1, bKnee: -2.2, fSh: 0.4, fEl: 0.2, bSh: 0.3, bEl: 0.3, wpn: 0.1, head: 0.6 }),
      dead: makePose({ lean: 0.4, fHip: 1.5, fKnee: -1.6, bHip: -0.1, bKnee: -2.2, fSh: 1.6, fEl: 0.2, bSh: 1.4, bEl: 0.3, wpn: 1.4, head: 0.4, fall: 1.35 }),
    },
  };

  // Paletas por personagem: cores saturadas e em degraus, como sprites de 16 bits.
  const LOOKS = {
    guardian: {
      scale: 1, thigh: 25, shin: 25, torso: 42, upper: 20, fore: 20, shoulderW: 15, waistW: 10, headR: 10.5, limbW: 9, armW: 8, pauldron: 10,
      outline: '#0b0a14', torsoCol: '#3d4260', armor: '#3d4260', armorHi: '#9aa3c8', leg: '#33374f', legDk: '#22243a', arm: '#454b6b', armDk: '#2a2d44',
      boot: '#2a1c1c', bootDk: '#1a1212', belt: '#5a3a22', cloth: '#a8182a', clothHi: '#e0384a', accent: '#c8203a', capeCol: '#5a0e1e', capeLen: 70,
      eye: '#e8f4ff', helm: 'guardian', weapon: 'longsword', wlen: 70, cape: true, tabard: true, tabardLen: 30, emblem: 'cross', kneePlate: true,
      sprite: [150, 92],
    },
    soldier: {
      scale: 0.96, thigh: 24, shin: 24, torso: 40, upper: 19, fore: 19, shoulderW: 14, waistW: 10, headR: 10, limbW: 8.5, armW: 7.5, pauldron: 8,
      outline: '#0c0806', torsoCol: '#6a5a44', armor: '#6a5a44', armorHi: '#b49a70', leg: '#4e4232', legDk: '#342c22', arm: '#5e5040', armDk: '#3c3228',
      boot: '#2c2018', bootDk: '#1c1410', belt: '#3a2a1a', cloth: '#56603a', clothHi: '#7c8a50', accent: '#7a1a12', eye: '#ff4020',
      helm: 'kettle', weapon: 'shortsword', wlen: 50, tabard: true, tabardLen: 24, shield: true,
      sprite: [130, 84],
    },
    executioner: {
      scale: 1.3, thigh: 25, shin: 23, torso: 44, upper: 21, fore: 20, shoulderW: 19, waistW: 15, headR: 10.5, limbW: 11, armW: 10, pauldron: 0,
      outline: '#0c0605', torsoCol: '#a4705a', armor: '#4a3a30', armorHi: '#dca084', leg: '#3a2a22', legDk: '#24180f', arm: '#a4705a', armDk: '#7a5040',
      boot: '#22160f', bootDk: '#140c08', belt: '#3a2214', cloth: '#5a1a14', clothHi: '#8a2a1e', accent: '#8a2a1e', eye: '#ff8030',
      helm: 'hood', weapon: 'axe', wlen: 92, tabard: true, tabardLen: 36, bare: true,
      sprite: [200, 136],
    },
    boss: {
      scale: 1.45, thigh: 26, shin: 26, torso: 46, upper: 22, fore: 21, shoulderW: 18, waistW: 12, headR: 11, limbW: 10, armW: 9, pauldron: 13,
      outline: '#06060c', torsoCol: '#2a2c40', armor: '#2a2c40', armorHi: '#8a90b8', leg: '#24263a', legDk: '#16172a', arm: '#2e3048', armDk: '#1c1d30',
      boot: '#181826', bootDk: '#0e0e18', belt: '#5a4020', cloth: '#7a0c1a', clothHi: '#b8182c', accent: '#e02030', gold: '#c8a050', capeCol: '#4a0610', capeLen: 84,
      eye: '#ff3030', helm: 'crowned', weapon: 'greatsword', wlen: 112, cape: true, tabard: true, tabardLen: 38, emblem: 'gem', spikes: true, kneePlate: true,
      sprite: [250, 172],
    },
    beast: {
      scale: 1.1, beast: true, outline: '#100204', body: '#6a1420', bodyHi: '#b02a36', bodyDk: '#360810', spike: '#22080c', claw: '#efe4cc', eye: '#ffd040',
      sprite: [140, 64],
    },
  };
  const WEAPON_PAL = {
    longsword: ['#3a2418', '#c8a060', '#8a8aa0', '#dfe4f0', '#3a3c48', '#9aa0b4', '#ffffff'],
    shortsword: ['#2e2016', '#5a4c40', '#9a8e7c', '#7a3a18'],
    axe: ['#5e4028', '#2e1e14', '#6e6a66', '#d8d0c4', '#8a1018', '#46423e'],
    greatsword: ['#221414', '#c8a050', '#44465a', '#0c0c14', '#b8bcd4', '#ff3a3a', '#e01e2a'],
  };
  const EXTRA_PAL = ['#ffffff', '#7a0e1a', '#241c18', '#08050a', '#4a3a2a', '#7a6248', '#9a8460', '#3a2214', '#ff3040'];

  // ===========================================================================
  // 5. DESENHO DO ESQUELETO DOS PERSONAGENS (depois convertido em pixel art)
  // ===========================================================================
  const J = { kx: 0, ky: 0, ex: 0, ey: 0 };
  function limbPoints(x, y, a1, l1, a2, l2) {
    J.kx = x + Math.sin(a1) * l1; J.ky = y + Math.cos(a1) * l1;
    const b = a1 + a2;
    J.ex = J.kx + Math.sin(b) * l2; J.ey = J.ky + Math.cos(b) * l2;
    return J;
  }
  function seg(ctx, x1, y1, x2, y2, w, col) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
  }
  function disc(ctx, x, y, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1.5; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawLeg(ctx, L, x, y, hip, knee, far) {
    limbPoints(x, y, hip, L.thigh, knee, L.shin);
    const kx = J.kx, ky = J.ky, ex = J.ex, ey = J.ey;
    const col = far ? L.legDk : L.leg;
    seg(ctx, x, y, kx, ky, L.limbW + 1, col);
    seg(ctx, kx, ky, ex, ey, L.limbW - 1, col);
    if (!far) seg(ctx, x + 2, y + 2, kx + 2, ky, 2.5, far ? L.legDk : L.armorHi);
    if (L.kneePlate) disc(ctx, kx + 1, ky, 4.2, far ? L.armDk : L.armorHi);
    ctx.beginPath(); ctx.ellipse(ex + 4, ey - 2, 9, 4.5, 0, 0, TAU);
    ctx.fillStyle = far ? L.bootDk : L.boot; ctx.fill();
  }

  function drawArm(ctx, L, sx, sy, sh, el, far) {
    limbPoints(sx, sy, sh, L.upper, el, L.fore);
    const kx = J.kx, ky = J.ky, ex = J.ex, ey = J.ey;
    const col = far ? L.armDk : L.arm;
    seg(ctx, sx, sy, kx, ky, L.armW + 1, col);
    seg(ctx, kx, ky, ex, ey, L.armW, col);
    if (L.bare) seg(ctx, lerp(kx, ex, 0.5), lerp(ky, ey, 0.5), lerp(kx, ex, 0.8), lerp(ky, ey, 0.8), L.armW + 1, '#3a2214');
    disc(ctx, ex, ey, L.armW * 0.62, far ? L.armDk : L.armorHi);
    J.ex = ex; J.ey = ey;
  }

  function drawShield(ctx, L, x, y) {
    disc(ctx, x + 3, y, 16, '#4a3a2a');
    disc(ctx, x + 3, y, 11, null, '#7a6248', 3);
    disc(ctx, x + 3, y, 4.5, '#9a8460');
  }

  function drawTorso(ctx, L, o) {
    const T = L.torso, sw = L.shoulderW, ww = L.waistW;
    ctx.beginPath();
    ctx.moveTo(-ww, 2);
    ctx.lineTo(-sw - 1, -T + 8);
    ctx.quadraticCurveTo(-sw + 2, -T - 3, 2, -T - 3);
    ctx.quadraticCurveTo(sw + 3, -T - 2, sw + 2, -T + 10);
    ctx.quadraticCurveTo(sw + 1, -T * 0.45, ww + 2, 2);
    ctx.closePath();
    ctx.fillStyle = L.torsoCol; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = L.armDk; ctx.fillRect(-sw - 4, -T - 6, sw * 0.7, T + 12);       // lado na sombra
    if (L.bare) {
      ctx.fillStyle = L.armorHi; ctx.fillRect(sw * 0.2, -T * 0.85, sw * 0.6, T * 0.3); // peitoral iluminado
      ctx.strokeStyle = '#3a2214'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-sw, -T + 4); ctx.lineTo(ww + 2, -6); ctx.stroke();
    } else {
      ctx.fillStyle = L.armorHi; ctx.fillRect(sw * 0.35, -T + 4, sw * 0.45, T * 0.42);  // reflexo da couraça
      ctx.fillStyle = L.armDk; ctx.fillRect(-sw, -T * 0.32, sw * 2 + 4, 3);
    }
    ctx.restore();
    if (L.emblem === 'cross') {
      ctx.fillStyle = L.accent;
      ctx.fillRect(sw * 0.05, -T * 0.8, 4, 15); ctx.fillRect(sw * 0.05 - 4, -T * 0.7, 12, 4);
    } else if (L.emblem === 'gem') {
      const gx = sw * 0.3, gy = -T * 0.62;
      ctx.beginPath(); ctx.moveTo(gx, gy - 7); ctx.lineTo(gx + 6, gy); ctx.lineTo(gx, gy + 7); ctx.lineTo(gx - 6, gy); ctx.closePath();
      ctx.fillStyle = Math.sin(o.time * 4) > 0 ? '#ff3a3a' : L.accent; ctx.fill();
      ctx.strokeStyle = L.gold; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-sw + 2, -T + 6); ctx.quadraticCurveTo(0, -T + 13, sw, -T + 7); ctx.stroke();
    }
    ctx.fillStyle = L.belt; ctx.fillRect(-ww - 2, -6, ww * 2 + 5, 7);
    ctx.fillStyle = L.gold || '#c8a060'; ctx.fillRect(ww * 0.3, -5, 5, 5);
    if (L.pauldron > 0) {
      ctx.beginPath(); ctx.ellipse(4, -T + 5, L.pauldron, L.pauldron * 0.78, -0.3, 0, TAU);
      ctx.fillStyle = L.armor; ctx.fill();
      ctx.beginPath(); ctx.ellipse(6, -T + 2, L.pauldron * 0.55, L.pauldron * 0.35, -0.3, 0, TAU);
      ctx.fillStyle = L.armorHi; ctx.fill();
      if (L.spikes) {
        ctx.fillStyle = L.armorHi;
        for (let i = 0; i < 3; i++) {
          const ax = -3 + i * 7, ay = -T - 1 - i * 0.5;
          ctx.beginPath(); ctx.moveTo(ax - 3, ay + 2); ctx.lineTo(ax - 1 + i, ay - 11 + i * 1.5); ctx.lineTo(ax + 3, ay + 2); ctx.closePath(); ctx.fill();
        }
      }
    }
  }

  function drawTabard(ctx, L, P, o) {
    const ww = L.waistW, len = L.tabardLen;
    const sway = Math.round(Math.sin(o.time * 4 + 1) * 2 - P.lean * 8 - o.capeFlow * 4);
    ctx.beginPath();
    ctx.moveTo(-ww * 0.5, 0); ctx.lineTo(ww * 0.95, 0);
    ctx.lineTo(ww * 0.95 + sway * 0.5, len * 0.7);
    ctx.lineTo(ww * 0.45 + sway, len);
    ctx.lineTo(ww * 0.05 + sway, len * 0.82);
    ctx.lineTo(-ww * 0.4 + sway, len * 0.95);
    ctx.closePath();
    ctx.fillStyle = L.cloth; ctx.fill();
    seg(ctx, ww * 0.45, 2, ww * 0.45 + sway * 0.8, len * 0.8, 4, L.clothHi);
  }

  function drawCape(ctx, L, P, hipY, o) {
    const T = L.torso, len = L.capeLen, flow = o.capeFlow, t = o.time;
    ctx.save(); ctx.translate(0, hipY); ctx.rotate(P.lean * 0.6);
    const top = -T + 2;
    const bx = -16 - flow * 24 + Math.sin(t * 2.6) * 3, by = top + len - Math.abs(flow) * 10;
    ctx.beginPath();
    ctx.moveTo(6, top);
    ctx.quadraticCurveTo(-6, top - 3, -11, top + 8);
    ctx.quadraticCurveTo(-17 - flow * 12, top + len * 0.5, bx - 6, by);
    for (let i = 1; i <= 5; i++) {
      const u = i / 5;
      ctx.lineTo(lerp(bx - 6, 6, u), by - u * 14 + ((i % 2) ? 8 : -3));
    }
    ctx.quadraticCurveTo(9, top + len * 0.4, 6, top);
    ctx.closePath();
    ctx.fillStyle = L.capeCol; ctx.fill();
    ctx.strokeStyle = L.cloth; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, top + 6); ctx.quadraticCurveTo(-12 - flow * 8, top + len * 0.5, bx + 2, by - 6); ctx.stroke();
    ctx.restore();
  }

  function drawHead(ctx, L, o) {
    const r = L.headR;
    switch (L.helm) {
      case 'guardian': {
        const sw = Math.sin(o.time * 4) * 2;
        ctx.fillStyle = L.cloth;
        ctx.beginPath(); ctx.moveTo(-4, 1); ctx.quadraticCurveTo(-14, 5 + sw, -26 - o.capeFlow * 10, 10 + sw); ctx.lineTo(-18, 2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.quadraticCurveTo(-r - 1, -r * 2.15, 1, -r * 2.15);
        ctx.quadraticCurveTo(r + 2.5, -r * 2.05, r + 2, -r * 0.6); ctx.lineTo(r + 1, 1); ctx.closePath();
        ctx.fillStyle = L.armor; ctx.fill();
        ctx.fillStyle = L.armorHi; ctx.fillRect(r * 0.1, -r * 2.0, r * 0.9, r * 0.6);
        ctx.fillStyle = '#05050a'; ctx.fillRect(r * 0.15, -r * 1.25, r + 2, 4);            // visor
        ctx.fillStyle = L.eye; ctx.fillRect(r * 0.55, -r * 1.2, r * 0.6, 2.6);              // brilho frio
        ctx.fillStyle = L.accent;
        ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 2.05); ctx.quadraticCurveTo(-r * 1.8, -r * 2.5 + sw, -r * 2.8, -r * 1.5 + sw); ctx.lineTo(-r * 1.2, -r * 1.7); ctx.closePath(); ctx.fill();
        break;
      }
      case 'kettle': {
        ctx.beginPath(); ctx.ellipse(1, -r * 0.9, r * 0.85, r * 1.0, 0, 0, TAU); ctx.fillStyle = '#241c18'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(1, -r * 1.35, r * 1.8, r * 0.42, -0.08, 0, TAU); ctx.fillStyle = L.armor; ctx.fill();
        ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 1.4); ctx.quadraticCurveTo(0, -r * 2.7, r * 0.95, -r * 1.45); ctx.closePath(); ctx.fillStyle = L.armor; ctx.fill();
        ctx.fillStyle = L.armorHi; ctx.fillRect(-r * 0.2, -r * 2.05, r * 0.8, r * 0.4);
        ctx.fillStyle = L.eye; ctx.fillRect(r * 0.35, -r * 1.0, 3, 3); ctx.fillRect(-r * 0.2, -r * 1.0, 2.5, 3);
        break;
      }
      case 'hood': {
        ctx.beginPath(); ctx.moveTo(-r * 1.1, 2); ctx.quadraticCurveTo(-r * 1.4, -r * 1.6, -r * 0.5, -r * 2.7);
        ctx.quadraticCurveTo(r * 0.6, -r * 2.3, r * 1.25, -r * 1.0); ctx.lineTo(r * 1.1, 2); ctx.closePath();
        ctx.fillStyle = L.cloth; ctx.fill();
        ctx.fillStyle = L.clothHi; ctx.fillRect(-r * 0.3, -r * 2.3, r * 0.6, r * 0.9);
        ctx.beginPath(); ctx.ellipse(r * 0.45, -r * 0.95, r * 0.62, r * 0.78, 0, 0, TAU); ctx.fillStyle = '#08050a'; ctx.fill();
        ctx.fillStyle = L.eye; ctx.fillRect(r * 0.6, -r * 1.2, 3, 3); ctx.fillRect(r * 0.05, -r * 1.2, 2.5, 3);
        break;
      }
      case 'crowned': {
        ctx.fillStyle = L.armorHi;
        ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 1.7); ctx.quadraticCurveTo(-r * 2.2, -r * 2.2, -r * 2.0, -r * 3.6); ctx.quadraticCurveTo(-r * 1.4, -r * 2.5, -r * 0.2, -r * 2.0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-r, 1); ctx.lineTo(-r * 1.05, -r * 1.7); ctx.quadraticCurveTo(0, -r * 2.35, r * 1.15, -r * 1.75);
        ctx.lineTo(r * 1.25, -r * 0.2); ctx.lineTo(r * 0.6, 2); ctx.closePath();
        ctx.fillStyle = L.armor; ctx.fill();
        ctx.fillStyle = L.gold;
        for (let i = 0; i < 4; i++) {
          const cx = -r * 0.8 + i * r * 0.6;
          ctx.beginPath(); ctx.moveTo(cx - 3, -r * 1.95 + i * 0.6); ctx.lineTo(cx, -r * 3.0 + (i % 2) * 3); ctx.lineTo(cx + 3, -r * 1.95 + i * 0.6); ctx.closePath(); ctx.fill();
        }
        ctx.fillRect(-r, -r * 1.85, r * 2.2, 3);
        ctx.fillStyle = '#05050a'; ctx.fillRect(-r * 0.1, -r * 1.25, r * 1.35, 4.5);
        ctx.fillStyle = L.eye; ctx.fillRect(r * 0.2, -r * 1.2, r * 0.95, 3);
        break;
      }
    }
  }

  function drawWeapon(ctx, L, hx, hy, ang, o) {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(-ang); // a lâmina passa a apontar para +y
    const len = L.wlen;
    switch (L.weapon) {
      case 'longsword': {
        ctx.fillStyle = '#3a2418'; ctx.fillRect(-2.5, -12, 5, 14);
        disc(ctx, 0, -13, 3.5, '#c8a060');
        ctx.fillStyle = '#c8a060'; ctx.fillRect(-10, 2, 20, 5);
        ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(-3.4, len - 10); ctx.lineTo(0, len); ctx.lineTo(3.4, len - 10); ctx.lineTo(4, 6); ctx.closePath();
        ctx.fillStyle = '#9aa0b4'; ctx.fill();
        ctx.fillStyle = '#dfe4f0'; ctx.fillRect(0, 8, 3, len - 20);
        break;
      }
      case 'shortsword': {
        ctx.fillStyle = '#2e2016'; ctx.fillRect(-2.5, -9, 5, 11);
        ctx.fillStyle = '#5a4c40'; ctx.fillRect(-8, 2, 16, 4.5);
        ctx.beginPath(); ctx.moveTo(-4, 5); ctx.lineTo(-4, len * 0.45); ctx.lineTo(-2, len * 0.5); ctx.lineTo(-4, len * 0.6);
        ctx.lineTo(-3, len - 6); ctx.lineTo(0, len); ctx.lineTo(3.5, len - 8); ctx.lineTo(4, 5); ctx.closePath();
        ctx.fillStyle = '#9a8e7c'; ctx.fill();
        ctx.fillStyle = '#7a3a18'; ctx.fillRect(-2, len * 0.3, 4, 7);
        break;
      }
      case 'axe': {
        ctx.fillStyle = '#5e4028'; ctx.fillRect(-3, -22, 6, len + 22);
        ctx.fillStyle = '#2e1e14'; ctx.fillRect(-3.5, -4, 7, 5); ctx.fillRect(-3.5, 14, 7, 5);
        ctx.beginPath(); ctx.moveTo(-2, len - 32); ctx.quadraticCurveTo(-34, len - 40, -40, len - 12);
        ctx.quadraticCurveTo(-30, len + 10, -2, len + 2); ctx.closePath();
        ctx.fillStyle = '#6e6a66'; ctx.fill();
        ctx.strokeStyle = '#d8d0c4'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-36, len - 30); ctx.quadraticCurveTo(-43, len - 12, -32, len + 4); ctx.stroke();
        ctx.fillStyle = '#8a1018'; ctx.fillRect(-28, len - 14, 9, 8);
        ctx.fillStyle = '#46423e'; ctx.beginPath(); ctx.moveTo(2, len - 22); ctx.lineTo(15, len - 14); ctx.lineTo(2, len - 8); ctx.closePath(); ctx.fill();
        break;
      }
      case 'greatsword': {
        ctx.fillStyle = '#221414'; ctx.fillRect(-3, -24, 6, 26);
        disc(ctx, 0, -26, 5, L.gold);
        ctx.beginPath(); ctx.moveTo(-17, 3); ctx.quadraticCurveTo(-20, -4, -14, -5); ctx.lineTo(14, -5); ctx.quadraticCurveTo(20, -4, 17, 3); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.closePath();
        ctx.fillStyle = L.gold; ctx.fill();
        ctx.beginPath(); ctx.moveTo(-7, 6); ctx.lineTo(-6, len - 16); ctx.lineTo(0, len); ctx.lineTo(6, len - 16); ctx.lineTo(7, 6); ctx.closePath();
        ctx.fillStyle = '#44465a'; ctx.fill();
        ctx.fillStyle = '#b8bcd4'; ctx.fillRect(3, 10, 3, len - 28);
        const lit = o.wGlow > 0.5 && Math.sin(o.time * 8) > -0.3;
        ctx.fillStyle = lit ? '#ff3a3a' : '#e01e2a';
        for (let i = 0; i < 5; i++) ctx.fillRect(-2, 16 + i * ((len - 40) / 5), 4, 8);
        break;
      }
    }
    if (o.wGlow > 0 && L.weapon === 'longsword') {
      ctx.fillStyle = '#ff3040'; ctx.fillRect(-1.5, 8, 3, len - 12);
    }
    ctx.restore();
  }

  // Desenha um humanoide inteiro a partir de uma pose; grava em o.out a posição da arma (em pixels do sprite).
  function drawHumanoid(ctx, L, P, x, y, facing, o) {
    const s = L.scale * o.ds;
    const fs = facing < 0 ? -1 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(fs * s, s);
    const fallK = P.fall;
    if (fallK) { ctx.translate(0, -Math.abs(fallK) * 7); ctx.rotate(fallK); }
    const extF = Math.cos(P.fHip) * L.thigh + Math.cos(P.fHip + P.fKnee) * L.shin;
    const extB = Math.cos(P.bHip) * L.thigh + Math.cos(P.bHip + P.bKnee) * L.shin;
    const hipY = -Math.max(extF, extB, 10) + P.bob;
    const T = L.torso;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (L.cape) drawCape(ctx, L, P, hipY, o);

    ctx.save(); ctx.translate(0, hipY); ctx.rotate(P.lean);
    drawArm(ctx, L, -3, -T + 4, P.bSh, P.bEl, true);
    if (L.shield) drawShield(ctx, L, J.ex, J.ey);
    ctx.restore();

    drawLeg(ctx, L, -3, hipY, P.bHip, P.bKnee, true);

    ctx.save(); ctx.translate(0, hipY); ctx.rotate(P.lean);
    drawTorso(ctx, L, o);
    ctx.restore();

    drawLeg(ctx, L, 3, hipY, P.fHip, P.fKnee, false);

    ctx.save(); ctx.translate(0, hipY); ctx.rotate(P.lean);
    if (L.tabard) drawTabard(ctx, L, P, o);
    ctx.save(); ctx.translate(2, -T - 2); ctx.rotate(P.head); drawHead(ctx, L, o); ctx.restore();
    drawArm(ctx, L, 4, -T + 5, P.fSh, P.fEl, false);
    const hx = J.ex, hy = J.ey;
    drawWeapon(ctx, L, hx, hy, P.wpn, o);
    disc(ctx, hx, hy, L.armW * 0.62, L.armorHi);
    ctx.restore();
    ctx.restore();

    if (o.out) {
      const cl = Math.cos(P.lean), sl = Math.sin(P.lean);
      const sw = Math.sin(P.wpn), cw = Math.cos(P.wpn);
      const out = o.out;
      const pts = [hx, hy, hx + sw * L.wlen * 0.4, hy + cw * L.wlen * 0.4, hx + sw * L.wlen, hy + cw * L.wlen];
      for (let i = 0; i < 3; i++) {
        const px = pts[i * 2], py = pts[i * 2 + 1];
        let lx = px * cl - py * sl, ly = px * sl + py * cl + hipY;
        if (fallK) {
          const cf = Math.cos(fallK), sf = Math.sin(fallK);
          const rx = lx * cf - ly * sf, ry = lx * sf + ly * cf;
          lx = rx; ly = ry - Math.abs(fallK) * 7;
        }
        const wx = x + fs * s * lx, wy = y + s * ly;
        if (i === 0) { out.handX = wx; out.handY = wy; } else if (i === 1) { out.midX = wx; out.midY = wy; } else { out.tipX = wx; out.tipY = wy; }
      }
    }
  }

  function drawBeast(ctx, L, e, x, y, facing, o) {
    const s = L.scale * o.ds, b = e.bk, t = o.time;
    const fs = facing < 0 ? -1 : 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(fs * s, s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const ph = e.walkPhase, len = 1 + b.stretch * 0.25;
    const bodyY = -34 + b.crouch * 10 + b.dead * 20 + Math.sin(ph * 2) * 1.5 * b.moving * (1 - b.dead);
    ctx.beginPath(); ctx.moveTo(-30 * len, bodyY - 2);
    ctx.quadraticCurveTo(-52 * len, bodyY - 18 + Math.sin(t * 4) * 6, -68 * len, bodyY - 4 + Math.sin(t * 4 + 1) * 8);
    ctx.lineWidth = 6; ctx.strokeStyle = L.bodyDk; ctx.stroke();
    const leg = (lx, ly, p, far) => {
      const swing = Math.sin(p) * 0.65 * b.moving;
      const a1 = 0.25 + swing + b.dead * 0.9 - b.stretch * 0.4;
      const a2 = -0.9 + Math.max(0, Math.cos(p)) * 0.6 * b.moving - b.dead * 0.6;
      limbPoints(lx, ly, a1, 17, a2, 19);
      const kx = J.kx, ky = J.ky, ex = J.ex, ey = J.ey;
      seg(ctx, lx, ly, kx, ky, 8, far ? L.bodyDk : L.body);
      seg(ctx, kx, ky, ex, ey, 5.5, far ? L.bodyDk : L.body);
      seg(ctx, ex, ey, ex + 8, ey + 1, 3, L.claw);
    };
    leg(-20 * len, bodyY + 6, ph + Math.PI, true);
    leg(18 * len, bodyY + 4, ph + 0.6, true);
    ctx.beginPath();
    ctx.moveTo(-34 * len, bodyY);
    ctx.quadraticCurveTo(-30 * len, bodyY - 26, -6 * len, bodyY - 22 + b.crouch * 3);
    ctx.quadraticCurveTo(18 * len, bodyY - 27, 33 * len, bodyY - 10);
    ctx.quadraticCurveTo(37 * len, bodyY + 6, 20 * len, bodyY + 12);
    ctx.quadraticCurveTo(-4 * len, bodyY + 18, -30 * len, bodyY + 10);
    ctx.closePath();
    ctx.fillStyle = L.body; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = L.bodyDk; ctx.fillRect(-40 * len, bodyY + 4, 80 * len, 20);
    ctx.fillStyle = L.bodyHi;
    for (let i = 0; i < 4; i++) ctx.fillRect((-16 + i * 9) * len, bodyY - 16, 3, 12);
    ctx.restore();
    ctx.fillStyle = L.spike;
    for (let i = 0; i < 6; i++) {
      const sx = (-26 + i * 10) * len, sy = bodyY - 20 - Math.sin(i * 0.9) * 4;
      ctx.beginPath(); ctx.moveTo(sx - 4, sy + 3); ctx.lineTo(sx - 6, sy - 10 - (i % 2) * 4); ctx.lineTo(sx + 4, sy + 2); ctx.closePath(); ctx.fill();
    }
    leg(-16 * len, bodyY + 8, ph, false);
    leg(22 * len, bodyY + 6, ph + Math.PI + 0.6, false);
    const hx = 36 * len + b.stretch * 6, hy = bodyY - 8 + b.crouch * 6;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(0.15 + b.crouch * 0.25 - b.jaw * 0.1 + b.dead * 0.5);
    ctx.save(); ctx.translate(-2, 3); ctx.rotate(b.jaw * 0.65);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(23, 1); ctx.lineTo(18, 7); ctx.lineTo(0, 7); ctx.closePath();
    ctx.fillStyle = L.bodyDk; ctx.fill();
    ctx.fillStyle = L.claw; for (let i = 0; i < 3; i++) ctx.fillRect(6 + i * 5, -2, 3, 4);
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(-6, -9); ctx.quadraticCurveTo(10, -16, 26, -4); ctx.lineTo(22, 1); ctx.lineTo(-4, 4); ctx.closePath();
    ctx.fillStyle = L.body; ctx.fill();
    ctx.fillStyle = L.claw; for (let i = 0; i < 3; i++) ctx.fillRect(7 + i * 5, 0, 3, 4);
    if (b.dead < 0.9) { ctx.fillStyle = L.eye; ctx.fillRect(9, -9, 5, 4); }
    ctx.restore();
    ctx.restore();
    if (o.out) {
      o.out.tipX = x + fs * s * (hx + 24); o.out.tipY = y + s * hy;
      o.out.handX = o.out.midX = x + fs * s * hx; o.out.handY = o.out.midY = y + s * hy;
    }
  }

  // ===========================================================================
  // 6. PIXELIZAÇÃO — transforma o desenho do esqueleto em sprite de 16 bits:
  // alfa binário, cores presas à paleta do personagem e contorno de 1 pixel.
  // ===========================================================================
  class SpritePalette {
    constructor(hexes) {
      this.cols = Array.from(new Set(hexes.map(h => h.toLowerCase()))).map(hexRgb);
      this.cache = new Map();
    }
    nearest(r, g, b) {
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let c = this.cache.get(key);
      if (c) return c;
      let best = this.cols[0], bd = Infinity;
      for (let i = 0; i < this.cols.length; i++) {
        const q = this.cols[i], dr = q[0] - r, dg = q[1] - g, db = q[2] - b;
        const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (d < bd) { bd = d; best = q; }
      }
      this.cache.set(key, best);
      return best;
    }
  }
  const PALETTES = {};
  function paletteFor(key) {
    if (PALETTES[key]) return PALETTES[key];
    const L = LOOKS[key], hexes = EXTRA_PAL.slice();
    for (const k in L) if (typeof L[k] === 'string' && L[k][0] === '#') hexes.push(L[k]);
    if (L.weapon) hexes.push(...WEAPON_PAL[L.weapon]);
    return (PALETTES[key] = new SpritePalette(hexes));
  }
  let maskBuf = new Uint8Array(0);
  const FLASH_RGB = [255, 248, 236];
  function pixelize(cv, sctx, pal, outlineHex, flash) {
    const w = cv.width, h = cv.height;
    const img = sctx.getImageData(0, 0, w, h), d = img.data;
    if (maskBuf.length < w * h) maskBuf = new Uint8Array(w * h);
    const m = maskBuf;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (d[i + 3] < 120) { d[i + 3] = 0; m[p] = 0; continue; }
      const c = flash ? FLASH_RGB : pal.nearest(d[i], d[i + 1], d[i + 2]);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; m[p] = 1;
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX >= 0) {
      const o = flash ? [180, 40, 50] : hexRgb(outlineHex);
      const x0 = Math.max(0, minX - 1), x1 = Math.min(w - 1, maxX + 1), y0 = Math.max(0, minY - 1), y1 = Math.min(h - 1, maxY + 1);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = y * w + x;
          if (m[p] === 1) continue;
          if ((x > 0 && m[p - 1] === 1) || (x < w - 1 && m[p + 1] === 1) || (y > 0 && m[p - w] === 1) || (y < h - 1 && m[p + w] === 1)) {
            const i = p * 4; d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = 255; m[p] = 2;
          }
        }
      }
    }
    sctx.putImageData(img, 0, 0);
  }
  function makeSprite(key) {
    const [w, h] = LOOKS[key].sprite;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }), key, ox: w / 2, oy: h - 6 };
  }

  // Rastro da arma (coordenadas da tela em pixels).
  class Trail {
    constructor(n) { this.pts = []; for (let i = 0; i < n; i++) this.pts.push({ mx: 0, my: 0, tx: 0, ty: 0, t: -1 }); this.i = 0; }
    push(mx, my, tx, ty, t) {
      const p = this.pts[this.i]; p.mx = mx; p.my = my; p.tx = tx; p.ty = ty; p.t = t;
      this.i = (this.i + 1) % this.pts.length;
    }
    clear() { for (let i = 0; i < this.pts.length; i++) this.pts[i].t = -1; }
    draw(ctx, now, life, col) {
      const n = this.pts.length;
      let prev = null;
      ctx.fillStyle = col;
      for (let k = 0; k < n; k++) {
        const p = this.pts[(this.i + k) % n];
        if (p.t < 0 || now - p.t > life) { prev = null; continue; }
        if (prev) {
          ctx.globalAlpha = (1 - (now - p.t) / life) > 0.5 ? 0.8 : 0.45;
          ctx.beginPath(); ctx.moveTo(prev.mx, prev.my); ctx.lineTo(prev.tx, prev.ty); ctx.lineTo(p.tx, p.ty); ctx.lineTo(p.mx, p.my); ctx.closePath(); ctx.fill();
        }
        prev = p;
      }
      ctx.globalAlpha = 1;
    }
  }

  // ===========================================================================
  // 7. ENTRADA
  // ===========================================================================
  const BINDINGS = {
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
    light: ['KeyJ'], heavy: ['KeyK'], dodge: ['KeyL'], parry: ['KeyI'], special: ['KeyO'],
  };
  const GAME_CODES = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyO', 'Space', 'Enter', 'Escape', 'KeyR', 'KeyM']);
  const BUFFER_ACTIONS = ['light', 'heavy', 'dodge', 'parry', 'special'];

  class InputManager {
    constructor() {
      this.held = new Set();
      this.justPressed = new Set();
      this.justReleased = new Set();
      window.addEventListener('keydown', e => {
        if (e.repeat) return; // repetição automática do SO não dispara ações
        if (!this.held.has(e.code)) { this.held.add(e.code); this.justPressed.add(e.code); }
      });
      window.addEventListener('keyup', e => { this.held.delete(e.code); this.justReleased.add(e.code); });
      window.addEventListener('blur', () => this.reset());
    }
    any(set, action) { const c = BINDINGS[action]; for (let i = 0; i < c.length; i++) if (set.has(c[i])) return true; return false; }
    down(action) { return this.any(this.held, action); }
    pressed(action) { return this.any(this.justPressed, action); }
    released(action) { return this.any(this.justReleased, action); }
    endStep() { this.justPressed.clear(); this.justReleased.clear(); }
    reset() { this.held.clear(); this.endStep(); }
  }

  // ===========================================================================
  // 8. JOGADOR
  // ===========================================================================
  class Player {
    constructor(game) {
      this.game = game;
      this.look = LOOKS.guardian; this.lookKey = 'guardian';
      this.sprite = makeSprite('guardian');
      this.pose = makePose(); this.tpose = makePose();
      this.trail = new Trail(14);
      this.tipOut = { handX: 0, handY: 0, midX: 0, midY: 0, tipX: 0, tipY: 0 };
      this.isBoss = false; this.radius = 28; this.height = 112 * CHAR_SCALE;
      this.reset(computeStats({ blade: 0, vigor: 0, discipline: 0 }));
    }
    reset(stats) {
      this.stats = stats; this.maxHp = stats.maxHp; this.hp = stats.maxHp; this.blood = 0;
      this.x = 320; this.y = 590; this.prevX = this.x; this.prevY = this.y; this.rx = this.x; this.ry = this.y;
      this.vx = 0; this.vy = 0; this.facing = 1; this.faceVis = 1;
      this.state = 'idle'; this.t = 0; this.atk = null; this.attackId = -1; this.specialFired = false;
      this.buffer = null; this.bufferT = 0; this.invuln = 0; this.dodgeCd = 0; this.parryCd = 0; this.counterT = 0;
      this.hurtTime = 0; this.dodgeDirX = 0; this.dodgeDirY = 0; this.dodgeBack = false; this.dustT = 0;
      this.dead = false; this.deathT = 0; this.walkPhase = 0; this.noBloodT = 0; this.flash = 0;
      copyPose(this.pose, POSES.guardian.idle);
      this.trail.clear();
    }
    applyStats(stats, healFull) {
      this.stats = stats; this.maxHp = stats.maxHp;
      this.hp = healFull ? stats.maxHp : Math.min(this.hp, stats.maxHp);
    }
    setState(s) { this.state = s; this.t = 0; }
    gainBlood(n) { this.blood = clamp(this.blood + n * this.stats.bloodGain, 0, PLAYER_BASE.bloodMax); }
    heal(n) { this.hp = clamp(this.hp + n, 0, this.maxHp); }
    isDodgeInvuln() { return this.state === 'dodge' && this.t < PLAYER_BASE.dodgeIFrames; }
    trailOn() {
      if ((this.state !== 'attack' && this.state !== 'special') || !this.atk) return false;
      return this.t >= this.atk.active[0] - 0.04 && this.t <= this.atk.active[1] + 0.05;
    }

    update(dt) {
      const g = this.game, inp = g.input, B = PLAYER_BASE;
      this.t += dt;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.dodgeCd > 0) this.dodgeCd -= dt;
      if (this.parryCd > 0) this.parryCd -= dt;
      if (this.counterT > 0) this.counterT -= dt;
      if (this.noBloodT > 0) this.noBloodT -= dt;
      if (this.flash > 0) this.flash -= dt;

      if (this.state === 'dead') {
        this.deathT += dt;
        this.vx = approach(this.vx, 0, B.friction * dt);
        this.x = clamp(this.x + this.vx * dt, ARENA.left, ARENA.right);
        this.computePose(dt);
        return;
      }

      const locked = g.director.phase === 'narrative' || g.endKind === 'victory';
      if (!locked) {
        for (let i = 0; i < BUFFER_ACTIONS.length; i++) {
          if (inp.pressed(BUFFER_ACTIONS[i])) { this.buffer = BUFFER_ACTIONS[i]; this.bufferT = 0.2; }
        }
      }
      if (this.bufferT > 0) { this.bufferT -= dt; if (this.bufferT <= 0) this.buffer = null; }
      let ix = 0, iy = 0;
      if (!locked) {
        ix = (inp.down('right') ? 1 : 0) - (inp.down('left') ? 1 : 0);
        iy = (inp.down('down') ? 1 : 0) - (inp.down('up') ? 1 : 0);
      }

      let friction = true;
      switch (this.state) {
        case 'idle':
        case 'walk': {
          if (this.buffer && this.tryAction(this.buffer, ix, iy)) { this.buffer = null; friction = false; break; }
          const len = Math.hypot(ix, iy) || 1;
          const tvx = ix / len * this.stats.speed, tvy = iy / len * this.stats.speed * B.depthFactor;
          this.vx = approach(this.vx, tvx, B.accel * dt);
          this.vy = approach(this.vy, tvy, B.accel * dt);
          if (ix !== 0) this.facing = ix > 0 ? 1 : -1;
          this.state = (Math.abs(this.vx) + Math.abs(this.vy) > 20) ? 'walk' : 'idle';
          friction = false;
          break;
        }
        case 'attack':
        case 'special':
          this.updateAttack(dt, ix, iy);
          friction = false;
          break;
        case 'dodge': {
          const k = 1 - clamp(this.t / B.dodgeTime, 0, 1);
          this.vx = this.dodgeDirX * B.dodgeSpeed * (0.3 + 0.7 * k);
          this.vy = this.dodgeDirY * B.dodgeSpeed * 0.55 * (0.3 + 0.7 * k);
          this.dustT -= dt;
          if (this.dustT <= 0) { this.dustT = 0.05; g.effects.dust(this.x, this.y, 2); }
          if (this.t >= B.dodgeTime) { this.setState('idle'); this.dodgeCd = B.dodgeCooldown; }
          friction = false;
          break;
        }
        case 'parry':
          if (this.t >= B.parryStance) this.setState('parryRecover');
          break;
        case 'parryRecover':
          if (this.t >= B.parryRecover) { this.setState('idle'); this.parryCd = B.parryCooldown; }
          break;
        case 'hurt':
          if (this.t >= this.hurtTime) this.setState('idle');
          break;
      }
      if (friction) {
        this.vx = approach(this.vx, 0, B.friction * dt);
        this.vy = approach(this.vy, 0, B.friction * dt);
      }
      this.x = clamp(this.x + this.vx * dt, ARENA.left, ARENA.right);
      this.y = clamp(this.y + this.vy * dt, ARENA.top, ARENA.bottom);
      this.faceVis = this.facing;
      this.computePose(dt);
    }

    tryAction(a, ix, iy) {
      switch (a) {
        case 'light': this.startAttack('light1', ix); return true;
        case 'heavy': this.startAttack('heavy', ix); return true;
        case 'dodge': if (this.dodgeCd > 0) return false; this.startDodge(ix, iy); return true;
        case 'parry': if (this.parryCd > 0) return false; this.startParry(ix); return true;
        case 'special':
          if (this.blood < PLAYER_BASE.specialCost) {
            if (this.noBloodT <= 0) {
              this.noBloodT = 1.2;
              this.game.hud.toast('Sangue insuficiente — o Rito exige 50', 'warn', 1.6);
              this.game.audio.play('denied');
            }
            return true;
          }
          this.startAttack('special', 0);
          return true;
      }
      return false;
    }

    nearestEnemy(maxDx, preferThreat) {
      let best = null, bestD = Infinity;
      const list = this.game.enemies;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive() || e.entering) continue;
        const dx = Math.abs(e.x - this.x), dy = Math.abs(e.y - this.y);
        if (dx > maxDx || dy > 90) continue;
        let d = dx + dy * 2;
        if (preferThreat && (e.state === 'WINDUP' || e.state === 'ATTACK')) d -= 400;
        if (d < bestD) { bestD = d; best = e; }
      }
      return best;
    }
    autoFace(preferThreat) {
      const e = this.nearestEnemy(380, preferThreat);
      if (e) this.facing = e.x >= this.x ? 1 : -1;
    }

    startAttack(id, ix) {
      const A = PLAYER_ATTACKS[id];
      this.atk = A;
      this.setState(A.area ? 'special' : 'attack');
      this.attackId = ++this.game.attackSerial;
      this.specialFired = false;
      if (ix) this.facing = ix > 0 ? 1 : -1; else this.autoFace(false);
      if (A.area) {
        this.blood = clamp(this.blood - PLAYER_BASE.specialCost, 0, PLAYER_BASE.bloodMax);
        this.game.audio.play('special');
        this.game.effects.flash = 0.25; this.game.effects.flashColor = '#5a0008';
      } else if (A.sfx) {
        this.game.audio.play(A.sfx);
      }
    }

    updateAttack(dt, ix, iy) {
      const g = this.game, A = this.atk, t = this.t;
      const stepEnd = A.active[0] + 0.03;
      if (t < stepEnd && A.step) this.vx = this.facing * A.step * 2.4 * (1 - t / stepEnd);
      else this.vx = approach(this.vx, 0, 2200 * dt);
      this.vy = approach(this.vy, 0, 2200 * dt);

      if (A.area) {
        if (t < A.active[0]) g.effects.aura(this.x + rand(-30, 30), this.y + rand(-6, 6), rand(10, 120), '#ff2b3b');
        if (!this.specialFired && t >= A.active[0]) {
          this.specialFired = true;
          g.effects.ring(this.x, this.y, A.radius, 0.55, '#ff3040', 2);
          g.effects.ring(this.x, this.y, A.radius * 0.6, 0.4, '#ffd0d0', 1);
          for (let i = 0; i < 26; i++) { const a = rand(0, TAU), r = rand(20, A.radius); g.effects.aura(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r * 0.45, rand(0, 30), '#ff3344'); }
          g.effects.blood(this.x, this.y, 10, 1, 10, 1.2); g.effects.blood(this.x, this.y, 10, -1, 10, 1.2);
          g.effects.dust(this.x, this.y, 10);
          g.effects.shake = Math.max(g.effects.shake, A.shake);
          g.effects.flash = 0.5; g.effects.flashColor = '#ff2030';
          g.audio.play('slam');
        }
      }
      if (t >= A.active[0] && t <= A.active[1]) g.combat.playerStrike(this, A);

      if (t >= A.cancel && this.buffer) {
        const b = this.buffer;
        if (b === 'light' && A.next) { this.buffer = null; this.startAttack(A.next, ix); return; }
        if (b === 'heavy' && A.id !== 'heavy' && !A.area) { this.buffer = null; this.startAttack('heavy', ix); return; }
        if (b === 'dodge' && this.dodgeCd <= 0) { this.buffer = null; this.startDodge(ix, iy); return; }
        if (b === 'parry' && this.parryCd <= 0) { this.buffer = null; this.startParry(ix); return; }
      }
      if (t >= A.dur) this.setState('idle');
    }

    startDodge(ix, iy) {
      if (ix || iy) { const l = Math.hypot(ix, iy); this.dodgeDirX = ix / l; this.dodgeDirY = iy / l; }
      else { this.dodgeDirX = -this.facing; this.dodgeDirY = 0; }
      this.dodgeBack = this.dodgeDirX * this.facing < -0.1;
      this.setState('dodge');
      this.dustT = 0;
      this.game.audio.play('dodge');
    }

    startParry(ix) {
      if (ix) this.facing = ix > 0 ? 1 : -1; else this.autoFace(true);
      this.vx *= 0.3; this.vy *= 0.3;
      this.setState('parry');
      this.game.audio.play('parryStance');
    }

    takeHit(dmg, dir, knock, stun) {
      if (this.state === 'dead') return;
      const g = this.game;
      this.hp = Math.max(0, this.hp - dmg);
      g.progress.damageTaken += dmg;
      g.breakCombo();
      this.flash = 0.1;
      g.effects.blood(this.x, this.y, this.height * 0.55, dir, 9, 0.9);
      g.effects.text(this.x, this.y, this.height * 0.8, '-' + dmg, '#ff5060');
      g.effects.shake = Math.max(g.effects.shake, 6);
      g.hitstop = Math.max(g.hitstop, 0.06);
      g.audio.play('hurt');
      if (this.hp <= 0) { this.die(dir); return; }
      if (this.state === 'special') { this.invuln = 0.2; return; } // superarmadura durante o Rito
      this.setState('hurt');
      this.hurtTime = stun;
      this.vx = dir * knock; this.vy = 0;
      this.invuln = PLAYER_BASE.hurtIFrames;
      this.buffer = null;
    }

    push(dir, force) { // empurrão sem dano (rugido do chefe)
      if (this.state === 'dead') return;
      this.setState('hurt'); this.hurtTime = 0.35; this.vx = dir * force; this.buffer = null;
    }

    die(dir) {
      this.setState('dead');
      this.dead = true; this.deathT = 0; this.vx = dir * 220; this.vy = 0;
      this.game.onPlayerDeath();
    }

    computePose(dt) {
      const P = this.tpose, S = POSES.guardian, t = this.t, time = this.game.time;
      switch (this.state) {
        case 'idle':
          copyPose(P, S.idle);
          P.bob += Math.sin(time * 2.4) * 1.5; P.fSh += Math.sin(time * 2.4) * 0.04;
          break;
        case 'walk': walkPose(P, S.idle, this.walkPhase, 1); break;
        case 'attack':
        case 'special': {
          const A = this.atk;
          attackPose(P, S.idle, S[A.poseA], S[A.poseB], t, A.active[0], A.active[1], A.dur);
          break;
        }
        case 'dodge': copyPose(P, this.dodgeBack ? S.dodgeBack : S.dodge); break;
        case 'parry': copyPose(P, S.parry); break;
        case 'parryRecover': lerpPose(P, S.parry, S.idle, clamp(t / PLAYER_BASE.parryRecover, 0, 1)); break;
        case 'hurt': copyPose(P, S.hurt); break;
        case 'dead': lerpPose(P, S.hurt, S.dead, smooth(clamp(this.deathT / 0.7, 0, 1))); break;
      }
      const fast = this.state === 'attack' || this.state === 'special' || this.state === 'dodge';
      lerpPose(this.pose, this.pose, P, 1 - Math.exp(-dt * (fast ? 40 : 22)));
      const sp = Math.abs(this.vx) + Math.abs(this.vy);
      this.walkPhase += sp * dt * 0.04;
    }
  }

  // ===========================================================================
  // 9. INIMIGOS
  // ===========================================================================
  class Enemy {
    constructor(game, def, x, y) {
      this.game = game; this.def = def; this.look = LOOKS[def.look]; this.lookKey = def.look;
      this.sprite = makeSprite(def.look);
      this.x = x; this.y = y; this.prevX = x; this.prevY = y; this.rx = x; this.ry = y;
      this.vx = 0; this.vy = 0; this.facing = x < W / 2 ? 1 : -1; this.faceVis = this.facing;
      this.hp = def.hp; this.maxHp = def.hp;
      this.state = 'APPROACH'; this.stateT = 0;
      this.cd = rand(0.4, 1.0); this.thinkT = 0.3;
      this.entering = true; this.lastHitId = -1; this.hasHit = false;
      this.flash = 0; this.poiseAcc = 0; this.stunT = 0; this.deathT = 0; this.remove = false;
      this.walkPhase = rand(0, TAU); this.seed = rand(0, 100);
      this.slotDy = rand(-45, 45); this.retreatT = 0;
      this.strike = def; this.windupTime = def.windup || 0.5; this.recoveryTime = def.recovery || 0.6;
      this.isBoss = false; this.radius = def.radius;
      this.height = (this.look.beast ? 50 : 100) * this.look.scale * CHAR_SCALE;
      this.pose = makePose(); this.tpose = makePose();
      this.trail = new Trail(10);
      this.tipOut = { handX: 0, handY: 0, midX: 0, midY: 0, tipX: 0, tipY: 0 };
      this.scr = { tx: 0, ty: 0 };
      this.bk = { crouch: 0, stretch: 0, jaw: 0, dead: 0, moving: 0 };
      if (POSES[def.look]) copyPose(this.pose, POSES[def.look].idle);
    }
    alive() { return this.state !== 'DEAD'; }
    invulnerable() { return false; }
    setState(s) { this.state = s; this.stateT = 0; }
    isThreat() { return this.state === 'WINDUP' || this.state === 'ATTACK'; }
    trailOn() { return this.state === 'ATTACK' && !this.look.beast; }

    update(dt) {
      const g = this.game, p = g.player, d = this.def;
      this.stateT += dt;
      if (this.flash > 0) this.flash -= dt;
      if (this.cd > 0) this.cd -= dt;
      this.poiseAcc = Math.max(0, this.poiseAcc - dt * 15);
      const dx = p.x - this.x, dy = p.y - this.y, adx = Math.abs(dx), ady = Math.abs(dy);
      let mx = 0, my = 0, steer = false;

      switch (this.state) {
        case 'IDLE':
          steer = true;
          if (p.dead) { mx = -sign(dx) * d.speed * 0.25; this.facing = sign(dx); break; }
          this.facing = sign(dx);
          if (this.stateT >= this.thinkT) this.setState('APPROACH');
          break;
        case 'APPROACH': {
          steer = true;
          if (p.dead) { this.setState('IDLE'); break; }
          this.facing = sign(dx);
          if (this.retreatT > 0) {
            this.retreatT -= dt;
            mx = -sign(dx) * d.speed * 0.8;
            my = sign(this.slotDy) * d.depthSpeed * 0.6;
            break;
          }
          const side = this.x < p.x ? -1 : 1;
          const tx = p.x + side * d.range * 0.78;
          const depthFocus = d.look === 'executioner' ? 0.15 : (adx > 220 ? 1 : 0.3);
          let ty = clamp(p.y + this.slotDy * depthFocus, ARENA.top, ARENA.bottom);
          if (d.zigzag && adx > 150) ty = clamp(ty + Math.sin(g.time * 5 + this.seed) * 70, ARENA.top, ARENA.bottom);
          const ex = tx - this.x, ey = ty - this.y;
          if (Math.abs(ex) > 6) mx = sign(ex) * d.speed * clamp(Math.abs(ex) / 60, 0.3, 1);
          if (Math.abs(ey) > 4) my = sign(ey) * d.depthSpeed * clamp(Math.abs(ey) / 30, 0.3, 1);
          if (!this.entering && adx <= d.range && ady <= d.depthTol * 0.8 && this.cd <= 0 && g.combat.attackSlotFree(this)) {
            this.facing = sign(dx);
            this.startWindup();
          }
          break;
        }
        case 'WINDUP':
          if (this.stateT >= this.windupTime) this.beginStrike();
          break;
        case 'ATTACK':
          if (!this.hasHit && this.stateT <= this.strike.active + 0.02) g.combat.enemyMelee(this, this.strike);
          if (this.stateT >= this.strike.active) this.setState('RECOVERY');
          break;
        case 'RECOVERY':
          if (this.stateT >= this.recoveryTime) {
            this.cd = randRange(d.cooldown);
            this.slotDy = rand(-50, 50);
            if (d.hitAndRun) this.retreatT = rand(0.5, 0.9);
            else if (Math.random() < d.hesitate) this.retreatT = rand(0.3, 0.5);
            this.thinkT = randRange(d.think);
            this.setState('IDLE');
          }
          break;
        case 'HIT':
        case 'STAGGER':
          if (this.stateT >= this.stunT) { this.thinkT = 0.15; this.setState('IDLE'); }
          break;
        case 'DEAD':
          this.deathT += dt;
          if (this.deathT > 2.4) this.remove = true;
          break;
      }

      if (steer) {
        this.vx = approach(this.vx, mx, 1400 * dt);
        this.vy = approach(this.vy, my, 1400 * dt);
      } else {
        this.vx = approach(this.vx, 0, (this.state === 'ATTACK' ? 900 : 1300) * dt);
        this.vy = approach(this.vy, 0, 1300 * dt);
      }
      this.integrate(dt);
      this.walkPhase += (Math.abs(this.vx) + Math.abs(this.vy)) * dt * (this.look.beast ? 0.06 : 0.04);
      this.faceVis = this.facing;
      this.computePose(dt);
    }

    integrate(dt) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.entering) {
        if (this.x > ARENA.left + 15 && this.x < ARENA.right - 15) this.entering = false;
      } else {
        this.x = clamp(this.x, ARENA.left, ARENA.right);
      }
      this.y = clamp(this.y, ARENA.top, ARENA.bottom);
    }

    startWindup() {
      this.strike = this.def;
      this.windupTime = this.def.windup; this.recoveryTime = this.def.recovery;
      this.setState('WINDUP');
      this.game.audio.play('windup');
      this.game.hud.hintOnce('parry', 'O brilho na arma anuncia o golpe. Aperte I no instante do impacto para APARAR.');
    }
    beginStrike() {
      this.setState('ATTACK');
      this.hasHit = false;
      this.vx = this.facing * (this.strike.lunge || 0);
      this.game.audio.play(this.look.beast ? 'beastBite' : 'enemySwing');
    }

    receiveHit(dmg, atk, dir) {
      if (this.state === 'DEAD') return;
      const g = this.game, d = this.def;
      this.hp -= dmg; this.flash = 0.1;
      if (this.hp <= 0) { this.hp = 0; this.die(dir); return; }
      if (this.state === 'STAGGER') { this.vx = dir * 60; return; }
      if (d.poise > 0 && this.isThreat()) {
        this.poiseAcc += atk.poise;
        if (this.poiseAcc < d.poise) { g.effects.text(this.x, this.y, this.height + 10, 'RESISTE', '#c9b9a0'); return; }
        this.poiseAcc = 0;
      }
      this.stunT = atk.stun * d.stunMult;
      this.vx = dir * atk.knock * d.knockMult; this.vy = 0;
      this.setState('HIT');
    }

    onParried(perfect) {
      if (this.state === 'DEAD') return;
      if (perfect) {
        this.stunT = this.def.parryStagger;
        this.vx = -this.facing * 180;
        this.setState('STAGGER');
        this.game.audio.play('stagger');
      } else {
        this.vx = -this.facing * 120;
        this.recoveryTime = this.def.recovery;
        this.setState('RECOVERY');
      }
    }

    die(dir) {
      this.setState('DEAD');
      this.deathT = 0;
      this.vx = dir * 240; this.vy = 0;
      const g = this.game;
      g.effects.blood(this.x, this.y, this.height * 0.5, dir, 16, 1.1);
      g.onEnemyKilled(this);
    }

    computePose(dt) {
      if (this.look.beast) { this.computeBeast(dt); return; }
      const S = POSES[this.def.look], P = this.tpose, time = this.game.time, st = this.strike;
      switch (this.state) {
        case 'WINDUP': {
          const k = easeOut(clamp(this.stateT / (this.windupTime * 0.75), 0, 1));
          lerpPose(P, S.idle, S[st.wind], k);
          if (k >= 1) P.lean += Math.sin(time * 60) * 0.02;
          break;
        }
        case 'ATTACK': lerpPose(P, S[st.wind], S[st.hit], easeOut(clamp(this.stateT / Math.max(0.05, st.active * 0.6), 0, 1))); break;
        case 'RECOVERY': {
          const k = clamp(this.stateT / this.recoveryTime, 0, 1);
          lerpPose(P, S[st.hit], S.idle, k < 0.5 ? 0 : smooth((k - 0.5) / 0.5));
          break;
        }
        case 'HIT': copyPose(P, S.hurt); break;
        case 'STAGGER': copyPose(P, S.stagger); P.head += Math.sin(time * 7) * 0.15; P.lean += Math.sin(time * 3) * 0.05; break;
        case 'DEAD': lerpPose(P, S.hurt, S.dead, smooth(clamp(this.deathT / 0.7, 0, 1))); break;
        default: {
          const spd = Math.abs(this.vx) + Math.abs(this.vy);
          if (spd > 15) walkPose(P, S.idle, this.walkPhase, 0.9);
          else { copyPose(P, S.idle); P.bob += Math.sin(time * 2 + this.seed) * 1.5; }
        }
      }
      const fast = this.state === 'ATTACK' || this.state === 'HIT';
      lerpPose(this.pose, this.pose, P, 1 - Math.exp(-dt * (fast ? 40 : 20)));
    }

    computeBeast(dt) {
      const b = this.bk;
      let crouch = 0, stretch = 0, jaw = 0.15, dead = 0;
      switch (this.state) {
        case 'WINDUP': crouch = 1; jaw = 0.6; break;
        case 'ATTACK': stretch = 1; jaw = 1; break;
        case 'RECOVERY': crouch = 0.3; jaw = 0.3; break;
        case 'HIT': crouch = 0.5; jaw = 0.8; break;
        case 'STAGGER': crouch = 0.8; jaw = 0.5 + 0.3 * Math.sin(this.game.time * 8); break;
        case 'DEAD': dead = 1; jaw = 0.9; break;
      }
      const k = 1 - Math.exp(-dt * 18);
      b.crouch += (crouch - b.crouch) * k; b.stretch += (stretch - b.stretch) * k; b.jaw += (jaw - b.jaw) * k;
      b.dead += (dead - b.dead) * (1 - Math.exp(-dt * 6));
      b.moving += ((Math.abs(this.vx) + Math.abs(this.vy) > 20 ? 1 : 0) - b.moving) * k;
    }
  }

  // ===========================================================================
  // 10. CHEFE — CAVALEIRO DA NOITE ETERNA
  // ===========================================================================
  class Boss extends Enemy {
    constructor(game, x, y) {
      super(game, BOSS_DEF, x, y);
      this.isBoss = true; this.phase = 1;
      this.state = 'INTRO'; this.roared = false;
      this.height = 112 * 1.45 * CHAR_SCALE;
      this.atkName = ''; this.atkDef = null; this.atkKind = ''; this.strikeIdx = 0;
      this.lastAttack = ''; this.repeat = 0; this.nextAttack = '';
      this.chargeDist = 0; this.traveled = 0; this.slamDone = false; this.pushed = false;
      this.trail = new Trail(14);
      this.facing = -1; this.faceVis = -1;
      this.strike = BOSS_ATTACKS.sweep.strikes[0];
    }
    mods() { return BOSS_PHASE_MODS[this.phase]; }
    invulnerable() { return this.state === 'INTRO' || this.state === 'PHASE'; }
    trailOn() { return this.state === 'ATTACK' && this.atkKind !== 'charge'; }
    currentCrimson() { return this.state === 'WINDUP' && !this.strike.parryable; }
    chargeDistPreview() { return clamp(Math.abs(this.game.player.x - this.x) + 170, 280, 760); }

    chooseAttack() {
      const p = this.game.player, adx = Math.abs(p.x - this.x), p2 = this.phase === 2;
      const opts = [];
      if (adx < 320) { opts.push('sweep', 'sweep', 'slam'); if (p2) opts.push('flurry', 'flurry'); }
      else { opts.push('charge', 'charge', 'slam'); if (p2) opts.push('flurry'); }
      let pick = opts[Math.floor(Math.random() * opts.length)];
      if (pick === this.lastAttack && this.repeat >= 1) {
        const others = opts.filter(o => o !== pick);
        if (others.length) pick = others[Math.floor(Math.random() * others.length)];
      }
      return pick;
    }

    startAttack(name) {
      this.repeat = name === this.lastAttack ? this.repeat + 1 : 0;
      this.lastAttack = name;
      this.atkName = name; this.atkDef = BOSS_ATTACKS[name]; this.atkKind = this.atkDef.kind;
      this.strikeIdx = 0;
      this.startStrikeWindup();
    }
    startStrikeWindup() {
      const m = this.mods();
      this.strike = this.atkDef.strikes[this.strikeIdx];
      // golpes carmesins mantêm um telegráfico longo mesmo na fase 2
      this.windupTime = this.strike.windup * (this.strike.parryable ? m.windup : Math.max(0.95, m.windup));
      this.setState('WINDUP');
      const g = this.game;
      if (this.strike.parryable) g.audio.play('bossWindup');
      else {
        g.audio.play('crimson');
        g.hud.hintOnce('crimson', 'Golpes CARMESIM (!) não podem ser aparados. Esquive com L!');
      }
    }
    beginStrike() {
      const g = this.game, p = g.player;
      this.setState('ATTACK');
      this.hasHit = false; this.slamDone = false;
      if (this.atkKind === 'melee') { this.vx = this.facing * this.strike.lunge; g.audio.play('bossSwing'); }
      else if (this.atkKind === 'charge') {
        this.traveled = 0;
        this.chargeDist = clamp(Math.abs(p.x - this.x) + 170, 280, 760);
        g.audio.play('charge');
      }
    }

    update(dt) {
      const g = this.game, p = g.player, m = this.mods();
      this.stateT += dt;
      if (this.flash > 0) this.flash -= dt;
      this.poiseAcc = Math.max(0, this.poiseAcc - dt * 12);
      const dx = p.x - this.x, dy = p.y - this.y, adx = Math.abs(dx), ady = Math.abs(dy);
      let mx = 0, my = 0, steer = false;

      if (this.phase === 1 && this.hp <= this.maxHp * 0.5 && this.state !== 'DEAD') this.enterPhase2();

      switch (this.state) {
        case 'INTRO':
          if (this.stateT < 1.5) { steer = true; mx = -240; }
          if (!this.roared && this.stateT >= 1.7) {
            this.roared = true;
            g.audio.play('bossRoar'); g.effects.shake = Math.max(g.effects.shake, 6);
            g.effects.ring(this.x, this.y, 260, 0.7, '#ff3040', 2);
          }
          if (this.stateT >= 2.8) { this.thinkT = 0.4; this.entering = false; this.setState('IDLE'); }
          break;
        case 'IDLE':
          steer = true;
          this.facing = sign(dx);
          if (!p.dead && this.stateT >= this.thinkT) { this.nextAttack = this.chooseAttack(); this.setState('APPROACH'); }
          break;
        case 'APPROACH': {
          steer = true;
          if (p.dead) { this.setState('IDLE'); break; }
          this.facing = sign(dx);
          const atk = BOSS_ATTACKS[this.nextAttack];
          const spd = BOSS_DEF.speed * m.speed;
          if (this.nextAttack === 'charge') {
            if (ady > 14) my = sign(dy) * BOSS_DEF.depthSpeed * m.speed;
            if (ady < 40 || this.stateT > 1.0) { this.startAttack('charge'); break; }
          } else {
            const ex = adx - atk.want;
            if (Math.abs(ex) > 25) mx = sign(dx) * sign(ex) * spd;
            if (ady > 12) my = sign(dy) * BOSS_DEF.depthSpeed * m.speed;
            if (Math.abs(ex) <= 50 && ady <= 30) { this.startAttack(this.nextAttack); break; }
          }
          if (this.stateT > 2.8) this.startAttack(adx > 300 ? 'charge' : 'slam'); // nunca fica preso aproximando
          break;
        }
        case 'WINDUP': {
          if (this.stateT < this.windupTime * 0.5) this.facing = sign(dx);
          if (this.atkKind === 'charge' && this.stateT < this.windupTime * 0.6) this.vy = clamp(dy * 2.5, -120, 120);
          if (this.stateT >= this.windupTime) this.beginStrike();
          break;
        }
        case 'ATTACK':
          this.updateAttack(dt);
          break;
        case 'RECOVERY':
          if (this.stateT >= this.recoveryTime) { this.thinkT = randRange(BOSS_DEF.think) * (this.phase === 2 ? 0.7 : 1); this.setState('IDLE'); }
          break;
        case 'STAGGER':
          if (this.stateT >= this.stunT) { this.thinkT = 0.3; this.setState('IDLE'); }
          break;
        case 'PHASE':
          if (!this.pushed && this.stateT >= 0.55) {
            this.pushed = true;
            g.effects.ring(this.x, this.y, 420, 0.8, '#ff2030', 3);
            g.effects.shake = Math.max(g.effects.shake, 10);
            g.effects.flash = 0.5; g.effects.flashColor = '#ff1020';
            if (adx < 380 && !p.dead) p.push(sign(dx), 560);
          }
          if (this.stateT < 2.0) g.effects.aura(this.x + rand(-40, 40), this.y + rand(-8, 8), rand(20, 220), '#ff2030');
          if (this.stateT >= 2.0) { this.thinkT = 0.2; this.setState('IDLE'); }
          break;
        case 'DEAD':
          this.deathT += dt;
          if (this.deathT < 2.4 && Math.random() < 0.6) g.effects.aura(this.x + rand(-40, 40), this.y + rand(-6, 6), rand(10, 200), '#ff2030');
          break;
      }

      if (this.phase === 2 && this.state !== 'DEAD' && Math.random() < 0.3) g.effects.aura(this.x + rand(-40, 40), this.y + rand(-5, 5), rand(10, 220), '#ff2030');

      if (this.state === 'ATTACK' && this.atkKind === 'charge') { /* velocidade controlada em updateAttack */ }
      else if (steer) {
        this.vx = approach(this.vx, mx, 900 * dt);
        this.vy = approach(this.vy, my, 900 * dt);
      } else {
        this.vx = approach(this.vx, 0, 900 * dt);
        // na preparação da investida o chefe ainda se alinha em profundidade (vy definido acima)
        if (!(this.state === 'WINDUP' && this.atkKind === 'charge')) this.vy = approach(this.vy, 0, 1200 * dt);
      }
      this.integrate(dt);
      if (!this.entering) this.x = clamp(this.x, ARENA.left + 10, ARENA.right - 10);
      this.walkPhase += (Math.abs(this.vx) + Math.abs(this.vy)) * dt * 0.035;
      this.faceVis = this.facing;
      this.computePose(dt);
    }

    updateAttack(dt) {
      const g = this.game, s = this.strike;
      if (this.atkKind === 'melee') {
        if (!this.hasHit && this.stateT <= s.active + 0.02) g.combat.enemyMelee(this, s);
        if (this.stateT >= s.active) this.nextStrikeOrRecover();
      } else if (this.atkKind === 'charge') {
        const spd = s.speed * this.mods().speed;
        this.vx = this.facing * spd; this.vy = 0;
        this.traveled += spd * dt;
        if (Math.random() < 0.5) g.effects.dust(this.x - this.facing * 20, this.y, 1);
        if (!this.hasHit) g.combat.enemyContact(this, s);
        const atEdge = (this.facing > 0 && this.x >= ARENA.right - 12) || (this.facing < 0 && this.x <= ARENA.left + 12);
        if (this.traveled >= this.chargeDist || atEdge || this.stateT > s.active) {
          this.vx = this.facing * 160;
          if (atEdge) { g.effects.shake = Math.max(g.effects.shake, 5); g.effects.dust(this.x + this.facing * 30, this.y, 8); }
          this.nextStrikeOrRecover();
        }
      } else if (this.atkKind === 'slam') {
        if (!this.slamDone) {
          this.slamDone = true;
          const cx = clamp(this.x + this.facing * s.offset, ARENA.left, ARENA.right), cy = this.y;
          g.combat.enemyArea(this, s, cx, cy);
          g.effects.ring(cx, cy, s.radius, 0.45, '#ff5030', 2);
          g.effects.dust(cx, cy, 14); g.effects.sparks(cx, cy, 4, 0, 14, '#ffb070');
          g.effects.shake = Math.max(g.effects.shake, 11);
          g.audio.play('slam');
          if (this.phase === 2) g.hazards.push(new Shockwave(cx, cy, SHOCKWAVE_STRIKE));
        }
        if (this.stateT >= s.active) this.nextStrikeOrRecover();
      }
    }

    nextStrikeOrRecover() {
      if (this.strikeIdx < this.atkDef.strikes.length - 1) { this.strikeIdx++; this.startStrikeWindup(); return; }
      this.recoveryTime = this.atkDef.recovery * this.mods().recovery;
      this.setState('RECOVERY');
    }

    enterPhase2() {
      this.phase = 2;
      this.pushed = false;
      this.poiseAcc = 0;
      this.setState('PHASE');
      const g = this.game;
      g.audio.play('bossRoar');
      g.hud.banner('A Noite Desperta', 'O Cavaleiro abraça a fúria', 2.6);
      g.hazards.length = 0;
    }

    receiveHit(dmg, atk, dir) {
      if (this.state === 'DEAD') return;
      const g = this.game;
      this.hp -= dmg; this.flash = 0.08;
      if (this.hp <= 0) { this.hp = 0; this.die(dir); return; }
      if (this.state === 'STAGGER') return;
      this.poiseAcc += atk.poise;
      if (this.poiseAcc >= BOSS_DEF.poise) {
        this.poiseAcc = 0;
        this.stunT = 1.1;
        this.vx = dir * 120;
        this.setState('STAGGER');
        g.effects.text(this.x, this.y, this.height + 20, 'POSTURA QUEBRADA', '#f3dfae');
        g.audio.play('stagger');
      } else if (this.state === 'IDLE' || this.state === 'APPROACH' || this.state === 'RECOVERY') {
        this.vx += dir * 40;
      }
    }

    onParried(perfect) {
      if (this.state === 'DEAD') return;
      const g = this.game;
      if (perfect) {
        this.stunT = this.phase === 2 ? 0.8 : 1.0;
        this.vx = -this.facing * 150;
        this.poiseAcc += 25;
        this.setState('STAGGER');
        g.audio.play('stagger');
      } else if (this.atkKind === 'charge' && this.state === 'ATTACK') {
        this.vx = -this.facing * 100;
        this.recoveryTime = this.atkDef.recovery * this.mods().recovery;
        this.setState('RECOVERY');
      }
    }

    die(dir) {
      this.setState('DEAD');
      this.deathT = 0; this.vx = dir * 60; this.vy = 0;
      const g = this.game;
      g.hazards.length = 0;
      g.effects.blood(this.x, this.y, 100, dir, 24, 1.3);
      g.effects.ring(this.x, this.y, 380, 1.0, '#ff3040', 3);
      g.effects.flash = 0.8; g.effects.flashColor = '#ffffff';
      g.onEnemyKilled(this);
    }

    computePose(dt) {
      const S = POSES.boss, P = this.tpose, time = this.game.time, st = this.strike;
      switch (this.state) {
        case 'INTRO':
          if (this.stateT < 1.5) walkPose(P, S.idle, this.walkPhase, 0.8);
          else lerpPose(P, S.idle, S.roar, smooth(clamp((this.stateT - 1.5) / 0.3, 0, 1) * (this.stateT < 2.5 ? 1 : clamp((2.8 - this.stateT) / 0.3, 0, 1))));
          break;
        case 'WINDUP': {
          const k = easeOut(clamp(this.stateT / (this.windupTime * 0.75), 0, 1));
          lerpPose(P, this.strikeIdx > 0 ? S[this.atkDef.strikes[this.strikeIdx - 1].hit] : S.idle, S[st.wind], k);
          if (k >= 1) P.lean += Math.sin(time * 50) * 0.015;
          break;
        }
        case 'ATTACK':
          if (this.atkKind === 'charge') walkPose(P, S.chargeRun, this.walkPhase * 1.4, 1.3);
          else lerpPose(P, S[st.wind], S[st.hit], easeOut(clamp(this.stateT / Math.max(0.05, (st.active || 0.15) * 0.6), 0, 1)));
          break;
        case 'RECOVERY': {
          const k = clamp(this.stateT / this.recoveryTime, 0, 1);
          lerpPose(P, S[st.hit], S.idle, k < 0.55 ? 0 : smooth((k - 0.55) / 0.45));
          if (k < 0.55) { P.head += 0.15; P.bob += Math.sin(time * 6) * 1.5; }
          break;
        }
        case 'STAGGER': copyPose(P, S.stagger); P.head += Math.sin(time * 6) * 0.12; break;
        case 'PHASE': copyPose(P, S.roar); P.lean += Math.sin(time * 30) * 0.02; break;
        case 'DEAD':
          if (this.deathT < 1.2) lerpPose(P, S.stagger, S.kneel, smooth(clamp(this.deathT / 0.6, 0, 1)));
          else lerpPose(P, S.kneel, S.dead, smooth(clamp((this.deathT - 1.2) / 0.8, 0, 1)));
          break;
        default: {
          const spd = Math.abs(this.vx) + Math.abs(this.vy);
          if (spd > 15) walkPose(P, S.idle, this.walkPhase, 0.75);
          else { copyPose(P, S.idle); P.bob += Math.sin(time * 1.6) * 1.8; }
        }
      }
      const fast = this.state === 'ATTACK';
      lerpPose(this.pose, this.pose, P, 1 - Math.exp(-dt * (fast ? 36 : 16)));
    }
  }

  // Onda de choque da fase 2: anel que se expande pelo chão. Só a esquiva atravessa.
  class Shockwave {
    constructor(x, y, strike) { this.x = x; this.y = y; this.r = 50; this.maxR = 560; this.speed = 540; this.width = 34; this.hit = false; this.dead = false; this.strike = strike; }
    update(dt, game) {
      this.r += this.speed * dt;
      if (this.r >= this.maxR) this.dead = true;
      const p = game.player;
      if (this.hit || p.dead) return;
      const dx = p.x - this.x, dy = (p.y - this.y) / 0.42;
      if (Math.abs(Math.hypot(dx, dy) - this.r) < this.width * 0.5 + 6) {
        this.hit = true;
        game.combat.resolveIncoming(this, this.strike, sign(dx));
      }
    }
  }

  // ===========================================================================
  // 11. SISTEMA DE COMBATE — regras centralizadas de dano, defesa e aparo
  // ===========================================================================
  class CombatSystem {
    constructor(game) { this.game = game; }

    damage(raw, defense) {
      const v = raw * (0.92 + Math.random() * 0.16);
      return Math.max(1, Math.round(v * 30 / (30 + defense)));
    }

    attackSlotFree(self) {
      // no máximo 2 inimigos comuns atacando ao mesmo tempo
      let n = 0;
      const list = this.game.enemies;
      for (let i = 0; i < list.length; i++) { const e = list[i]; if (e !== self && !e.isBoss && e.isThreat()) n++; }
      return n < 2;
    }

    playerStrike(p, A) {
      const list = this.game.enemies;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive() || e.lastHitId === p.attackId) continue;
        if (e.entering && (e.x < 0 || e.x > W)) continue;
        let hit;
        if (A.area) {
          const nx = (e.x - p.x) / (A.radius + e.radius), ny = (e.y - p.y) / A.depth;
          hit = nx * nx + ny * ny <= 1;
        } else {
          const fx = (e.x - p.x) * p.facing;
          hit = fx >= -A.back - e.radius * 0.5 && fx <= A.range + e.radius && Math.abs(e.y - p.y) <= A.depth + (e.isBoss ? 10 : 0);
        }
        if (!hit) continue;
        e.lastHitId = p.attackId; // cada alvo recebe no máximo um acerto por golpe
        this.hitEnemy(p, e, A);
      }
    }

    hitEnemy(p, e, A) {
      const g = this.game, fx = g.effects;
      const dir = e.x >= p.x ? 1 : -1;
      const hz = e.height * 0.6;
      if (e.invulnerable()) {
        fx.sparks(e.x - dir * 10, e.y, hz, -dir, 8, '#cfd8ff');
        fx.text(e.x, e.y, e.height + 20, 'IMUNE', '#cfd8ff');
        g.audio.play('block');
        g.hitstop = Math.max(g.hitstop, 0.03);
        return;
      }
      let raw = p.stats.damage * A.mult;
      let label = '#f2e6d0';
      if (A.area && e.isBoss) raw *= BOSS_DEF.specialResist;
      if (e.state === 'STAGGER') { raw *= PLAYER_BASE.staggerMult; label = '#ffd36a'; }
      if (p.counterT > 0) { raw *= PLAYER_BASE.counterMult; p.counterT = 0; label = '#ffd36a'; fx.text(e.x, e.y, e.height + 34, 'CONTRA-ATAQUE', '#ffd36a'); }
      const dmg = this.damage(raw, e.def.defense);
      e.receiveHit(dmg, A, dir);
      fx.blood(e.x - dir * 6, e.y, hz, dir, A.poise >= 24 ? 12 : 6, A.poise >= 24 ? 1.1 : 0.8);
      fx.sparks(e.x - dir * 8, e.y, hz, dir, A.poise >= 24 ? 8 : 4, '#ffe2b0');
      fx.text(e.x + rand(-10, 10), e.y, e.height + 10, String(dmg), label);
      g.hitstop = Math.max(g.hitstop, A.hitstop);
      fx.shake = Math.max(fx.shake, A.shake);
      g.audio.play(A.poise >= 24 ? 'hitHeavy' : 'hit');
      if (A.blood) p.gainBlood(A.blood);
      g.registerHit();
    }

    enemyMelee(e, s) {
      const p = this.game.player;
      if (p.dead) return;
      const fx = (p.x - e.x) * e.facing;
      if (fx >= -12 && fx <= s.range + p.radius && Math.abs(p.y - e.y) <= s.depthTol) {
        e.hasHit = true;
        this.resolveIncoming(e, s, e.facing);
      }
    }
    enemyContact(e, s) {
      const p = this.game.player;
      if (p.dead) return;
      if (Math.abs(p.x - e.x) <= e.radius + s.range * 0.5 + p.radius && Math.abs(p.y - e.y) <= s.depthTol) {
        e.hasHit = true;
        this.resolveIncoming(e, s, e.facing);
      }
    }
    enemyArea(e, s, cx, cy) {
      const p = this.game.player;
      if (p.dead) return;
      const nx = (p.x - cx) / s.radius, ny = (p.y - cy) / (s.radius * 0.42);
      if (nx * nx + ny * ny <= 1) this.resolveIncoming(e, s, p.x >= cx ? 1 : -1);
    }

    // Resolve um golpe contra o jogador: esquiva, aparo perfeito, bloqueio ou dano.
    resolveIncoming(attacker, s, dir) {
      const g = this.game, p = g.player, fx = g.effects;
      if (p.dead) return 'none';
      if (p.isDodgeInvuln()) {
        fx.text(p.x, p.y, p.height * 0.85, 'ESQUIVA', '#cfd8ff');
        p.gainBlood(BLOOD_GAIN.evade);
        return 'evade';
      }
      if (p.invuln > 0) return 'invuln';
      const inFront = (attacker.x - p.x) * p.facing >= -12;
      if (p.state === 'parry' && inFront) {
        if (s.parryable) {
          if (p.t <= p.stats.parryWindow) {
            // APARO PERFEITO
            p.gainBlood(BLOOD_GAIN.perfectParry);
            p.invuln = 0.25; p.counterT = PLAYER_BASE.counterWindow;
            p.setState('idle');
            if (attacker.onParried) attacker.onParried(true);
            const hx = (p.x + attacker.x) / 2;
            fx.shards(hx, p.y, p.height * 0.55, 18);
            fx.ring(p.x + p.facing * 30, p.y, 130, 0.45, '#eef4ff', 1);
            fx.flash = 0.35; fx.flashColor = '#e8eeff';
            fx.text(p.x, p.y, p.height + 10, 'APARO PERFEITO', '#ffffff');
            fx.shake = Math.max(fx.shake, 5);
            g.hitstop = Math.max(g.hitstop, 0.09);
            g.slowmo = 0.35;
            g.progress.parries++;
            g.audio.play('perfect');
            return 'perfect';
          }
          // aparo tardio: bloqueia parte do dano
          const chip = Math.max(1, Math.round(this.damage(s.damage, p.stats.defense) * 0.25));
          p.hp = Math.max(1, p.hp - chip);
          g.progress.damageTaken += chip;
          p.gainBlood(BLOOD_GAIN.block);
          p.vx = dir * s.knock * 0.4;
          p.setState('parryRecover');
          if (attacker.onParried) attacker.onParried(false);
          fx.sparks(p.x + p.facing * 20, p.y, p.height * 0.55, -p.facing, 10, '#ffd9a0');
          fx.text(p.x, p.y, p.height * 0.9, 'BLOQUEIO -' + chip, '#d8c8b0');
          g.hitstop = Math.max(g.hitstop, 0.04);
          g.audio.play('parry');
          return 'block';
        }
        fx.text(p.x, p.y, p.height + 18, 'IMPARÁVEL!', '#ff4050');
      }
      p.takeHit(this.damage(s.damage, p.stats.defense), dir, s.knock, s.stun);
      return 'hit';
    }
  }

  // ===========================================================================
  // 12. EFEITOS — partículas em pool, desenhadas como pixels
  // ===========================================================================
  const FX_BLOOD = 1, FX_SPARK = 2, FX_DUST = 3, FX_EMBER = 4, FX_SHARD = 5, FX_AURA = 6;

  function pxEllipseStroke(ctx, cx, cy, rx, ry, color) {
    if (rx < 0.5) return;
    ctx.fillStyle = color;
    const n = Math.max(16, Math.round((rx + ry) * 1.6));
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
  }
  function pxEllipseFill(ctx, cx, cy, rx, ry, style) {
    if (rx < 0.5 || ry < 0.5) return;
    ctx.fillStyle = style;
    const r = Math.ceil(ry);
    for (let dy = -r; dy <= r; dy++) {
      const k = 1 - (dy / ry) * (dy / ry);
      if (k <= 0) continue;
      const half = rx * Math.sqrt(k);
      const x0 = Math.round(cx - half);
      ctx.fillRect(x0, Math.round(cy + dy), Math.max(1, Math.round(cx + half) - x0), 1);
    }
  }
  const CHECKERS = {};
  function checker(ctx, color) {
    let c = CHECKERS[color];
    if (!c) {
      const cv = document.createElement('canvas'); cv.width = 2; cv.height = 2;
      const g = cv.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
      c = CHECKERS[color] = cv;
    }
    return ctx.createPattern(c, 'repeat');
  }

  class EffectSystem {
    constructor() {
      this.parts = [];
      for (let i = 0; i < 700; i++) this.parts.push({ on: false, type: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, color: '#fff', grav: 0 });
      this.cursor = 0; this.ringCursor = 0; this.textCursor = 0;
      this.texts = []; for (let i = 0; i < 40; i++) this.texts.push({ on: false, x: 0, y: 0, z: 0, vz: 0, life: 0, max: 1, text: '', color: '#fff' });
      this.rings = []; for (let i = 0; i < 24; i++) this.rings.push({ on: false, x: 0, y: 0, r: 0, maxR: 0, life: 0, max: 1, color: '#fff', width: 1 });
      this.stains = []; for (let i = 0; i < 70; i++) this.stains.push({ on: false, x: 0, y: 0, r: 0, life: 0 });
      this.stainCursor = 0;
      this.ash = [];
      for (let i = 0; i < 70; i++) this.ash.push({ x: rand(0, LW), y: rand(0, LH), vx: rand(-2, 4), vy: rand(3, 9), ph: rand(0, TAU), ember: Math.random() < 0.18 });
      this.shake = 0; this.flash = 0; this.flashColor = '#ffffff';
    }
    clear() {
      for (const p of this.parts) p.on = false;
      for (const t of this.texts) t.on = false;
      for (const r of this.rings) r.on = false;
      for (const s of this.stains) s.on = false;
      this.shake = 0; this.flash = 0;
    }
    alloc(pool, cursorKey) {
      const n = pool.length;
      for (let k = 0; k < n; k++) {
        const i = (this[cursorKey] + k) % n;
        if (!pool[i].on) { this[cursorKey] = i + 1; return pool[i]; }
      }
      const p = pool[this[cursorKey] % n]; this[cursorKey]++; return p; // pool cheio: recicla
    }
    spawn(type, x, y, z, vx, vy, vz, life, size, color, grav) {
      const p = this.alloc(this.parts, 'cursor');
      p.on = true; p.type = type; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
      p.life = life; p.max = life; p.size = size; p.color = color; p.grav = grav;
      return p;
    }
    blood(x, y, z, dir, n, power) {
      for (let i = 0; i < n; i++) {
        this.spawn(FX_BLOOD, x, y, z, dir * rand(40, 260) * power + rand(-40, 40), rand(-50, 50), rand(60, 320) * power,
          rand(0.5, 0.9), Math.random() < 0.3 ? 2 : 1, Math.random() < 0.5 ? '#c8102a' : '#7a0a16', 900);
      }
    }
    sparks(x, y, z, dir, n, color) {
      for (let i = 0; i < n; i++) {
        this.spawn(FX_SPARK, x, y, z, (dir || sign(rand(-1, 1))) * rand(100, 480) + rand(-150, 150), rand(-80, 80), rand(-60, 340), rand(0.15, 0.35), 1, color, 700);
      }
    }
    dust(x, y, n) {
      for (let i = 0; i < n; i++) this.spawn(FX_DUST, x + rand(-12, 12), y + rand(-4, 4), rand(0, 6), rand(-60, 60), rand(-15, 15), rand(5, 30), rand(0.4, 0.75), rand(1, 2.4), '#8a8094', 0);
    }
    embers(x, y, z, n, color) {
      for (let i = 0; i < n; i++) this.spawn(FX_EMBER, x + rand(-6, 6), y, z, rand(-15, 15), 0, rand(30, 80), rand(0.8, 1.6), 1, color, -10);
    }
    shards(x, y, z, n) {
      for (let i = 0; i < n; i++) { const a = rand(0, TAU), sp = rand(200, 520); this.spawn(FX_SHARD, x, y, z, Math.cos(a) * sp, 0, Math.sin(a) * sp, rand(0.2, 0.45), 1, '#ffffff', 0); }
    }
    aura(x, y, z, color) { this.spawn(FX_AURA, x, y, z, rand(-10, 10), 0, rand(40, 110), rand(0.5, 1.0), Math.random() < 0.3 ? 2 : 1, color, -20); }
    ring(x, y, maxR, life, color, width) {
      const r = this.alloc(this.rings, 'ringCursor');
      r.on = true; r.x = x; r.y = y; r.r = 0; r.maxR = maxR; r.life = life; r.max = life; r.color = color; r.width = width;
    }
    text(x, y, z, text, color) {
      const t = this.alloc(this.texts, 'textCursor');
      t.on = true; t.x = x; t.y = y; t.z = z; t.vz = 70; t.life = 0.9; t.max = 0.9; t.text = text; t.color = color;
    }
    stain(x, y, r) {
      const s = this.stains[this.stainCursor % this.stains.length]; this.stainCursor++;
      s.on = true; s.x = x; s.y = clamp(y, FLOOR_Y + 20, H); s.r = r; s.life = 9;
    }
    update(dt) {
      this.shake *= Math.exp(-dt * 9); if (this.shake < 0.5) this.shake = 0;
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);
      const ps = this.parts;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]; if (!p.on) continue;
        p.life -= dt; if (p.life <= 0) { p.on = false; continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= p.grav * dt;
        if (p.type === FX_BLOOD) {
          if (p.z <= 0) { p.on = false; if (Math.random() < 0.35) this.stain(p.x, p.y, rand(4, 10)); }
        } else if (p.type === FX_SPARK) {
          p.vx *= Math.exp(-dt * 3);
          if (p.z < 0) { p.z = 0; p.vz *= -0.3; }
        } else if (p.type === FX_DUST || p.type === FX_SHARD) {
          p.vx *= Math.exp(-dt * 5); p.vz *= Math.exp(-dt * 5);
        }
      }
      for (let i = 0; i < this.texts.length; i++) {
        const t = this.texts[i]; if (!t.on) continue;
        t.life -= dt; if (t.life <= 0) { t.on = false; continue; }
        t.z += t.vz * dt; t.vz *= Math.exp(-dt * 3);
      }
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i]; if (!r.on) continue;
        r.life -= dt; if (r.life <= 0) { r.on = false; continue; }
        r.r = r.maxR * easeOut(1 - r.life / r.max);
      }
      for (let i = 0; i < this.stains.length; i++) {
        const s = this.stains[i]; if (!s.on) continue;
        s.life -= dt; if (s.life <= 0) s.on = false;
      }
    }
    updateAmbient(dt) {
      for (let i = 0; i < this.ash.length; i++) {
        const a = this.ash[i];
        a.ph += dt;
        a.x += (a.vx + Math.sin(a.ph * 0.9) * 3) * dt; a.y += a.vy * dt;
        if (a.y > LH + 2) { a.y = -2; a.x = rand(0, LW); }
        if (a.x > LW + 2) a.x = -2; else if (a.x < -2) a.x = LW + 2;
      }
    }
    // Tudo abaixo desenha em pixels de tela (320x180).
    drawFloor(ctx) {
      for (let i = 0; i < this.stains.length; i++) {
        const s = this.stains[i]; if (!s.on) continue;
        if (s.life < 2 && Math.floor(s.life * 10) % 2) continue;
        ctx.fillStyle = '#4a0812';
        ctx.fillRect(Math.round(s.x / PX), Math.round(s.y / PX), Math.max(1, Math.round(s.r / PX)), 1);
      }
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i]; if (!r.on) continue;
        const k = r.life / r.max;
        ctx.globalAlpha = k > 0.5 ? 1 : 0.6;
        pxEllipseStroke(ctx, r.x / PX, r.y / PX, r.r / PX, r.r * 0.42 / PX, r.color);
        if (r.width > 1) pxEllipseStroke(ctx, r.x / PX, r.y / PX, r.r / PX - 1, r.r * 0.42 / PX - 0.5, r.color);
      }
      ctx.globalAlpha = 1;
    }
    draw(ctx) {
      const ps = this.parts;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]; if (!p.on) continue;
        const k = p.life / p.max;
        const x = Math.round(p.x / PX), y = Math.round((p.y - p.z) / PX);
        if (p.type === FX_BLOOD) {
          ctx.fillStyle = p.color; ctx.fillRect(x, y, p.size, p.size);
        } else if (p.type === FX_DUST) {
          ctx.globalAlpha = k > 0.5 ? 0.5 : 0.25; ctx.fillStyle = p.color;
          const s = Math.round(p.size * (1 + (1 - k)));
          ctx.fillRect(x - (s >> 1), y - (s >> 1), s, s);
          ctx.globalAlpha = 1;
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]; if (!p.on) continue;
        const k = p.life / p.max;
        const x = Math.round(p.x / PX), y = Math.round((p.y - p.z) / PX);
        if (p.type === FX_SPARK || p.type === FX_SHARD) {
          ctx.globalAlpha = k > 0.4 ? 1 : 0.5; ctx.fillStyle = p.color;
          ctx.fillRect(x, y, 1, 1);
          ctx.fillRect(Math.round((p.x - p.vx * 0.02) / PX), Math.round((p.y - p.z + p.vz * 0.02) / PX), 1, 1);
        } else if (p.type === FX_EMBER || p.type === FX_AURA) {
          ctx.globalAlpha = k > 0.5 ? 0.9 : 0.5; ctx.fillStyle = p.color;
          ctx.fillRect(x, y, p.size, p.size);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      for (let i = 0; i < this.texts.length; i++) {
        const t = this.texts[i]; if (!t.on) continue;
        if (t.life < 0.25 && Math.floor(t.life * 30) % 2) continue;
        PF.draw(ctx, t.text, t.x / PX, (t.y - t.z) / PX, t.color, 'center', 1);
      }
    }
    drawAmbient(ctx) {
      for (let i = 0; i < this.ash.length; i++) {
        const a = this.ash[i];
        if (a.ember) { ctx.fillStyle = Math.sin(a.ph * 3) > 0 ? '#ff8a3a' : '#c04a1a'; }
        else { ctx.fillStyle = '#8a8698'; }
        ctx.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
      }
    }
  }

  // ===========================================================================
  // 13. ÁUDIO — tudo sintetizado com Web Audio
  // ===========================================================================
  class AudioManager {
    constructor(prefs) {
      this.ctx = null; this.master = null; this.sfx = null; this.amb = null; this.noiseBuf = null; this.ambNodes = null;
      this.volume = prefs.volume; this.muted = prefs.muted; this.ambientOn = prefs.ambient;
      this.AC = window.AudioContext || window.webkitAudioContext || null;
      this.failed = !this.AC;
    }
    status() {
      if (!this.AC) return 'Web Audio não suportado: o jogo segue sem som.';
      if (this.failed) return 'O áudio falhou ao iniciar: o jogo segue sem som.';
      if (!this.ctx) return 'O som liga na primeira tecla ou clique.';
      return '';
    }
    unlock() {
      if (this.failed) return;
      try {
        if (!this.ctx) {
          const c = new this.AC();
          this.ctx = c;
          const comp = c.createDynamicsCompressor();
          comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
          this.master = c.createGain(); this.master.connect(comp); comp.connect(c.destination);
          this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
          this.amb = c.createGain(); this.amb.gain.value = 0; this.amb.connect(this.master);
          const len = Math.floor(c.sampleRate * 1.5);
          this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
          const data = this.noiseBuf.getChannelData(0);
          for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
          this.applyVolume();
          if (this.ambientOn) this.startAmbient();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      } catch (err) {
        this.failed = true;
        console.warn('Áudio indisponível:', err);
      }
    }
    applyVolume() {
      if (!this.ctx) return;
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
    }
    setVolume(v) { this.volume = clamp(v, 0, 1); this.applyVolume(); }
    setMuted(m) { this.muted = !!m; this.applyVolume(); }
    setAmbient(on) { this.ambientOn = !!on; if (!this.ctx) return; if (on) this.startAmbient(); else this.stopAmbient(); }

    startAmbient() {
      if (!this.ctx || this.ambNodes) return;
      const c = this.ctx, t = c.currentTime, nodes = [];
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.connect(this.amb);
      [55, 82.6, 110.3].forEach((f, i) => {
        const o = c.createOscillator(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f;
        const g = c.createGain(); g.gain.value = i === 2 ? 0.012 : 0.03;
        const lfo = c.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03;
        const lg = c.createGain(); lg.gain.value = g.gain.value * 0.6;
        lfo.connect(lg); lg.connect(g.gain);
        o.connect(g); g.connect(lp); o.start(t); lfo.start(t);
        nodes.push(o, lfo);
      });
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.8;
      const ng = c.createGain(); ng.gain.value = 0.035;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
      const lg = c.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(bp.frequency);
      n.connect(bp); bp.connect(ng); ng.connect(this.amb); n.start(t); lfo.start(t);
      nodes.push(n, lfo);
      this.ambNodes = nodes;
      this.amb.gain.cancelScheduledValues(t);
      this.amb.gain.setTargetAtTime(0.9, t, 1.2);
    }
    stopAmbient() {
      if (!this.ctx || !this.ambNodes) return;
      const t = this.ctx.currentTime, nodes = this.ambNodes;
      this.ambNodes = null;
      this.amb.gain.cancelScheduledValues(t);
      this.amb.gain.setTargetAtTime(0, t, 0.3);
      nodes.forEach(nd => { try { nd.stop(t + 1.5); } catch (e) { /* já parado */ } });
    }

    osc(type, f0, f1, t0, dur, peak, filterFreq) {
      const c = this.ctx;
      const o = c.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.01, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      if (filterFreq) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq; o.connect(f); f.connect(g); }
      else o.connect(g);
      g.connect(this.sfx);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
    noise(t0, dur, peak, ftype, f0, f1, q, attack) {
      const c = this.ctx;
      const src = c.createBufferSource(); src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = ftype; f.Q.value = q || 1;
      f.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + (attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(this.sfx);
      src.start(t0, Math.random() * Math.max(0, 1.4 - dur)); src.stop(t0 + dur + 0.05);
    }
    bell(t0, f, peak, dur) {
      this.osc('sine', f, f, t0, dur, peak);
      this.osc('sine', f * 2.76, f * 2.76, t0, dur * 0.5, peak * 0.35);
      this.osc('sine', f * 5.4, f * 5.4, t0, dur * 0.25, peak * 0.15);
    }

    play(name) {
      if (!this.ctx || this.failed || this.muted || this.ctx.state !== 'running') return;
      const fn = SFX[name];
      if (!fn) return;
      try { fn(this, this.ctx.currentTime + 0.005, rand(0.92, 1.08)); } catch (err) { /* som é cosmético; nunca derruba o jogo */ }
    }
  }

  // Receitas de efeitos sonoros: (áudio, tempo, variação de afinação)
  const SFX = {
    light: (a, t, v) => { a.noise(t, 0.13, 0.32, 'bandpass', 2600 * v, 700 * v, 1.4); a.osc('triangle', 520 * v, 260 * v, t, 0.08, 0.035); },
    heavy: (a, t, v) => { a.noise(t, 0.3, 0.42, 'bandpass', 1500 * v, 280 * v, 1.0, 0.04); a.osc('sawtooth', 110 * v, 55, t, 0.26, 0.05, 500); },
    hit: (a, t, v) => { a.noise(t, 0.07, 0.5, 'highpass', 1800 * v, 900, 0.7); a.osc('sine', 190 * v, 55, t, 0.14, 0.35); },
    hitHeavy: (a, t, v) => { a.noise(t, 0.14, 0.6, 'lowpass', 2600 * v, 400, 0.8); a.osc('sine', 130 * v, 38, t, 0.28, 0.55); a.osc('square', 72, 40, t, 0.08, 0.06, 900); },
    hurt: (a, t, v) => { a.osc('sawtooth', 260 * v, 120, t, 0.2, 0.09, 1600); a.noise(t, 0.12, 0.35, 'bandpass', 900, 400, 1.2); a.osc('sine', 90, 50, t, 0.2, 0.3); },
    dodge: (a, t, v) => { a.noise(t, 0.18, 0.2, 'bandpass', 500 * v, 2400 * v, 1.2, 0.03); },
    parryStance: (a, t, v) => { a.osc('triangle', 900 * v, 1100 * v, t, 0.06, 0.03); },
    parry: (a, t, v) => { a.osc('triangle', 1250 * v, 1220 * v, t, 0.24, 0.12); a.osc('triangle', 1870 * v, 1850 * v, t, 0.2, 0.08); a.noise(t, 0.04, 0.3, 'highpass', 3000, 3000, 0.7); },
    perfect: (a, t) => {
      [880, 1320, 1760, 2640].forEach((f, i) => a.osc('sine', f, f, t + i * 0.015, 0.9, 0.11 / (i * 0.5 + 1)));
      a.osc('sine', 70, 35, t, 0.5, 0.45); a.noise(t, 0.06, 0.35, 'highpass', 4000, 4000, 0.7);
    },
    special: (a, t) => {
      a.noise(t, 0.45, 0.3, 'lowpass', 200, 3000, 2, 0.3);
      a.osc('triangle', 220, 220, t, 1.2, 0.05); a.osc('triangle', 329.6, 329.6, t + 0.05, 1.1, 0.04);
      a.osc('sawtooth', 55, 40, t, 0.6, 0.06, 300);
    },
    slam: (a, t) => { a.noise(t, 0.6, 0.6, 'lowpass', 1600, 90, 0.8); a.osc('sine', 62, 24, t, 0.65, 0.7); },
    enemyDeath: (a, t, v) => { a.noise(t, 0.4, 0.3, 'lowpass', 1200 * v, 150, 1); a.osc('sawtooth', 140 * v, 45, t, 0.45, 0.06, 700); },
    enemySwing: (a, t, v) => { a.noise(t, 0.16, 0.2, 'bandpass', 1000 * v, 380, 1.2, 0.02); },
    beastBite: (a, t, v) => { a.noise(t, 0.1, 0.25, 'bandpass', 700 * v, 1800, 2); a.osc('sawtooth', 180 * v, 90, t, 0.12, 0.05, 1200); },
    windup: (a, t, v) => { a.osc('sine', 1900 * v, 2300 * v, t, 0.12, 0.025); },
    bossWindup: (a, t, v) => { a.osc('sine', 1400 * v, 1700 * v, t, 0.18, 0.03); a.osc('sawtooth', 70, 60, t, 0.35, 0.03, 300); },
    crimson: (a, t) => { a.osc('sawtooth', 220, 180, t, 0.4, 0.05, 900); a.osc('sawtooth', 233, 190, t, 0.4, 0.04, 900); },
    bossSwing: (a, t, v) => { a.noise(t, 0.32, 0.45, 'bandpass', 900 * v, 220, 1.0, 0.04); },
    charge: (a, t) => { a.noise(t, 0.8, 0.3, 'lowpass', 400, 1400, 1, 0.1); a.osc('sawtooth', 60, 90, t, 0.8, 0.05, 400); },
    bossIntro: (a, t) => { a.osc('sawtooth', 55, 52, t, 2.4, 0.12, 380); a.osc('sawtooth', 82.4, 80, t + 0.1, 2.2, 0.09, 380); a.bell(t + 0.2, 110, 0.25, 3.5); },
    bossRoar: (a, t) => { a.noise(t, 1.3, 0.45, 'bandpass', 320, 110, 1.5, 0.15); a.osc('sawtooth', 72, 44, t, 1.3, 0.12, 500); },
    victory: (a, t) => { [220, 261.6, 329.6, 440, 523.3].forEach((f, i) => a.bell(t + i * 0.32, f, 0.16, 2.6)); },
    defeat: (a, t) => { [110, 98, 82.4].forEach((f, i) => a.bell(t + i * 0.9, f, 0.22, 3.2)); },
    ui: (a, t) => { a.osc('square', 880, 880, t, 0.05, 0.03, 3000); },
    levelUp: (a, t) => { [523.3, 659.3, 784, 1046.5].forEach((f, i) => a.osc('square', f, f, t + i * 0.08, 0.18, 0.04, 4000)); },
    stagger: (a, t) => { a.osc('square', 320, 140, t, 0.16, 0.04, 1500); a.noise(t, 0.1, 0.2, 'bandpass', 1500, 600, 2); },
    block: (a, t) => { a.osc('triangle', 600, 580, t, 0.12, 0.08); a.noise(t, 0.05, 0.25, 'highpass', 2500, 2500, 0.7); },
    denied: (a, t) => { a.osc('square', 160, 120, t, 0.15, 0.04, 800); },
  };

  // ===========================================================================
  // 14. SALVAMENTO LOCAL
  // ===========================================================================
  const SAVE_KEY = 'ultima-luz.save.v1';
  function defaultSave() {
    return { version: 1, bestScore: 0, bestTime: 0, runsCompleted: 0, highestWave: 0, volume: 0.7, muted: false, ambient: true, checkpoint: null };
  }

  class SaveManager {
    constructor() {
      this.available = this.probe();
      this.data = this.load();
    }
    probe() {
      try { const k = '__ul_probe'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; }
      catch (e) { return false; }
    }
    load() {
      const d = defaultSave();
      if (!this.available) return d;
      let raw = null;
      try { raw = window.localStorage.getItem(SAVE_KEY); } catch (e) { return d; }
      if (!raw) return d;
      try { return SaveManager.validate(JSON.parse(raw)); }
      catch (e) { console.warn('Salvamento corrompido ignorado.', e); return d; }
    }
    static validate(o) {
      const d = defaultSave();
      if (!o || typeof o !== 'object') return d;
      const num = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : def);
      d.bestScore = Math.floor(num(o.bestScore, 0, 1e9, 0));
      d.bestTime = num(o.bestTime, 0, 1e6, 0);
      d.runsCompleted = Math.floor(num(o.runsCompleted, 0, 1e6, 0));
      d.highestWave = Math.floor(num(o.highestWave, 0, WAVES.length, 0));
      d.volume = num(o.volume, 0, 1, 0.7);
      d.muted = o.muted === true;
      d.ambient = o.ambient !== false;
      d.checkpoint = SaveManager.validateCheckpoint(o.checkpoint);
      return d;
    }
    static validateCheckpoint(c) {
      if (!c || typeof c !== 'object') return null;
      const int = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(clamp(v, min, max)) : null);
      const wave = int(c.wave, 0, WAVES.length - 1), level = int(c.level, 1, 99);
      if (wave === null || level === null || !c.upgrades || typeof c.upgrades !== 'object') return null;
      const up = {};
      for (const id of UPGRADE_IDS) { const v = int(c.upgrades[id], 0, UPGRADES[id].max); up[id] = v === null ? 0 : v; }
      return {
        wave, level, upgrades: up,
        xp: int(c.xp, 0, 1e6) || 0, pending: int(c.pending, 0, 10) || 0,
        score: int(c.score, 0, 1e9) || 0, kills: int(c.kills, 0, 1e6) || 0, xpGained: int(c.xpGained, 0, 1e7) || 0,
        time: typeof c.time === 'number' && Number.isFinite(c.time) ? clamp(c.time, 0, 1e6) : 0,
        maxCombo: int(c.maxCombo, 0, 1e6) || 0, parries: int(c.parries, 0, 1e6) || 0, damageTaken: int(c.damageTaken, 0, 1e7) || 0,
      };
    }
    save() {
      if (!this.available) return false;
      try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); return true; }
      catch (e) { console.warn('Não foi possível salvar.', e); return false; }
    }
    erase() {
      const keep = { volume: this.data.volume, muted: this.data.muted, ambient: this.data.ambient };
      this.data = Object.assign(defaultSave(), keep);
      return this.save();
    }
  }

  // ===========================================================================
  // 15. PROGRESSÃO
  // ===========================================================================
  class Progression {
    constructor() { this.reset(); }
    reset() {
      this.level = 1; this.xp = 0; this.upgrades = { blade: 0, vigor: 0, discipline: 0 }; this.pending = 0;
      this.score = 0; this.kills = 0; this.xpGained = 0; this.maxCombo = 0; this.damageTaken = 0; this.time = 0; this.parries = 0;
    }
    xpToNext() { return PROGRESSION.xpToNext(this.level); }
    addXp(n) {
      this.xp += n; this.xpGained += n;
      let gained = 0;
      while (this.xp >= this.xpToNext()) { this.xp -= this.xpToNext(); this.level++; this.pending++; gained++; }
      return gained;
    }
    canUpgrade(id) { return this.upgrades[id] < UPGRADES[id].max; }
    anyUpgradeAvailable() { return UPGRADE_IDS.some(id => this.canUpgrade(id)); }
    applyUpgrade(id) {
      if (!this.canUpgrade(id) || this.pending <= 0) return false;
      this.upgrades[id]++; this.pending--;
      return true;
    }
    toCheckpoint(wave) {
      return {
        wave, level: this.level, xp: this.xp, upgrades: Object.assign({}, this.upgrades), pending: this.pending,
        score: this.score, kills: this.kills, xpGained: this.xpGained, time: this.time,
        maxCombo: this.maxCombo, parries: this.parries, damageTaken: this.damageTaken,
      };
    }
    fromCheckpoint(c) {
      this.reset();
      this.level = c.level; this.xp = c.xp; this.upgrades = Object.assign({}, c.upgrades); this.pending = c.pending;
      this.score = c.score; this.kills = c.kills; this.xpGained = c.xpGained; this.time = c.time;
      this.maxCombo = c.maxCombo; this.parries = c.parries; this.damageTaken = c.damageTaken;
    }
  }

  // ===========================================================================
  // 16. DIRETOR DE ONDAS
  // ===========================================================================
  class WaveDirector {
    constructor(game) { this.g = game; this.reset(); }
    reset() { this.index = 0; this.phase = 'idle'; this.t = 0; this.queue = []; this.spawnT = 0; this.wave = null; }
    start(index, narrative) {
      this.reset();
      this.index = index;
      if (narrative) { this.phase = 'narrative'; this.g.hud.showNarrative(true); }
      else this.beginWave();
    }
    skipNarrative() { if (this.phase === 'narrative') this.t = NARRATIVE_DURATION; }
    beginWave() {
      const g = this.g;
      this.wave = WAVES[this.index];
      this.phase = 'announce'; this.t = 0; this.spawnT = 0;
      this.queue = this.wave.spawns ? this.wave.spawns.map(s => ({ type: s[0], delay: s[1] })) : [];
      g.hud.showNarrative(false);
      g.hud.banner(this.wave.title, this.wave.subtitle, 2.4);
      g.hud.showHint(this.index === 0);
      g.saveCheckpoint(this.index);
      if (this.wave.boss) g.spawnBoss();
    }
    remaining() { return this.queue.length + this.g.aliveEnemies(); }
    update(dt) {
      const g = this.g;
      this.t += dt;
      switch (this.phase) {
        case 'narrative':
          if (this.t >= NARRATIVE_DURATION) this.beginWave();
          break;
        case 'announce':
          if (this.t >= 1.6) { this.phase = 'fight'; this.t = 0; }
          break;
        case 'fight': {
          if (this.wave.boss || g.player.dead) break; // vitória do chefe é tratada na morte dele
          this.spawnT += dt;
          if (this.queue.length && this.spawnT >= this.queue[0].delay && g.aliveEnemies() < this.wave.maxAlive) {
            g.spawnEnemy(this.queue.shift().type);
            this.spawnT = 0;
          }
          if (!this.queue.length && g.aliveEnemies() === 0) { this.phase = 'cleared'; this.t = 0; g.onWaveCleared(this.index); }
          break;
        }
        case 'cleared':
          if (this.t >= 1.8) {
            if (g.progress.pending > 0 && g.progress.anyUpgradeAvailable()) { this.phase = 'upgrade'; g.openUpgrade(); }
            else { g.progress.pending = 0; this.next(); }
          }
          break;
      }
    }
    upgradeDone() {
      const pr = this.g.progress;
      if (pr.pending > 0 && pr.anyUpgradeAvailable()) { this.g.openUpgrade(); return; }
      pr.pending = 0;
      this.next();
    }
    next() {
      if (this.index + 1 >= WAVES.length) return;
      this.index++;
      this.beginWave();
    }
  }

  // ===========================================================================
  // 17. HUD — desenhado no próprio canvas com a fonte bitmap
  // ===========================================================================
  class HUD {
    constructor(game) {
      this.g = game;
      this.live = document.getElementById('sr-live');
      this.reset();
    }
    reset() {
      this.bannerT = 0; this.bannerTitle = ''; this.bannerSub = ''; this.bannerDur = 1;
      this.toastT = 0; this.toastLines = []; this.toastKind = '';
      this.hints = {}; this.hintOn = false; this.narrOn = false; this.narrT = 0;
      this.ghostHp = 1; this.ghostBoss = 1; this.comboBump = 0; this.lastCombo = 0;
    }
    announce(text) { if (this.live) this.live.textContent = text; }
    banner(title, sub, dur) { this.bannerTitle = title; this.bannerSub = sub || ''; this.bannerT = dur; this.bannerDur = dur; this.announce(title + '. ' + (sub || '')); }
    toast(text, kind, dur) { this.toastLines = wrapText(text, 46); this.toastKind = kind || ''; this.toastT = dur || 3; this.announce(text); }
    hintOnce(key, text) {
      if (this.hints[key] || this.g.progressHintsSeen[key]) return;
      this.hints[key] = true; this.g.progressHintsSeen[key] = true;
      this.toast(text, '', 4.5);
    }
    showHint(on) { this.hintOn = on; }
    showNarrative(on) { this.narrOn = on; this.narrT = 0; if (on) this.announce(NARRATIVE.join(' ')); }

    update(dt) {
      if (this.bannerT > 0) this.bannerT -= dt;
      if (this.toastT > 0) this.toastT -= dt;
      if (this.narrOn) this.narrT += dt;
      if (this.comboBump > 0) this.comboBump -= dt;
      const g = this.g;
      if (!g.runActive) return;
      const p = g.player, hpR = p.hp / p.maxHp;
      this.ghostHp = hpR > this.ghostHp ? hpR : approach(this.ghostHp, hpR, dt * 0.6);
      if (g.boss) { const r = g.boss.hp / g.boss.maxHp; this.ghostBoss = approach(this.ghostBoss, r, dt * 0.4); }
      if (g.combo !== this.lastCombo) { if (g.combo > this.lastCombo) this.comboBump = 0.12; this.lastCombo = g.combo; }
      if (p.blood >= PLAYER_BASE.specialCost && !p.dead) this.hintOnce('special', 'Sangue suficiente! Aperte O para o Rito de Sangue: dano em área ao seu redor.');
    }

    bar(ctx, x, y, w, h, frac, ghost, fill, fillHi, back) {
      ctx.fillStyle = '#000000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = back || '#1c1626'; ctx.fillRect(x, y, w, h);
      if (ghost > frac) { ctx.fillStyle = '#e8d8b0'; ctx.fillRect(x, y, Math.round(w * clamp(ghost, 0, 1)), h); }
      const fw = Math.round(w * clamp(frac, 0, 1));
      ctx.fillStyle = fill; ctx.fillRect(x, y, fw, h);
      if (h > 2) { ctx.fillStyle = fillHi; ctx.fillRect(x, y, fw, 1); }
    }

    draw(ctx) {
      const g = this.g, p = g.player, pr = g.progress, t = g.time;
      if (this.narrOn) { this.drawNarrative(ctx); return; }
      // painel do Guardião
      ctx.globalAlpha = 0.7; ctx.fillStyle = '#05040a'; ctx.fillRect(2, 2, 172, 34); ctx.globalAlpha = 1;
      ctx.fillStyle = '#5a5470'; ctx.fillRect(3, 3, 24, 24);
      ctx.fillStyle = '#120f1c'; ctx.fillRect(4, 4, 22, 22);
      // retrato: elmo do Guardião em pixels
      ctx.fillStyle = '#3d4260'; ctx.fillRect(9, 8, 12, 13); ctx.fillRect(8, 11, 14, 9);
      ctx.fillStyle = '#9aa3c8'; ctx.fillRect(14, 8, 5, 3);
      ctx.fillStyle = '#05050a'; ctx.fillRect(10, 14, 11, 2);
      ctx.fillStyle = '#e8f4ff'; ctx.fillRect(15, 14, 4, 1);
      ctx.fillStyle = '#c8203a'; ctx.fillRect(5, 7, 4, 2); ctx.fillRect(9, 21, 12, 3);
      const hpR = p.hp / p.maxHp;
      const low = hpR < 0.3 && !p.dead;
      this.bar(ctx, 31, 6, 92, 6, hpR, this.ghostHp, low && Math.floor(t * 4) % 2 ? '#ff4050' : '#c8102a', '#ff6a78');
      PF.draw(ctx, Math.ceil(p.hp) + '/' + p.maxHp, 127, 5, low ? '#ff8a94' : '#f0e6d2', 'left');
      const ready = p.blood >= PLAYER_BASE.specialCost && !p.dead;
      this.bar(ctx, 31, 15, 92, 4, p.blood / PLAYER_BASE.bloodMax, 0, ready ? '#ff3048' : '#8a0c22', '#ff8090', '#140c14');
      ctx.fillStyle = '#efe6d4'; ctx.fillRect(31 + 46, 14, 1, 6);
      PF.draw(ctx, Math.floor(p.blood) + '', 127, 14, ready ? '#ff8a94' : '#b88a96', 'left');
      this.bar(ctx, 31, 22, 92, 2, pr.xp / pr.xpToNext(), 0, '#e0b860', '#e0b860');
      PF.draw(ctx, 'NV' + pr.level, 15, 28, '#e0b860', 'center');
      PF.draw(ctx, pr.xp + '/' + pr.xpToNext() + ' XP', 31, 27, '#9a90a8', 'left');
      if (ready && Math.floor(t * 3) % 2 === 0) PF.draw(ctx, '◆ RITO PRONTO: O', 4, 39, '#ff6070', 'left');
      // pontuação e onda
      PF.draw(ctx, String(pr.score).padStart(7, '0'), 316, 4, '#f0e6d2', 'right');
      const d = g.director, w = d.wave || WAVES[d.index];
      if (w) PF.draw(ctx, w.title + ' ' + (d.index + 1) + '/' + WAVES.length, 316, 13, '#e0b860', 'right');
      if (w && !w.boss) PF.draw(ctx, 'INIMIGOS ' + d.remaining(), 316, 22, '#9a90a8', 'right');
      // combo
      if (g.combo >= 3) {
        const s = this.comboBump > 0 ? 3 : 2;
        PF.draw(ctx, String(g.combo), 316, 34, '#ffffff', 'right', s, '#7a0a16');
        PF.draw(ctx, 'GOLPES', 316, 36 + 8 * s, '#ff9aa2', 'right');
      }
      // chefe
      const b = g.boss;
      if (b) {
        const inv = b.invulnerable();
        ctx.globalAlpha = 0.7; ctx.fillStyle = '#05040a'; ctx.fillRect(52, 152, 216, 25); ctx.globalAlpha = 1;
        PF.draw(ctx, BOSS_DEF.name, 56, 155, '#f0e6d2', 'left');
        PF.draw(ctx, b.state === 'DEAD' ? 'DERROTADO' : b.phase === 2 ? 'FÚRIA' : 'FASE I', 264, 155, b.phase === 2 ? '#ff6070' : '#9a90a8', 'right');
        this.bar(ctx, 56, 167, 208, 5, b.hp / b.maxHp, this.ghostBoss, b.phase === 2 ? '#ff2040' : '#a8102a', '#ff7080', inv ? '#3a4470' : null);
        ctx.fillStyle = '#efe6d4'; ctx.fillRect(56 + 104, 166, 1, 7);
      } else if (this.hintOn) {
        ctx.globalAlpha = 0.75; ctx.fillStyle = '#05040a'; ctx.fillRect(8, 168, 304, 11); ctx.globalAlpha = 1;
        PF.draw(ctx, 'J/K ATACAR · L ESQUIVA · I APARAR · O RITO · ESC', 160, 170, '#cfc6d8', 'center');
      }
      // faixa de anúncio
      if (this.bannerT > 0) {
        const k = Math.min(1, (this.bannerDur - this.bannerT) * 4, this.bannerT * 3);
        const hh = Math.round(30 * k);
        ctx.globalAlpha = 0.8; ctx.fillStyle = '#05040a'; ctx.fillRect(0, 76 - hh / 2, LW, hh); ctx.globalAlpha = 1;
        ctx.fillStyle = '#8a0c22'; ctx.fillRect(0, 76 - hh / 2, LW, 1); ctx.fillRect(0, 76 + hh / 2 - 1, LW, 1);
        if (k >= 1) {
          PF.draw(ctx, this.bannerTitle, 160, 63, '#f0e6d2', 'center', 2, '#3a0610');
          PF.draw(ctx, this.bannerSub, 160, 82, '#ff6070', 'center');
        }
      }
      // aviso
      if (this.toastT > 0 && this.toastLines.length) {
        const n = this.toastLines.length, bw = 288, bh = n * 10 + 6, bx = 16, by = 44;
        ctx.fillStyle = '#000000'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = this.toastKind === 'level' ? '#e0b860' : this.toastKind === 'warn' ? '#ff3048' : '#cfc6d8';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#100c1c'; ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
        for (let i = 0; i < n; i++) PF.draw(ctx, this.toastLines[i], 160, by + 4 + i * 10, this.toastKind === 'level' ? '#f3dfae' : '#f0e6d2', 'center');
      }
    }

    drawNarrative(ctx) {
      ctx.globalAlpha = 0.86; ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, LW, LH); ctx.globalAlpha = 1;
      let y = 30;
      const cols = ['#cfc6d8', '#cfc6d8', '#f0c9a0', '#ff8a94'];
      for (let i = 0; i < NARRATIVE.length; i++) {
        const start = i * 2.8, shown = Math.floor((this.narrT - start) * 34);
        const lines = wrapText(NARRATIVE[i], 48);
        let budget = shown;
        for (const line of lines) {
          if (budget > 0) PF.draw(ctx, line.slice(0, budget), 160, y, cols[i], 'center');
          budget -= line.length;
          y += 10;
        }
        y += 8;
      }
      if (Math.floor(this.narrT * 2) % 2 === 0) PF.draw(ctx, 'ENTER: PULAR', 314, 168, '#6a6080', 'right');
    }
  }

  // ===========================================================================
  // 18. RENDERIZAÇÃO — cenário em pixel art pré-renderizado + sprites ao vivo
  // ===========================================================================
  class PixBuf {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
      this.g = this.c.getContext('2d');
      this.img = this.g.createImageData(w, h); this.d = this.img.data;
    }
    px(x, y, col) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const i = (y * this.w + x) * 4, d = this.d;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    clear(x, y) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.d[(y * this.w + x) * 4 + 3] = 0; }
    on(x, y) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false; return this.d[(y * this.w + x) * 4 + 3] > 0; }
    rect(x, y, w, h, col) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, col); }
    dith(x, y, col, level) { if (bayer(x, y) < level) this.px(x, y, col); }
    // translucência em faixas (como a "color math" do SNES), sem pontilhado
    pxa(x, y, col, a) {
      x |= 0; y |= 0;
      if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const i = (y * this.w + x) * 4, d = this.d;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = a;
    }
    mix(x, y, col, k) {
      x |= 0; y |= 0;
      if (k <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const i = (y * this.w + x) * 4, d = this.d;
      if (!d[i + 3]) return;
      d[i] += (col[0] - d[i]) * k; d[i + 1] += (col[1] - d[i + 1]) * k; d[i + 2] += (col[2] - d[i + 2]) * k;
    }
    line(x0, y0, x1, y1, col) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.px(x0, y0, col);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    done() { this.g.putImageData(this.img, 0, 0); return this.c; }
  }
  // Cores do cenário: C['#rrggbb'] devolve [r, g, b] (convertido uma vez e guardado).
  const C = new Proxy({}, { get: (cache, h) => cache[h] || (cache[h] = hexRgb(h)) });

  function archHalf(y, spring, hw) {
    if (y >= spring) return hw;
    const dy = spring - y, v = 4 * hw * hw - dy * dy;
    return v < 0 ? -1 : Math.sqrt(v) - hw; // arco ogival (gótico) de verdade
  }

  const BRAZIERS = [{ x: 51, y: 110 }, { x: 269, y: 110 }];
  const ARCHES = [{ cx: 44, hw: 20 }, { cx: 111, hw: 23 }, { cx: 209, hw: 23 }, { cx: 276, hw: 20 }];
  const ROSE = { x: 160, y: 40, r: 19 };
  const MOON = { x: 238, y: 34 };

  class Renderer {
    constructor(game, canvas) {
      this.g = game; this.canvas = canvas;
      canvas.width = LW; canvas.height = LH;
      this.ctx = canvas.getContext('2d', { alpha: false });
      if (!this.ctx) throw new Error('Canvas 2D não suportado neste navegador.');
      this.ctx.imageSmoothingEnabled = false;
      this.layers = null;
      this.drawList = []; this.camPar = 0;
      this.o = { ds: SPR, time: 0, capeFlow: 0, wGlow: 0, out: null };
      this.glow = { fire: this.makeGlow(255, 140, 50), red: this.makeGlow(230, 30, 50), cold: this.makeGlow(200, 215, 255) };
    }
    makeGlow(r, g, b) {
      // brilho em anéis de opacidade (sem gradiente suave), desenhado sempre em 64x64 sem escala
      const pb = new PixBuf(64, 64), col = [r, g, b], A = [0, 50, 95, 150];
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x - 31.5, y - 31.5) / 32;
        if (d < 1) pb.pxa(x, y, col, A[Math.min(3, Math.floor((1 - d) * 4))]);
      }
      return pb.done();
    }

    buildLayers() {
      const rng = mulberry32(1337), L = {};

      // --- céu com lua, estrelas e nuvens ---
      {
        const pb = new PixBuf(LW + 16, 110), SKY = ['#06051a', '#0c0a24', '#141130', '#1d163b', '#281b44', '#361f48', '#472245', '#5a2740', '#6e2d3a'].map(h => C[h]);
        for (let y = 0; y < pb.h; y++) {
          const tt = Math.min(1, y / 100) * (SKY.length - 1), i = Math.min(SKY.length - 2, Math.floor(tt)), f = tt - i;
          for (let x = 0; x < pb.w; x++) pb.px(x, y, bayer(x, y) < f ? SKY[i + 1] : SKY[i]);
        }
        for (let i = 0; i < 90; i++) { const x = rng() * pb.w, y = rng() * 70; pb.px(x, y, rng() < 0.3 ? C['#c8c8f0'] : C['#6a6a9a']); }
        for (let i = 0; i < 5; i++) { const x = 10 + rng() * (pb.w - 20), y = 5 + rng() * 40; pb.px(x, y, C['#c8c8f0']); pb.px(x - 1, y, C['#6a6a9a']); pb.px(x + 1, y, C['#6a6a9a']); pb.px(x, y - 1, C['#6a6a9a']); pb.px(x, y + 1, C['#6a6a9a']); }
        const mx = MOON.x + 8, my = MOON.y;
        for (let y = my - 34; y <= my + 34; y++) for (let x = mx - 34; x <= mx + 34; x++) {
          const d = Math.hypot(x - mx, y - my);
          if (d > 13 && d < 34) pb.mix(x, y, C['#5a5890'], d < 17 ? 0.5 : d < 23 ? 0.3 : 0.15);
        }
        for (let y = my - 13; y <= my + 13; y++) for (let x = mx - 13; x <= mx + 13; x++) {
          const dx = x - mx, dy = y - my, d = Math.hypot(dx, dy);
          if (d > 13) continue;
          const sh = dx * 0.7 + dy * 0.5;
          let col = C['#e9e4cf'];
          if (sh > 6) col = C['#c8c0a6']; else if (sh > 3 && bayer(x, y) < 0.5) col = C['#c8c0a6'];
          if (Math.hypot(dx + 5, dy + 5) < 3) col = C['#fffbe6'];
          pb.px(x, y, col);
        }
        for (const [cx, cy, r] of [[mx - 3, my + 3, 2.5], [mx + 4, my - 4, 1.8], [mx + 5, my + 5, 1.5], [mx - 6, my - 2, 1.2]]) {
          for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) if (Math.hypot(x - cx, y - cy) <= r) pb.px(x, y, C['#bfb79c']);
        }
        for (let k = 0; k < 9; k++) {
          const cy = 10 + Math.floor(rng() * 64), cx = rng() * pb.w, len = 30 + rng() * 70, th = 2 + Math.floor(rng() * 4);
          for (let r = 0; r < th; r++) {
            const half = len / 2 * Math.sqrt(1 - Math.pow((r - th / 2) / (th / 2 + 0.5), 2));
            for (let x = Math.round(cx - half); x <= cx + half; x++) pb.px(x, cy + r, r === 0 ? C['#2c2850'] : (r === 1 ? C['#221d40'] : C['#120f26']));
          }
        }
        L.sky = pb.done();
      }

      // --- montanhas e torres distantes ---
      {
        const pb = new PixBuf(LW + PAD_FAR * 2, 100);
        let h = 80;
        for (let x = 0; x < pb.w; x++) {
          h = clamp(h + (rng() - 0.5) * 3, 70, 88);
          for (let y = Math.round(h); y < pb.h; y++) pb.px(x, y, C['#120e22']);
          pb.px(x, Math.round(h), C['#1e1834']);
        }
        const towers = [[38, 42, 7], [52, 30, 5], [60, 51, 8], [71, 35, 4], [130, 60, 3], [150, 27, 3], [252, 47, 6], [265, 34, 4], [278, 54, 7], [325, 41, 5]];
        for (const [tx0, th, tw] of towers) {
          const tx = tx0 + PAD_FAR;
          pb.rect(tx, 86 - th, tw, th + 4, C['#0e0b1c']);
          for (let y = 86 - th; y < 90; y++) pb.px(tx + tw - 1, y, C['#1c1730']);
          for (let r = 0; r < tw * 2; r++) { const half = Math.floor((tw - r / 2) / 2); pb.rect(tx + Math.floor(tw / 2) - half, 86 - th - r, half * 2 + 1, 1, C['#0e0b1c']); }
          for (let k = 0; k < 2; k++) if (rng() < 0.6) pb.px(tx + 1 + Math.floor(rng() * (tw - 2)), 86 - th + 4 + Math.floor(rng() * (th - 6)), rng() < 0.5 ? C['#e07a30'] : C['#a04a20']);
        }
        L.far = pb.done();
      }

      // --- nave da catedral em ruínas ---
      {
        const pb = new PixBuf(LW + PAD_MID * 2, 104), w = pb.w, h = pb.h;
        const tops = [];
        let tp = 16;
        for (let x = 0; x < w; x++) {
          tp = clamp(tp + (rng() - 0.5) * 3, 12, 22);
          let t = tp;
          if (x > 140 + PAD_MID && x < 180 + PAD_MID) t = 6 + Math.abs(x - 160 - PAD_MID) * 0.25;   // frontão
          if (x > 240 + PAD_MID && x < 272 + PAD_MID) t = 40 + Math.sin(x * 0.7) * 6 + rng() * 6;  // desabado
          if (x < 10) t = 30 + rng() * 6;
          tops.push(Math.round(t));
        }
        for (let x = 0; x < w; x++) {
          for (let y = tops[x]; y < h; y++) {
            const row = Math.floor(y / 4), bx = (x + (row % 2) * 4) % 8;
            let col = C['#2a2640'];
            if (y % 4 === 3 || bx === 7) col = C['#1c192c'];
            else if (y % 4 === 0 && bx === 0) col = C['#37324f'];
            else if (((row * 31 + Math.floor((x + (row % 2) * 4) / 8) * 17) % 7) === 0) col = C['#24203a'];
            if (x > 230 && col !== C['#1c192c'] && bayer(x, y) < (x - 230) / 160) col = C['#3a3556'];
            pb.px(x, y, col);
          }
          pb.px(x, tops[x], C['#3d3858']);
        }
        for (const a of ARCHES) {
          const cx = a.cx + PAD_MID, spring = 64, apex = spring - Math.ceil(Math.sqrt(3) * (a.hw + 3));
          for (let y = apex; y < h; y++) {
            const fh = archHalf(y, spring, a.hw + 3), ih = archHalf(y, spring, a.hw);
            if (fh >= 0) for (let x = Math.round(cx - fh); x <= Math.round(cx + fh); x++) pb.px(x, y, C['#3d3858']);
            if (fh >= 0) pb.px(Math.round(cx + fh), y, C['#55507a']);
            if (ih >= 0) for (let x = Math.round(cx - ih); x <= Math.round(cx + ih); x++) pb.clear(x, y);
          }
          const glass = ['#8c1a2c', '#c47a2a', '#2a3c8c', '#5a1a5a'].map(k => C[k]);
          for (let y = apex; y < spring + 10; y++) {
            const ih = archHalf(y, spring, a.hw);
            if (ih < 0) continue;
            for (let x = Math.round(cx - ih); x <= Math.round(cx + ih); x++) {
              const edge = Math.min(x - (cx - ih), (cx + ih) - x);
              if (edge < 4 && rng() < 0.55 - edge * 0.12) pb.px(x, y, glass[Math.floor(rng() * 4)]);
            }
          }
          for (let y = apex + 2; y < spring + 10; y++) pb.px(cx, y, C['#1a1828']);
          for (let x = Math.round(cx - a.hw); x <= cx + a.hw; x++) pb.px(x, spring - 5, C['#1a1828']);
          for (const sx of [-1, 1]) {
            const px0 = Math.round(cx + sx * (a.hw + 6)) - 2;
            pb.rect(px0, 30, 4, h - 30, C['#33304a']); pb.rect(px0 + 3, 30, 1, h - 30, C['#4a4566']);
            pb.rect(px0 - 2, 62, 8, 3, C['#3d3858']); pb.rect(px0 - 2, h - 4, 8, 4, C['#3d3858']);
          }
        }
        {
          const cx = ROSE.x + PAD_MID, cy = ROSE.y, r = ROSE.r, glass = ['#8c1a2c', '#2a3c8c', '#c47a2a'].map(k => C[k]);
          for (let y = cy - r - 3; y <= cy + r + 3; y++) for (let x = cx - r - 3; x <= cx + r + 3; x++) {
            const d = Math.hypot(x - cx, y - cy);
            if (d <= r + 2.5 && d > r) pb.px(x, y, d > r + 1.5 ? C['#55507a'] : C['#3d3858']);
            else if (d <= r) {
              const a = (Math.atan2(y - cy, x - cx) + TAU) % TAU, sector = Math.floor(a / TAU * 12);
              const spoke = Math.abs(((a / TAU * 12) % 1) - 0.5) > 0.44 && sector !== 3 && sector !== 4;
              if (d < 5.5 && d > 4.2) pb.px(x, y, C['#1a1828']);
              else if (spoke && d > 5) pb.px(x, y, C['#1a1828']);
              else if (d > 5 && (sector * 7) % 5 < 3 && !(sector === 3 || sector === 4)) pb.px(x, y, glass[sector % 3]);
              else pb.clear(x, y);
            }
          }
        }
        for (let k = 0; k < 50; k++) {
          const rx = Math.floor(rng() * w), ry = 96 + Math.floor(rng() * 6), rs = 2 + Math.floor(rng() * 5);
          for (let y = 0; y < rs; y++) for (let x = -rs + y; x <= rs - y; x++) pb.px(rx + x, ry + rs - y, y === rs - 1 ? C['#2a2640'] : C['#16141f']);
        }
        for (let y = 84; y < h; y++) for (let x = 0; x < w; x++) pb.mix(x, y, C['#0c0a14'], Math.floor((y - 84) / 5) * 0.12);
        L.mid = pb.done();
      }

      // --- feixes de luar ---
      {
        const pb = new PixBuf(LW, LH);
        for (const [c0, bw] of [[250, 12], [222, 8], [290, 7]]) {
          for (let y = 0; y < 150; y++) for (let x = 0; x < LW; x++) {
            const u = x + y * 0.55 - c0;
            if (Math.abs(u) < bw) pb.pxa(x, y, C['#8a90c8'], Math.abs(u) < bw * 0.5 && y < 100 ? 34 : 18);
          }
        }
        L.rays = pb.done();
      }

      // --- piso de pedra em perspectiva ---
      {
        const pb = new PixBuf(LW, LH - FLOOR_PY), w = pb.w, h = pb.h;
        const bases = ['#2b2839', '#272434', '#302c40', '#25222f'].map(k => C[k]);
        let y0 = 0, rh = 3, row = 0;
        while (y0 < h) {
          const tw = Math.round(rh * 3.6) + 3, off = (row % 2) * Math.floor(tw / 2);
          for (let y = y0; y < Math.min(h, y0 + rh); y++) {
            for (let x = 0; x < w; x++) {
              const shift = Math.round((x - 160) * (y - y0) / 160);  // juntas inclinadas rumo ao ponto de fuga
              const tx = x + off - shift, ti = Math.floor(tx / tw), jx = ((tx % tw) + tw) % tw;
              let col = bases[(ti * 7 + row * 3) & 3];
              if (y === y0 || jx === 0) col = C['#16141e'];
              else if (y === y0 + 1 || jx === 1) col = C['#3a3650'];
              pb.px(x, y, col);
            }
          }
          y0 += rh; rh = Math.min(14, rh + (row % 2 ? 1 : 0) + (row > 6 ? 1 : 0)); row++;
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const d = Math.hypot((x - 190) / 120, (y - 50) / 22);
          if (d < 1) pb.mix(x, y, C['#5a5888'], d < 0.55 ? 0.28 : 0.14);
        }
        for (let k = 0; k < 6; k++) {
          const sx = 40 + rng() * 240, sy = 20 + rng() * 55, sw = 5 + rng() * 9;
          for (let y = -2; y <= 2; y++) for (let x = -sw; x <= sw; x++) if ((x / sw) ** 2 + (y / 2.5) ** 2 < 1 && rng() < 0.85) pb.px(sx + x, sy + y, Math.abs(x) < sw * 0.5 ? C['#55101a'] : C['#3e0c14']);
        }
        for (let k = 0; k < 18; k++) {
          let cx = rng() * w, cy = 6 + rng() * (h - 8);
          for (let s = 0; s < 8; s++) { pb.px(cx, cy, C['#14121b']); cx += rng() < 0.5 ? 1 : -1; cy += rng() < 0.3 ? 1 : 0; }
        }
        for (const b of BRAZIERS) {
          const bx = b.x, by = b.y - FLOOR_PY;
          pb.line(bx - 4, by + 9, bx, by + 1, C['#14121a']); pb.line(bx + 4, by + 9, bx, by + 1, C['#14121a']); pb.line(bx, by + 1, bx, by + 10, C['#14121a']);
          pb.rect(bx - 5, by - 2, 11, 2, C['#3a2f38']); pb.rect(bx - 4, by, 9, 1, C['#3a2f38']); pb.rect(bx - 5, by - 3, 11, 1, C['#5a4a52']);
          pb.rect(bx - 5, by + 10, 11, 1, C['#0f0d16']);
        }
        for (let k = 0; k < 24; k++) {
          const sx = rng() < 0.5 ? rng() * 70 : w - rng() * 70, sy = 8 + rng() * (h - 12), ss = 1 + Math.floor(rng() * 3);
          pb.rect(sx, sy, ss + 1, ss, C['#16141f']); pb.rect(sx, sy, ss + 1, 1, C['#3a3650']);
        }
        for (let y = 0; y < 8; y++) for (let x = 0; x < w; x++) pb.mix(x, y, C['#0c0a14'], 0.6 - Math.floor(y / 2) * 0.15);
        L.floor = pb.done();
      }

      // --- primeiro plano ---
      {
        const pb = new PixBuf(LW + PAD_FORE * 2, LH), w = pb.w, h = pb.h;
        for (let y = 0; y < h; y++) {
          const e = PAD_FORE + 11 + (y > 40 && y < 47 ? -3 : 0) + (y >= 47 && y < 52 ? 2 : 0) + (y >= 52 ? 3 : 0);
          for (let x = 0; x <= e; x++) pb.px(x, y, (y % 18 === 0 && x < e - 1) ? C['#100e18'] : C['#07060c']);
          pb.px(e, y, C['#24203a']);
        }
        for (const lx of [w - PAD_FORE - 18, w - PAD_FORE - 9]) {
          const len = lx > w - PAD_FORE - 12 ? 54 : 38;
          for (let y = 0; y < len; y += 3) {
            if ((y / 3) % 2) { pb.rect(lx, y, 1, 3, C['#0c0b12']); pb.px(lx, y + 1, C['#2a2640']); }
            else { pb.rect(lx - 1, y, 3, 2, C['#0c0b12']); pb.px(lx + 1, y, C['#2a2640']); }
          }
        }
        const branch = (x, y, a, len, wd) => {
          if (len < 3) return;
          const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
          for (let k = 0; k < wd; k++) pb.line(x, y + k, x2, y2 + k, C['#07060c']);
          branch(x2, y2, a + 0.4 + rng() * 0.3, len * 0.68, Math.max(1, wd - 1));
          branch(x2, y2, a - 0.3 - rng() * 0.3, len * 0.6, Math.max(1, wd - 1));
        };
        branch(w - 6, 2, Math.PI * 0.82, 20, 3);
        for (let x = 0; x < w; x++) {
          const top = h - 4 - Math.floor(rng() * 4) - (x < PAD_FORE + 30 || x > w - PAD_FORE - 34 ? 4 : 0);
          for (let y = top; y < h; y++) pb.px(x, y, y === top ? C['#16131f'] : C['#06050a']);
        }
        L.fore = pb.done();
      }

      // --- névoa pontilhada ---
      {
        const pb = new PixBuf(256, 50), blobs = [];
        for (let i = 0; i < 14; i++) blobs.push([rng() * 256, 12 + rng() * 26, 18 + rng() * 30]);
        for (let y = 0; y < 50; y++) for (let x = 0; x < 256; x++) {
          let dsum = 0;
          for (const [bx, by, br] of blobs) for (const ox of [-256, 0, 256]) { const d = Math.hypot(x - bx - ox, (y - by) * 2) / br; if (d < 1) dsum += 1 - d; }
          const lv = Math.min(3, Math.floor(dsum * 3));
          if (lv) pb.pxa(x, y, C['#9a98c0'], [0, 40, 75, 110][lv]);
        }
        L.fog = pb.done();
      }

      // --- vinhetas ---
      const vign = col => {
        const pb = new PixBuf(LW, LH);
        for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
          const d = Math.hypot((x - 160) / 175, (y - 95) / 110);
          const lv = Math.floor(clamp((d - 0.72) / 0.35, 0, 1) * 4);
          if (lv) pb.pxa(x, y, col, [0, 60, 120, 180, 220][lv]);
        }
        return pb.done();
      };
      L.vignette = vign(C['#000000']);
      L.redVignette = vign(C['#5a0010']);
      this.layers = L;
    }

    render(alpha) {
      const g = this.g, ctx = this.ctx, fx = g.effects;
      if (!this.layers) this.buildLayers();
      const L = this.layers;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, LW, LH);

      const run = g.runActive, time = run ? g.time : g.menuTime;
      if (run) {
        const ents = g.allEntities();
        for (let i = 0; i < ents.length; i++) { const e = ents[i]; e.rx = lerp(e.prevX, e.x, alpha); e.ry = lerp(e.prevY, e.y, alpha); }
      }
      const targetPar = run ? (g.player.rx - W / 2) / (W / 2) : Math.sin(g.menuTime * 0.15) * 0.6;
      this.camPar += (targetPar - this.camPar) * 0.06;
      const cp = this.camPar;
      let sx = 0, sy = 0;
      if (fx.shake > 0) { sx = Math.round((Math.random() * 2 - 1) * fx.shake / PX); sy = Math.round((Math.random() * 2 - 1) * fx.shake * 0.6 / PX); }

      ctx.save(); ctx.translate(sx, sy);
      ctx.drawImage(L.sky, -8, -4);
      this.drawStarTwinkle(ctx, time);
      ctx.drawImage(L.far, Math.round(-PAD_FAR - cp * 4), 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(time * 0.4);
      ctx.drawImage(L.rays, Math.round(-cp * 5), 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      const midX = Math.round(-PAD_MID - cp * 9);
      ctx.drawImage(L.mid, midX, 0);
      this.drawWindowGlow(ctx, time, midX + PAD_MID);
      ctx.drawImage(L.floor, 0, FLOOR_PY);
      this.drawBraziers(ctx, time, run);
      this.drawFog(ctx, time, 92, 0.45, 3, 0);
      if (run) {
        fx.drawFloor(ctx);
        this.drawHazards(ctx);
        this.drawTelegraphs(ctx);
        this.drawEntities(ctx);
        fx.draw(ctx);
      }
      ctx.drawImage(L.fore, Math.round(-PAD_FORE - cp * 18), 0);
      this.drawFog(ctx, time, 140, 0.3, 6, 80);
      fx.drawAmbient(ctx);
      ctx.restore();
      this.drawOverlays(ctx, run, time);
      if (run && g.hud && g.states.state !== 'VICTORY' && g.states.state !== 'GAME_OVER') g.hud.draw(ctx);
    }

    drawStarTwinkle(ctx, time) {
      for (let i = 0; i < 6; i++) {
        if (Math.sin(time * (1.3 + i * 0.4) + i * 2) < 0.7) continue;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect((i * 53 + 17) % LW, 6 + (i * 29) % 50, 1, 1);
      }
    }

    drawWindowGlow(ctx, time, ox) {
      const flick = 0.35 + 0.15 * Math.sin(time * 1.3) + 0.08 * Math.sin(time * 4.7);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = flick;
      ctx.drawImage(this.glow.red, ox + ROSE.x - 32, ROSE.y - 32, 64, 64);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

    drawBraziers(ctx, time, run) {
      for (let i = 0; i < BRAZIERS.length; i++) {
        const b = BRAZIERS[i];
        const f = 0.85 + 0.15 * Math.sin(time * 9 + i * 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 * f;
        ctx.drawImage(this.glow.fire, b.x - 32, b.y - 36, 64, 64);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        const fy = b.y - 3;
        for (let x = -4; x <= 4; x++) {
          const hgt = Math.max(0, Math.round((8 - Math.abs(x) * 1.7) * (0.75 + 0.25 * Math.sin(time * 12 + x * 1.7 + i * 3)) + Math.sin(time * 23 + x * 2.1) * 0.8));
          for (let k = 0; k < hgt; k++) {
            const u = k / Math.max(1, hgt);
            ctx.fillStyle = Math.abs(x) <= 1 && u < 0.5 ? '#ffe8a0' : u < 0.45 ? '#f5a030' : u < 0.8 ? '#d0501a' : '#7a1c08';
            ctx.fillRect(b.x + x, fy - k, 1, 1);
          }
        }
        if (run && Math.random() < 0.1) this.g.effects.embers(b.x * PX, b.y * PX, 30, 1, '#ff9a4a');
      }
    }

    drawFog(ctx, time, y, alpha, speed, phase) {
      const fog = this.layers.fog;
      const off = Math.round(((time * speed + phase) % 256 + 256) % 256);
      ctx.globalAlpha = alpha;
      for (let x = -off; x < LW; x += 256) ctx.drawImage(fog, x, y);
      ctx.globalAlpha = 1;
    }

    drawHazards(ctx) {
      const hz = this.g.hazards;
      for (let i = 0; i < hz.length; i++) {
        const h = hz[i], r = h.r / PX, x = h.x / PX, y = h.y / PX;
        pxEllipseStroke(ctx, x, y, r, r * 0.42, '#ff3040');
        pxEllipseStroke(ctx, x, y, r - 1, r * 0.42 - 0.5, '#ffd0c0');
        pxEllipseStroke(ctx, x, y, r - 2, r * 0.42 - 1, '#a01020');
      }
    }

    drawTelegraphs(ctx) {
      const list = this.g.enemies;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.state !== 'WINDUP') continue;
        const s = e.strike, k = clamp(e.stateT / e.windupTime, 0, 1);
        const col = s.parryable ? '#e8e0cc' : '#ff2038';
        const blink = k > 0.7 && Math.floor(this.g.time * 16) % 2 === 0;
        ctx.globalAlpha = 0.25 + 0.35 * k;
        if (e.isBoss && e.atkKind === 'slam') {
          const cx = clamp(e.x + e.facing * s.offset, ARENA.left, ARENA.right) / PX, cy = e.y / PX, r = s.radius / PX;
          pxEllipseFill(ctx, cx, cy, r, r * 0.42, checker(ctx, col));
          ctx.globalAlpha = 1;
          pxEllipseStroke(ctx, cx, cy, r, r * 0.42, blink ? '#ffffff' : col);
          pxEllipseStroke(ctx, cx, cy, r * k, r * 0.42 * k, col);
        } else if (e.isBoss && e.atkKind === 'charge') {
          const x0 = e.x / PX, dist = e.chargeDistPreview() / PX;
          const x1 = e.facing > 0 ? Math.min(ARENA.right / PX + 10, x0 + dist) : Math.max(ARENA.left / PX - 10, x0 - dist);
          const ty = Math.round((e.y - s.depthTol) / PX), th = Math.round(s.depthTol * 2 / PX);
          ctx.fillStyle = checker(ctx, col);
          ctx.fillRect(Math.round(Math.min(x0, x1)), ty, Math.round(Math.abs(x1 - x0)), th);
          ctx.globalAlpha = 1; ctx.fillStyle = blink ? '#ffffff' : col;
          for (let c = 1; c <= 4; c++) {
            const cx = Math.round(x0 + e.facing * c * 16 * (0.6 + 0.4 * k)), cy = Math.round(e.y / PX);
            for (let j = 0; j < 4; j++) { ctx.fillRect(cx - e.facing * j, cy - j, 1, 1); ctx.fillRect(cx - e.facing * j, cy + j, 1, 1); }
          }
        } else {
          const r = s.range / PX, cx = (e.x + e.facing * s.range * 0.5) / PX, cy = e.y / PX;
          pxEllipseFill(ctx, cx, cy, r * 0.55, s.depthTol / PX, checker(ctx, col));
          ctx.globalAlpha = 1;
          if (blink) pxEllipseStroke(ctx, cx, cy, r * 0.55, s.depthTol / PX, col);
        }
        ctx.globalAlpha = 1;
      }
    }

    drawEntities(ctx) {
      const g = this.g, list = this.drawList;
      list.length = 0;
      list.push(g.player);
      for (let i = 0; i < g.enemies.length; i++) list.push(g.enemies[i]);
      list.sort((a, b) => a.ry - b.ry); // ordenação pelos pés
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.state === 'DEAD' && !e.isBoss && e.deathT > 1.6) continue;
        const r = (e.look.beast ? 46 : 26) * (e.look.scale || 1) * CHAR_SCALE / PX;
        pxEllipseFill(ctx, e.rx / PX, e.ry / PX + 1, r, Math.max(1.5, r * 0.3), '#000000');
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < list.length; i++) this.drawCharacter(ctx, list[i]);
    }

    drawCharacter(ctx, e) {
      const g = this.g, o = this.o, look = e.look, spr = e.sprite;
      // morte: o corpo pisca antes de sumir (como nos cartuchos)
      if (e.state === 'DEAD' && !e.isBoss) { if (e.deathT > 2.2) return; if (e.deathT > 1.3 && Math.floor(g.time * 20) % 2) return; }
      const blinkInv = e === g.player && e.invuln > 0 && e.invuln < 5 && e.state !== 'dead' && Math.floor(g.time * 24) % 2 === 0;

      if (e.isBoss && e.state !== 'DEAD') {
        const inv = e.invulnerable();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = inv ? 0.6 + 0.2 * Math.sin(g.time * 10) : (e.phase === 2 ? 0.45 : 0.2);
        ctx.drawImage(inv ? this.glow.cold : this.glow.red, Math.round(e.rx / PX - 32), Math.round(e.ry / PX - 72));
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      if (e === g.player && e.state === 'special') {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6;
        ctx.drawImage(this.glow.red, Math.round(e.rx / PX - 32), Math.round(e.ry / PX - 58));
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }

      const sc = spr.ctx;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, spr.canvas.width, spr.canvas.height);
      o.ds = SPR; o.time = g.time;
      o.capeFlow = clamp((e.vx * e.facing) / 300, -0.6, 1);
      o.wGlow = e.isBoss ? (e.phase === 2 ? 1 : 0.45) : (e === g.player && (e.state === 'special' || e.counterT > 0) ? 1 : 0);
      o.out = e.tipOut;
      if (look.beast) drawBeast(sc, look, e, spr.ox, spr.oy, e.facing, o);
      else drawHumanoid(sc, look, e.pose, spr.ox, spr.oy, e.facing, o);
      pixelize(spr.canvas, sc, paletteFor(spr.key), look.outline, e.flash > 0);
      const dx = Math.round(e.rx / PX - spr.ox), dy = Math.round(e.ry / PX - spr.oy);
      if (!blinkInv) ctx.drawImage(spr.canvas, dx, dy);

      const out = e.tipOut;
      const tx = dx + out.tipX, ty = dy + out.tipY;
      if (e.trailOn()) e.trail.push(dx + out.midX, dy + out.midY, tx, ty, g.time);
      ctx.globalCompositeOperation = 'lighter';
      e.trail.draw(ctx, g.time, 0.1, e === g.player ? (e.state === 'special' ? '#ff4050' : '#c8d0ff') : (e.isBoss ? '#ff3040' : '#ffb0a0'));
      // brilho de telegráfico na ponta da arma
      if (e !== g.player && e.state === 'WINDUP') {
        const k = clamp(e.stateT / e.windupTime, 0, 1);
        if (k > 0.3 && Math.floor(g.time * 20) % 3 !== 0) {
          const crimson = !e.strike.parryable, n = crimson ? 4 : 3;
          ctx.fillStyle = crimson ? '#ff3048' : '#ffffff';
          const px = Math.round(tx), py = Math.round(ty);
          ctx.fillRect(px - n, py, n * 2 + 1, 1); ctx.fillRect(px, py - n, 1, n * 2 + 1);
          ctx.fillRect(px - 1, py - 1, 3, 3);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      const headY = Math.round(e.ry / PX - e.height / PX);
      if (e.isBoss && e.currentCrimson()) {
        const hx = Math.round(e.rx / PX), hy = headY - 12;
        ctx.fillStyle = '#000000';
        for (let r = -7; r <= 7; r++) { const w = 7 - Math.abs(r); ctx.fillRect(hx - w, hy + r, w * 2 + 1, 1); }
        ctx.fillStyle = '#ff2038';
        for (let r = -6; r <= 6; r++) { const w = 6 - Math.abs(r); ctx.fillRect(hx - w, hy + r, w * 2 + 1, 1); }
        PF.draw(ctx, '!', hx + 1, hy - 3, '#ffffff', 'center', 1, null);
      }
      if (e.state === 'STAGGER') {
        ctx.fillStyle = '#f3dfae';
        for (let k = 0; k < 3; k++) {
          const a = g.time * 5 + k * TAU / 3;
          ctx.fillRect(Math.round(e.rx / PX + Math.cos(a) * 6), headY - 3 + Math.round(Math.sin(a) * 2), 1, 1);
        }
      }
    }

    drawOverlays(ctx, run, time) {
      const g = this.g, fx = g.effects;
      ctx.globalAlpha = 0.8; ctx.drawImage(this.layers.vignette, 0, 0); ctx.globalAlpha = 1;
      if (run) {
        const p = g.player, hpR = p.hp / p.maxHp;
        if (hpR < 0.3 && !p.dead) { ctx.globalAlpha = (0.3 - hpR) / 0.3 * (0.5 + 0.3 * Math.sin(time * 6)); ctx.drawImage(this.layers.redVignette, 0, 0); }
        if (p.dead) { ctx.globalAlpha = clamp(p.deathT / 2, 0, 0.6); ctx.fillStyle = '#100003'; ctx.fillRect(0, 0, LW, LH); }
        if (p.state === 'special' && p.atk && p.t < p.atk.active[0]) { ctx.globalAlpha = 0.35 * (p.t / p.atk.active[0]); ctx.fillStyle = '#140004'; ctx.fillRect(0, 0, LW, LH); }
        if (g.slowmo > 0) { ctx.globalAlpha = 0.1; ctx.fillStyle = '#c8d0ff'; ctx.fillRect(0, 0, LW, LH); }
        if (g.boss && g.boss.phase === 2 && g.boss.state !== 'DEAD') { ctx.globalAlpha = 0.07; ctx.fillStyle = '#ff0010'; ctx.fillRect(0, 0, LW, LH); }
        ctx.globalAlpha = 1;
      }
      if (fx.flash > 0) { ctx.globalAlpha = Math.min(1, fx.flash) * 0.55; ctx.fillStyle = fx.flashColor; ctx.fillRect(0, 0, LW, LH); ctx.globalAlpha = 1; }
    }
  }

  // ===========================================================================
  // 19. ESTADOS E TELAS (menus em DOM, texto em pixel art)
  // ===========================================================================
  class GameStateManager {
    constructor(game) {
      this.g = game;
      this.state = 'MENU';
      this.controlsReturn = 'MENU';
      const $ = id => document.getElementById(id);
      this.screens = {
        menu: $('screen-menu'), audio: $('screen-audio'), confirm: $('screen-confirm'), controls: $('screen-controls'),
        pause: $('screen-pause'), upgrade: $('screen-upgrade'), victory: $('screen-victory'), gameover: $('screen-gameover'),
      };
      for (const id of UPGRADE_IDS) {
        const card = document.querySelector('[data-upgrade="' + id + '"]');
        card.querySelector('.desc').textContent = UPGRADES[id].desc;
      }
      document.querySelectorAll('[data-px]').forEach(pxify);
      this.bind();
    }

    bind() {
      const g = this.g, $ = id => document.getElementById(id);
      const on = (id, fn) => $(id).addEventListener('click', () => { g.audio.unlock(); g.audio.play('ui'); fn(); });
      on('btn-new', () => g.newCampaign());
      on('btn-continue', () => g.continueCampaign());
      on('btn-controls', () => this.set('CONTROLS'));
      on('btn-audio', () => this.showSub('audio'));
      on('btn-erase', () => this.showSub('confirm'));
      on('btn-erase-no', () => this.showSub(null));
      on('btn-erase-yes', () => { const ok = g.eraseProgress(); this.showSub(null); this.setMenuNote(ok ? 'Progresso apagado.' : 'Progresso limpo nesta sessão.'); });
      on('btn-audio-back', () => this.showSub(null));
      on('btn-controls-back', () => this.back());
      on('btn-resume', () => g.resume());
      on('btn-pause-controls', () => this.set('CONTROLS'));
      on('btn-quit', () => g.quitToMenu());
      on('btn-retry', () => g.retry());
      on('btn-go-menu', () => g.quitToMenu());
      on('btn-vic-again', () => g.newCampaign());
      on('btn-vic-menu', () => g.quitToMenu());
      on('btn-mute-menu', () => g.toggleMute());
      on('btn-mute-pause', () => g.toggleMute());
      on('btn-ambient', () => g.toggleAmbient());
      document.querySelectorAll('[data-upgrade]').forEach(b => b.addEventListener('click', () => g.chooseUpgrade(b.dataset.upgrade)));
      document.querySelectorAll('.vol').forEach(r => r.addEventListener('input', () => g.setVolume(Number(r.value) / 100)));
    }

    set(state) {
      const prev = this.state, g = this.g;
      if (state === 'CONTROLS' && prev !== 'CONTROLS') this.controlsReturn = prev === 'PAUSED' ? 'PAUSED' : 'MENU';
      this.state = state;
      for (const k in this.screens) this.screens[k].hidden = true;
      let scr = null;
      switch (state) {
        case 'MENU': this.refreshMenu(); scr = this.screens.menu; break;
        case 'CONTROLS': scr = this.screens.controls; break;
        case 'PAUSED': scr = this.screens.pause; break;
        case 'VICTORY': scr = this.screens.victory; break;
        case 'GAME_OVER': scr = this.screens.gameover; break;
        case 'PLAYING': if (g.upgradeOpen) scr = this.screens.upgrade; break;
      }
      this.syncAudioUI();
      if (scr) { scr.hidden = false; this.focusFirst(scr); } else this.blur();
      g.input.endStep();
      document.body.dataset.state = state;
    }
    showSub(name) {
      if (this.state !== 'MENU') return;
      for (const k in this.screens) this.screens[k].hidden = true;
      const scr = name ? this.screens[name] : this.screens.menu;
      if (!name) this.refreshMenu();
      this.syncAudioUI();
      scr.hidden = false;
      this.focusFirst(scr);
    }
    setMenuNote(text) { setPx(document.getElementById('menu-best'), text); }
    showUpgrade(show) {
      const scr = this.screens.upgrade, pr = this.g.progress;
      scr.hidden = !show;
      if (!show) { this.blur(); return; }
      setPx(document.getElementById('upgrade-sub'), 'Nível ' + pr.level + '. Escolha uma bênção: 1, 2, 3 ou setas e Enter.' + (pr.pending > 1 ? ' Restam ' + pr.pending + '.' : ''));
      for (const id of UPGRADE_IDS) {
        const card = scr.querySelector('[data-upgrade="' + id + '"]');
        const can = pr.canUpgrade(id);
        card.disabled = !can;
        setPx(card.querySelector('.stack'), can ? 'Nível ' + pr.upgrades[id] + '/' + UPGRADES[id].max : 'Máximo');
      }
      this.focusFirst(scr);
    }
    activeScreen() {
      for (const k in this.screens) if (!this.screens[k].hidden) return this.screens[k];
      return null;
    }
    focusables(scr) {
      return Array.prototype.filter.call(scr.querySelectorAll('button, input[type="range"]'), el => !el.disabled && !el.hidden && el.offsetParent !== null);
    }
    focusFirst(scr) {
      const list = this.focusables(scr);
      if (list.length) list[0].focus({ preventScroll: true });
    }
    moveFocus(dir) {
      const scr = this.activeScreen();
      if (!scr) return;
      const list = this.focusables(scr);
      if (!list.length) return;
      let i = list.indexOf(document.activeElement);
      i = i < 0 ? 0 : (i + dir + list.length) % list.length;
      list[i].focus({ preventScroll: true });
      this.g.audio.play('ui');
    }
    blur() { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }
    back() {
      const st = this.state, g = this.g;
      if (st === 'CONTROLS') { this.set(this.controlsReturn); return; }
      if (st === 'MENU') { if (this.screens.menu.hidden) this.showSub(null); return; }
      if (st === 'PAUSED') g.resume();
    }

    refreshMenu() {
      const g = this.g, cp = g.save.data.checkpoint || g.checkpoint;
      const btn = document.getElementById('btn-continue');
      btn.hidden = !cp;
      if (cp) setPx(btn, 'Continuar: ' + (WAVES[cp.wave].boss ? 'Encontro Final' : WAVES[cp.wave].title) + ' · Nv ' + cp.level);
      const d = g.save.data;
      this.setMenuNote(d.bestScore > 0
        ? 'Recorde: ' + d.bestScore + (d.runsCompleted ? ' · Vitórias: ' + d.runsCompleted : '')
        : 'Nenhuma vitória registrada ainda.');
      document.getElementById('menu-storage').hidden = g.save.available;
    }
    syncAudioUI() {
      const a = this.g.audio, v = Math.round(a.volume * 100);
      document.querySelectorAll('.vol').forEach(r => { r.value = String(v); });
      setPx(document.getElementById('vol-menu-out'), String(v));
      setPx(document.getElementById('vol-pause-out'), String(v));
      document.querySelectorAll('.btn-mute').forEach(b => { setPx(b, a.muted ? 'Som: desligado (M)' : 'Som: ligado (M)'); b.setAttribute('aria-pressed', String(a.muted)); });
      const amb = document.getElementById('btn-ambient');
      setPx(amb, 'Ambiente: ' + (a.ambientOn ? 'ligado' : 'desligado'));
      amb.setAttribute('aria-pressed', String(a.ambientOn));
      setPx(document.getElementById('audio-status'), a.status() || 'Áudio ativo.');
    }

    fillSummary(listId, rows) {
      const ul = document.getElementById(listId);
      ul.textContent = '';
      for (const [label, value] of rows) {
        const li = document.createElement('li');
        const s = document.createElement('span'); s.dataset.px = '2'; s.dataset.color = '#9a90a8'; s.dataset.align = 'left'; s.textContent = label;
        const b = document.createElement('b'); b.dataset.px = '2'; b.textContent = value;
        li.appendChild(s); li.appendChild(b); ul.appendChild(li);
        pxify(s); pxify(b);
      }
    }
  }

  // ===========================================================================
  // 20. JOGO — coordena o ciclo principal e o estado global
  // ===========================================================================
  class Game {
    constructor() {
      this.frameEl = document.getElementById('frame');
      this.uiEl = document.getElementById('ui');
      this.canvas = document.getElementById('game');
      this.save = new SaveManager();
      this.audio = new AudioManager(this.save.data);
      this.input = new InputManager();
      this.effects = new EffectSystem();
      this.combat = new CombatSystem(this);
      this.progress = new Progression();
      this.renderer = new Renderer(this, this.canvas);
      this.hud = new HUD(this);
      this.director = new WaveDirector(this);
      this.player = new Player(this);
      this.enemies = []; this.boss = null; this.hazards = [];
      this.entities = [];
      this.time = 0; this.menuTime = 0; this.acc = 0; this.last = 0; this.raf = 0;
      this.hitstop = 0; this.slowmo = 0; this.combo = 0; this.comboT = 0;
      this.endKind = null; this.endTimer = 0; this.upgradeOpen = false; this.runActive = false;
      this.checkpoint = this.save.data.checkpoint; this.attackSerial = 0; this.errors = 0;
      this.progressHintsSeen = {};
      this.states = new GameStateManager(this);

      window.addEventListener('keydown', e => this.onKeyDown(e));
      window.addEventListener('pointerdown', () => this.audio.unlock());
      window.addEventListener('resize', () => this.resize());
      document.addEventListener('visibilitychange', () => this.onVisibility());
      this.frameBound = now => this.frame(now);
      this.resize();
      this.states.set('MENU');
      this.start();
    }

    start() {
      if (this.raf) return; // nunca dois loops ao mesmo tempo
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frameBound);
    }

    // Escala inteira de pixels (como emuladores) para manter tudo nítido.
    resize() {
      const vw = window.innerWidth || W, vh = window.innerHeight || H;
      const dpr = window.devicePixelRatio || 1;
      const k = Math.floor(Math.min(vw * dpr / LW, vh * dpr / LH));
      const fitFree = Math.min(vw / W, vh / H), fitInt = k / dpr / PX;
      // escala inteira só quando não desperdiça muita tela; senão, ampliação livre (ainda sem suavização)
      const fit = Math.max(0.05, k >= 1 && fitInt >= fitFree * 0.85 ? fitInt : fitFree);
      this.frameEl.style.width = (W * fit) + 'px';
      this.frameEl.style.height = (H * fit) + 'px';
      this.uiEl.style.transform = 'scale(' + fit + ')';
    }

    onVisibility() {
      if (document.hidden) {
        if (this.states.state === 'PLAYING' && !this.upgradeOpen && this.runActive) this.pause();
        this.input.reset();
      } else {
        this.last = performance.now(); this.acc = 0;
      }
    }

    frame(now) {
      this.raf = requestAnimationFrame(this.frameBound);
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (!(dt > 0)) dt = 0;
      if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
      try {
        const st = this.states.state;
        if (st === 'PLAYING') {
          this.acc += dt;
          let n = 0;
          while (this.acc >= STEP && n < MAX_STEPS) { this.update(STEP); this.input.endStep(); this.acc -= STEP; n++; }
          if (n === MAX_STEPS) this.acc = 0;
        } else {
          this.input.endStep();
          if (st !== 'PAUSED') { this.menuTime += dt; this.effects.updateAmbient(dt); }
        }
        if (st === 'PLAYING') this.hud.update(dt);
        this.renderer.render(st === 'PLAYING' ? clamp(this.acc / STEP, 0, 1) : 1);
      } catch (err) {
        if (this.errors++ < 3) console.error('Erro no quadro:', err);
      }
    }

    allEntities() {
      const a = this.entities;
      a.length = 0; a.push(this.player);
      for (let i = 0; i < this.enemies.length; i++) a.push(this.enemies[i]);
      return a;
    }

    update(dt) {
      const ents = this.allEntities();
      for (let i = 0; i < ents.length; i++) { ents[i].prevX = ents[i].x; ents[i].prevY = ents[i].y; }
      if (this.upgradeOpen) return;
      this.effects.updateAmbient(dt);
      if (this.hitstop > 0) { this.hitstop -= dt; this.effects.shake *= Math.exp(-dt * 6); return; }
      if (this.slowmo > 0) { this.slowmo -= dt; dt *= 0.35; }
      this.time += dt;
      if (this.director.phase === 'fight' || this.director.phase === 'announce') this.progress.time += dt;

      this.director.update(dt);
      this.player.update(dt);
      for (let i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt);
      for (let i = 0; i < this.hazards.length; i++) this.hazards[i].update(dt, this);
      this.separate();

      let w = 0;
      for (let i = 0; i < this.enemies.length; i++) { const e = this.enemies[i]; if (!e.remove) this.enemies[w++] = e; }
      this.enemies.length = w;
      w = 0;
      for (let i = 0; i < this.hazards.length; i++) { const h = this.hazards[i]; if (!h.dead) this.hazards[w++] = h; }
      this.hazards.length = w;

      if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
      this.effects.update(dt);

      if (this.endKind) {
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.finishRun();
      }
    }

    // Impede que inimigos ocupem exatamente a mesma posição.
    separate() {
      const list = this.enemies;
      for (let i = 0; i < list.length; i++) {
        const a = list[i]; if (!a.alive()) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j]; if (!b.alive()) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const minX = (a.radius + b.radius) * 1.1, minY = 22;
          if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
            const push = (minX - Math.abs(dx)) * 0.5;
            const wa = a.isBoss ? 0.1 : 0.5, wb = b.isBoss ? 0.1 : 0.5;
            const sx = dx === 0 ? (i % 2 ? 1 : -1) : sign(dx);
            a.x -= sx * push * wa; b.x += sx * push * wb;
            const sy = dy === 0 ? (j % 2 ? 1 : -1) : sign(dy);
            a.y = clamp(a.y - sy * 0.6, ARENA.top, ARENA.bottom); b.y = clamp(b.y + sy * 0.6, ARENA.top, ARENA.bottom);
          }
        }
        const p = this.player;
        if (!p.dead && a.state !== 'ATTACK') {
          const dx = a.x - p.x, dy = a.y - p.y;
          if (Math.abs(dx) < 30 && Math.abs(dy) < 14) a.x += (dx === 0 ? 1 : sign(dx)) * 1.5;
        }
      }
    }

    aliveEnemies() {
      let n = 0;
      for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].alive()) n++;
      return n;
    }

    // ---------------- fluxo da campanha ----------------
    resetWorld() {
      this.enemies.length = 0; this.hazards.length = 0; this.boss = null;
      this.effects.clear(); this.input.endStep();
      this.hitstop = 0; this.slowmo = 0; this.combo = 0; this.comboT = 0; this.acc = 0;
      this.endKind = null; this.endTimer = 0; this.upgradeOpen = false; this.time = 0;
      this.states.showUpgrade(false);
      this.hud.reset();
      this.director.reset();
    }
    startRun(wave, narrative) {
      this.resetWorld();
      this.player.reset(computeStats(this.progress.upgrades));
      this.runActive = true;
      this.states.set('PLAYING');
      this.director.start(wave, narrative);
      this.last = performance.now();
    }
    newCampaign() {
      this.progress.reset();
      this.progressHintsSeen = {};
      this.startRun(0, true);
    }
    continueCampaign() {
      const cp = this.save.data.checkpoint || this.checkpoint;
      if (!cp) { this.newCampaign(); return; }
      this.progress.fromCheckpoint(cp);
      this.startRun(cp.wave, false);
    }
    retry() {
      const cp = this.checkpoint;
      if (!cp) { this.newCampaign(); return; }
      this.progress.fromCheckpoint(cp);
      this.startRun(cp.wave, false);
    }
    quitToMenu() {
      this.resetWorld();
      this.runActive = false;
      this.states.set('MENU');
    }
    pause() {
      if (this.states.state !== 'PLAYING' || this.upgradeOpen) return;
      this.states.set('PAUSED');
    }
    resume() {
      if (this.states.state !== 'PAUSED' && this.states.state !== 'CONTROLS') return;
      this.states.set('PLAYING');
      this.last = performance.now(); this.acc = 0;
    }
    saveCheckpoint(wave) {
      this.checkpoint = this.progress.toCheckpoint(wave);
      const d = this.save.data;
      d.checkpoint = this.checkpoint;
      d.highestWave = Math.max(d.highestWave, wave + 1);
      this.save.save();
    }
    eraseProgress() {
      this.checkpoint = null;
      const ok = this.save.erase();
      this.states.refreshMenu();
      return ok;
    }

    spawnEnemy(type) {
      const p = this.player;
      let side = p.x < W / 2 ? 1 : -1;  // nasce do lado oposto ao jogador
      if (Math.random() < 0.3 && Math.abs((side > 0 ? ARENA.left : ARENA.right) - p.x) > 420) side = -side;
      const x = side > 0 ? W + 90 : -90;
      const y = rand(ARENA.top + 10, ARENA.bottom - 10);
      const e = new Enemy(this, ENEMY_TYPES[type], x, y);
      e.facing = -side; e.faceVis = -side;
      this.enemies.push(e);
    }
    spawnBoss() {
      const b = new Boss(this, W + 120, (ARENA.top + ARENA.bottom) / 2);
      this.boss = b;
      this.enemies.push(b);
      this.audio.play('bossIntro');
    }

    registerHit() {
      this.combo++; this.comboT = 2.2;
      if (this.combo > this.progress.maxCombo) this.progress.maxCombo = this.combo;
      if (this.combo % 10 === 0) { this.player.gainBlood(BLOOD_GAIN.comboMilestone); this.effects.text(this.player.x, this.player.y, this.player.height + 30, this.combo + ' GOLPES!', '#ff9aa2'); }
    }
    breakCombo() { this.combo = 0; this.comboT = 0; }
    addScore(n) { this.progress.score += Math.max(0, Math.round(n)); }

    onEnemyKilled(e) {
      const pr = this.progress, p = this.player;
      pr.kills++;
      this.addScore(e.def.score * (1 + Math.min(this.combo, 30) * 0.03));
      p.gainBlood(BLOOD_GAIN.kill);
      this.effects.text(e.x, e.y, e.height + 36, '+' + e.def.xp + ' XP', '#e0b860');
      const lv = pr.addXp(e.def.xp);
      if (lv > 0) {
        p.heal(PROGRESSION.levelUpHeal);
        this.hud.toast('NÍVEL ' + pr.level + '! A chama fortalece o Guardião.', 'level', 2.6);
        this.effects.ring(p.x, p.y, 120, 0.7, '#e0b860', 1);
        this.audio.play('levelUp');
      }
      this.audio.play('enemyDeath');
      if (e.isBoss) this.onBossDefeated();
    }
    onWaveCleared(index) {
      const p = this.player;
      this.addScore(PROGRESSION.waveClearScore * (index + 1));
      p.heal(Math.round(p.maxHp * PROGRESSION.waveClearHeal));
      this.hud.banner('Onda vencida', 'A chama recupera parte da sua vida', 1.8);
      if (index === 0) this.hud.showHint(false);
    }
    onBossDefeated() {
      if (this.endKind) return;
      this.endKind = 'victory'; this.endTimer = 3.6;
      this.slowmo = 1.0;
      this.player.invuln = 99;
      const p = this.player;
      this.addScore(p.hp * 10 + Math.max(0, 600 - this.progress.time) * 5);
      this.hud.banner('Vitória', 'O Cavaleiro da Noite Eterna tomba', 3);
      this.audio.play('victory');
    }
    onPlayerDeath() {
      if (this.endKind) return;
      this.endKind = 'defeat'; this.endTimer = 2.4;
      this.audio.play('defeat');
    }

    finishRun() {
      const kind = this.endKind, pr = this.progress, d = this.save.data;
      this.endKind = null;
      const record = pr.score > d.bestScore;
      if (record) d.bestScore = pr.score;
      if (kind === 'victory') {
        d.runsCompleted++;
        if (!d.bestTime || pr.time < d.bestTime) d.bestTime = pr.time;
        d.checkpoint = null; this.checkpoint = null;
        this.save.save();
        setPx(document.getElementById('vic-boss'), BOSS_DEF.name + ' foi derrotado. A última luz resiste mais uma noite.');
        this.states.fillSummary('vic-summary', [
          ['Tempo', fmtTime(pr.time)], ['Inimigos', String(pr.kills)],
          ['XP obtida', String(pr.xpGained)], ['Nível final', String(pr.level)],
          ['Combo máximo', String(pr.maxCombo)], ['Aparos perfeitos', String(pr.parries)],
          ['Dano sofrido', String(pr.damageTaken)], ['Pontuação', String(pr.score)],
          ['Recorde', String(d.bestScore)], ['Vitórias', String(d.runsCompleted)],
        ]);
        document.getElementById('vic-record').hidden = !record;
        this.states.set('VICTORY');
      } else {
        this.save.save();
        const w = WAVES[this.director.index];
        const where = w ? (w.boss ? 'Encontro Final' : w.title) : '-';
        this.states.fillSummary('go-summary', [
          ['Alcançado', where], ['Tempo', fmtTime(pr.time)],
          ['Inimigos', String(pr.kills)], ['Nível', String(pr.level)],
          ['Pontuação', String(pr.score)], ['Recorde', String(d.bestScore)],
        ]);
        setPx(document.getElementById('btn-retry'), 'Tentar de novo: ' + where + ' (R)');
        this.states.set('GAME_OVER');
      }
    }

    openUpgrade() {
      this.upgradeOpen = true;
      this.input.endStep();
      this.states.showUpgrade(true);
      this.audio.play('levelUp');
    }
    chooseUpgrade(id) {
      if (!this.upgradeOpen || !this.progress.applyUpgrade(id)) return;
      this.player.applyStats(computeStats(this.progress.upgrades), id === 'vigor');
      this.upgradeOpen = false;
      this.states.showUpgrade(false);
      this.input.endStep();
      this.audio.play('ui');
      this.hud.toast(UPGRADES[id].name + ': nível ' + this.progress.upgrades[id], 'level', 2);
      this.director.upgradeDone();
    }

    toggleMute() {
      this.audio.unlock();
      this.audio.setMuted(!this.audio.muted);
      this.save.data.muted = this.audio.muted; this.save.save();
      this.states.syncAudioUI();
      if (this.runActive) this.hud.toast(this.audio.muted ? 'Som desligado' : 'Som ligado', '', 1.2);
    }
    toggleAmbient() {
      this.audio.setAmbient(!this.audio.ambientOn);
      this.save.data.ambient = this.audio.ambientOn; this.save.save();
      this.states.syncAudioUI();
    }
    setVolume(v) {
      this.audio.unlock();
      this.audio.setVolume(v);
      this.save.data.volume = this.audio.volume; this.save.save();
      this.states.syncAudioUI();
    }

    // Teclas de meta-controle (menus, pausa, reinício). Movimento/ataques ficam no InputManager.
    onKeyDown(e) {
      this.audio.unlock();
      const c = e.code, st = this.states.state;
      const tgt = e.target, onRange = tgt && tgt.type === 'range';
      const onButton = tgt && tgt.tagName === 'BUTTON';
      if ((c === 'Space' && !onButton) || c.indexOf('Arrow') === 0) {
        if (!(onRange && (c === 'ArrowLeft' || c === 'ArrowRight'))) e.preventDefault();
      }
      if (c === 'KeyM' && !e.repeat) { this.toggleMute(); return; }

      if (st === 'PLAYING') {
        if (this.upgradeOpen) {
          if (c === 'Digit1' || c === 'Numpad1') this.chooseUpgrade('blade');
          else if (c === 'Digit2' || c === 'Numpad2') this.chooseUpgrade('vigor');
          else if (c === 'Digit3' || c === 'Numpad3') this.chooseUpgrade('discipline');
          else if (c === 'ArrowLeft' || c === 'ArrowUp' || c === 'KeyA' || c === 'KeyW') { e.preventDefault(); this.states.moveFocus(-1); }
          else if (c === 'ArrowRight' || c === 'ArrowDown' || c === 'KeyD' || c === 'KeyS') { e.preventDefault(); this.states.moveFocus(1); }
          return; // Enter aciona o cartão focado nativamente
        }
        if (GAME_CODES.has(c)) e.preventDefault();
        if (e.repeat) return;
        if (c === 'Escape') { this.pause(); return; }
        if ((c === 'Enter' || c === 'Space') && this.director.phase === 'narrative') this.director.skipNarrative();
        return;
      }

      if (c === 'Escape') { e.preventDefault(); if (!e.repeat) this.states.back(); return; }
      if ((st === 'VICTORY' || st === 'GAME_OVER') && c === 'KeyR' && !e.repeat) {
        this.audio.play('ui');
        if (st === 'VICTORY') this.newCampaign(); else this.retry();
        return;
      }
      if (c === 'ArrowUp' || c === 'KeyW') { e.preventDefault(); this.states.moveFocus(-1); return; }
      if (c === 'ArrowDown' || c === 'KeyS') { e.preventDefault(); this.states.moveFocus(1); return; }
      if (c === 'Enter') {
        const scr = this.states.activeScreen();
        if (scr && !scr.contains(document.activeElement)) { e.preventDefault(); this.states.focusFirst(scr); }
      }
    }
  }

  // ===========================================================================
  // 21. INICIALIZAÇÃO
  // ===========================================================================
  function boot() {
    try {
      const game = new Game();
      window.__ultimaLuz = game; // acesso para depuração pelo console
    } catch (err) {
      console.error(err);
      const box = document.getElementById('fatal');
      if (box) {
        box.hidden = false;
        box.textContent = 'Não foi possível iniciar o jogo: ' + (err && err.message ? err.message : err) +
          '. Use uma versão recente do Chrome, Edge ou Firefox.';
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
