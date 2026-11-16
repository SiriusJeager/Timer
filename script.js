'use strict';

// ============================================================
// CLAVES DE ACTIVACIÓN
// Agrega o quita claves aquí (una por línea, entre comillas).
// No importa si el usuario escribe en minúsculas o con espacios.
// ============================================================
const VALID_CODES = [
  'KEGEL2026'
];

// ============================================================
// NIVELES (sobrecarga progresiva)
// from      = sesiones completadas necesarias para entrar al nivel
// randomMax = duración máxima (s) de una fase en Modo Aleatorio
// ============================================================
const LEVELS = [
  { level: 1, name: 'Iniciante',  from: 0,  randomMax: 6 },
  { level: 2, name: 'Intermedio', from: 5,  randomMax: 8 },
  { level: 3, name: 'Avanzado',   from: 10, randomMax: 10 },
  { level: 4, name: 'Experto',    from: 15, randomMax: 12 },
  { level: 5, name: 'Maestro',    from: 25, randomMax: 15 }
];

const RANDOM_MIN_SECONDS = 2;
const DEFAULT_MINUTES = 3;

// Modo Progresivo: combinaciones "contraer-relajar" en orden de dificultad
// y el nivel en el que se desbloquea cada una.
const COMBOS = [
  { contract: 2, relax: 2, level: 1 },
  { contract: 2, relax: 3, level: 1 },
  { contract: 3, relax: 2, level: 1 },
  { contract: 3, relax: 3, level: 1 },
  { contract: 3, relax: 4, level: 2 },
  { contract: 4, relax: 3, level: 2 },
  { contract: 4, relax: 4, level: 2 },
  { contract: 5, relax: 4, level: 3 },
  { contract: 6, relax: 5, level: 3 },
  { contract: 8, relax: 5, level: 3 }
].map(c => ({ ...c, id: c.contract + '-' + c.relax }));

// Variantes Especiales: steps = lista de [contraer, relajar] que se repite.
const VARIANTS = [
  { id: 'explosive', name: 'Explosivo',  focus: 'Fibras rápidas', steps: [[1, 2]] },
  { id: 'pyramid',   name: 'Pirámide',   focus: 'Sobrecarga',     steps: [[2, 2], [4, 4], [6, 6], [8, 8], [6, 6], [4, 4]] },
  { id: 'isometric', name: 'Isométrico', focus: 'Resistencia',    steps: [[10, 5]] }
];

const PHASE_LABEL = { contraer: 'CONTRAER', relajar: 'RELAJAR' };
const PHASE_NAME = { contraer: 'Contraer', relajar: 'Relajar' };

// ============================================================
// ALMACENAMIENTO (localStorage con protección ante errores)
// ============================================================
const KEYS = {
  unlocked: 'kegelUnlocked',
  sessions: 'sessions',
  minutes: 'minutes',
  muted: 'muted',
  lastCombo: 'lastCombo',   // última combinación completada en Modo Progresivo
  variant: 'variant'        // última variante especial elegida
};

const store = {
  get(key){
    try{ return localStorage.getItem(key); }catch{ return null; }
  },
  set(key, value){
    try{ localStorage.setItem(key, String(value)); }catch{}
  },
  remove(key){
    try{ localStorage.removeItem(key); }catch{}
  }
};

// Limpia datos de versiones anteriores de la app que ya no se usan.
['state', 'contraction', 'relaxation', 'repetitions', 'mode'].forEach(store.remove);

// ============================================================
// PROGRESO DEL USUARIO
// ============================================================
function getSessions(){
  return parseInt(store.get(KEYS.sessions) || '0', 10) || 0;
}

function levelFor(sessions){
  let current = LEVELS[0];
  LEVELS.forEach(l => { if(sessions >= l.from) current = l; });
  return current;
}

function currentLevel(){
  return levelFor(getSessions());
}

function unlockedCombos(level){
  return COMBOS.filter(c => c.level <= level.level);
}

// Sugerencia: la combinación siguiente a la última completada,
// sin pasar de la más alta desbloqueada.
function suggestedCombo(level){
  const unlocked = unlockedCombos(level);
  const lastIndex = COMBOS.findIndex(c => c.id === store.get(KEYS.lastCombo));
  const index = Math.min(lastIndex + 1, unlocked.length - 1);
  return unlocked[index];
}

function savedVariant(){
  return VARIANTS.find(v => v.id === store.get(KEYS.variant)) || VARIANTS[0];
}

// Texto de lo que se desbloquea al llegar a un nivel.
function unlocksText(level){
  const combos = COMBOS.filter(c => c.level === level.level).map(c => c.id);
  const parts = [];
  if(combos.length) parts.push('Progresivo ' + combos.join(', '));
  parts.push('Aleatorio hasta ' + level.randomMax + ' s');
  return 'Nuevo: ' + parts.join(' · ');
}

// ============================================================
// GENERACIÓN DE LA SESIÓN
// Cada generador devuelve la lista completa de fases:
// [{ type, start, end, step }] en ms. La suma es exactamente el total.
// ============================================================
function randomInt(min, max){
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Repite los pasos [contraer, relajar] hasta agotar el tiempo.
// Si el último ciclo no cabe entero, el sobrante se reparte para que
// la sesión termine siempre en relajación y nunca con una contracción cortada.
function buildCycles(steps, totalSeconds){
  const phases = [];
  let elapsed = 0;
  const push = (type, seconds, step) => {
    phases.push({ type, start: elapsed * 1000, end: (elapsed + seconds) * 1000, step });
    elapsed += seconds;
  };

  for(let i = 0; elapsed < totalSeconds; i++){
    const [contract, relax] = steps[i % steps.length];
    const step = contract + '-' + relax;
    const remaining = totalSeconds - elapsed;

    if(remaining >= contract + relax){
      push('contraer', contract, step);
      push('relajar', relax, step);
    }else if(remaining > contract || !phases.length){
      push('contraer', Math.min(contract, remaining), step);
      if(remaining > contract) push('relajar', remaining - contract, step);
    }else{
      phases[phases.length - 1].end += remaining * 1000; // alarga el último descanso
      elapsed += remaining;
    }
  }
  return phases;
}

// Fases de duración aleatoria entre min y max; la última se ajusta al tiempo restante.
function buildRandom(totalSeconds, min, max){
  const phases = [];
  let elapsed = 0;
  let type = 'contraer';
  while(elapsed < totalSeconds){
    const remaining = totalSeconds - elapsed;
    let seconds = randomInt(min, max);
    if(seconds >= remaining){
      seconds = remaining;
    }else if(remaining - seconds < min){
      // Evita dejar una fase final más corta que el mínimo.
      seconds = remaining - min >= min ? remaining - min : remaining;
    }
    phases.push({ type, start: elapsed * 1000, end: (elapsed + seconds) * 1000, step: '' });
    elapsed += seconds;
    type = type === 'contraer' ? 'relajar' : 'contraer';
  }
  return phases;
}

// ============================================================
// PROGRAMAS (las 3 modalidades)
// options(level)        -> chips a mostrar en "PREPARADO" (o null)
// defaultOption(level)  -> id de la opción preseleccionada
// build(total, option, level) -> lista de fases
// describe(option, level)     -> texto bajo el anillo en "PREPARADO"
// ============================================================
const PROGRAMS = {
  progressive: {
    title: 'Modo Progresivo',
    unpredictable: false,
    options(level){
      const suggested = suggestedCombo(level).id;
      return COMBOS.map(c => {
        const locked = c.level > level.level;
        return {
          id: c.id,
          label: c.id,
          note: locked ? 'Nivel ' + c.level : (c.id === suggested ? 'Sugerida' : ''),
          locked
        };
      });
    },
    defaultOption(level){
      return suggestedCombo(level).id;
    },
    build(totalSeconds, option){
      const combo = COMBOS.find(c => c.id === option);
      return buildCycles([[combo.contract, combo.relax]], totalSeconds);
    },
    describe(option){
      const combo = COMBOS.find(c => c.id === option);
      return combo.contract + ' s contraer · ' + combo.relax + ' s relajar';
    }
  },

  random: {
    title: 'Modo Aleatorio',
    unpredictable: true,
    options(){ return null; },
    defaultOption(){ return null; },
    build(totalSeconds, option, level){
      return buildRandom(totalSeconds, RANDOM_MIN_SECONDS, level.randomMax);
    },
    describe(option, level){
      return 'Fases impredecibles de ' + RANDOM_MIN_SECONDS + ' a ' + level.randomMax + ' s';
    }
  },

  special: {
    title: 'Variantes Especiales',
    unpredictable: false,
    options(){
      return VARIANTS.map(v => ({ id: v.id, label: v.name, note: v.focus, locked: false }));
    },
    defaultOption(){
      return savedVariant().id;
    },
    build(totalSeconds, option){
      return buildCycles(VARIANTS.find(v => v.id === option).steps, totalSeconds);
    },
    describe(option){
      const variant = VARIANTS.find(v => v.id === option);
      if(variant.steps.length > 1){
        return 'Escalones ' + variant.steps.map(s => s[0]).join(' · ') + ' s';
      }
      return variant.steps[0][0] + ' s contraer · ' + variant.steps[0][1] + ' s relajar';
    }
  }
};

// ============================================================
// PANTALLA DE BLOQUEO (clave de activación)
// ============================================================
const lockForm = document.getElementById('lockForm');
const codeInput = document.getElementById('activationCode');
const lockError = document.getElementById('lockError');

function normalizeCode(value){
  return value.replace(/\s+/g, '').toUpperCase();
}

function showApp(){
  document.documentElement.classList.add('unlocked');
}

lockForm.addEventListener('submit', e => {
  e.preventDefault();
  const code = normalizeCode(codeInput.value);
  const valid = VALID_CODES.some(c => normalizeCode(c) === code);
  if(valid){
    store.set(KEYS.unlocked, '1');
    lockError.textContent = '';
    codeInput.blur();
    showApp();
  }else{
    lockError.textContent = 'Clave incorrecta. Revísala en tu área de compras de Hotmart.';
    codeInput.select();
  }
});

codeInput.addEventListener('input', () => {
  lockError.textContent = '';
});

// ============================================================
// GUÍA DE INSTALACIÓN
// ============================================================
const installModal = document.getElementById('installModal');

document.querySelectorAll('.install-link').forEach(btn => {
  btn.addEventListener('click', () => { installModal.hidden = false; });
});

document.getElementById('installClose').addEventListener('click', () => {
  installModal.hidden = true;
});

installModal.addEventListener('click', e => {
  if(e.target === installModal) installModal.hidden = true;
});

// ============================================================
// GUÍA: MÚSCULOS Y TÉCNICA
// ============================================================
const guideModal = document.getElementById('guideModal');
const guideBody = document.getElementById('guideBody');

function closeGuide(){
  guideModal.hidden = true;
}

document.getElementById('guideLink').addEventListener('click', () => {
  guideModal.hidden = false;
  guideBody.scrollTop = 0; // siempre abre desde el principio
});

guideModal.querySelectorAll('[data-guide-close]').forEach(btn => {
  btn.addEventListener('click', closeGuide);
});

guideModal.addEventListener('click', e => {
  if(e.target === guideModal) closeGuide();
});

// ============================================================
// SONIDO Y VIBRACIÓN
// ============================================================
let audioCtx = null;
let muted = store.get(KEYS.muted) === '1';

// Debe llamarse desde un toque del usuario (iOS lo exige para que suene).
function initAudio(){
  try{
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if(audioCtx.state === 'suspended'){
      audioCtx.resume();
    }
  }catch{
    audioCtx = null;
  }
}

function playTone(frequency, delay = 0, duration = 0.18){
  if(muted) return;
  initAudio();
  if(!audioCtx) return;
  try{
    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }catch{}
}

function vibrate(pattern){
  try{
    if(navigator.vibrate) navigator.vibrate(pattern);
  }catch{}
}

// Señal de cambio de fase: tono agudo = contraer, tono grave = relajar.
function cuePhase(type){
  if(type === 'contraer'){
    playTone(880);
    vibrate(150);
  }else{
    playTone(440);
    vibrate([60, 70, 60]);
  }
}

function cueFinished(){
  playTone(660, 0);
  playTone(880, 0.18);
  playTone(1100, 0.36, 0.3);
  vibrate([120, 80, 120, 80, 240]);
}

// ============================================================
// MANTENER LA PANTALLA ENCENDIDA DURANTE LA SESIÓN
// ============================================================
let wakeLock = null;

async function keepScreenOn(){
  if(!('wakeLock' in navigator) || wakeLock) return;
  try{
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  }catch{
    wakeLock = null;
  }
}

function allowScreenOff(){
  if(wakeLock){
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// ============================================================
// MOTOR DEL CRONÓMETRO (compartido por todas las modalidades)
// El tiempo se calcula con el reloj del sistema, no contando ticks,
// para que no se atrase si el navegador pausa la pestaña.
// ============================================================
const TICK_MS = 100;

const session = {
  mode: null,         // progressive | random | special
  option: null,       // combinación o variante elegida
  els: null,          // elementos de la vista activa
  minutes: DEFAULT_MINUTES,
  totalMs: 0,
  schedule: [],
  status: 'idle',     // idle | running | paused | done
  elapsedBefore: 0,   // ms acumulados antes de la última reanudación
  startedAt: 0,
  phaseIndex: -1,
  intervalId: null,
  levelUp: null       // nivel alcanzado al terminar la sesión (si subió)
};

function elapsedMs(){
  return session.status === 'running'
    ? session.elapsedBefore + (Date.now() - session.startedAt)
    : session.elapsedBefore;
}

function prepareSession(){
  clearInterval(session.intervalId);
  allowScreenOff();
  const program = PROGRAMS[session.mode];
  session.totalMs = session.minutes * 60 * 1000;
  session.schedule = program.build(session.minutes * 60, session.option, currentLevel());
  session.status = 'idle';
  session.elapsedBefore = 0;
  session.phaseIndex = -1;
  session.levelUp = null;
  renderOptions();
  render();
}

function startSession(){
  if(session.status === 'running') return;
  if(session.status === 'done') prepareSession();
  session.startedAt = Date.now();
  session.status = 'running';
  session.intervalId = setInterval(tick, TICK_MS);
  keepScreenOn();
  tick();
}

function pauseSession(){
  if(session.status !== 'running') return;
  session.elapsedBefore = elapsedMs();
  session.status = 'paused';
  clearInterval(session.intervalId);
  allowScreenOff();
  render();
}

function finishSession(){
  clearInterval(session.intervalId);
  allowScreenOff();
  session.elapsedBefore = session.totalMs;
  session.status = 'done';

  const before = currentLevel();
  store.set(KEYS.sessions, getSessions() + 1);
  const after = currentLevel();
  session.levelUp = after.level > before.level ? after : null;
  if(session.mode === 'progressive') store.set(KEYS.lastCombo, session.option);

  cueFinished();
  render();
}

function tick(){
  const elapsed = elapsedMs();
  if(elapsed >= session.totalMs){
    finishSession();
    return;
  }
  let index = Math.max(session.phaseIndex, 0);
  while(session.schedule[index].end <= elapsed) index++;
  if(index !== session.phaseIndex){
    session.phaseIndex = index;
    cuePhase(session.schedule[index].type);
    pulseRing();
  }
  render();
}

// ============================================================
// PINTADO DE LA VISTA DE CRONÓMETRO
// ============================================================
function formatClock(ms){
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function setText(el, text){
  if(el.textContent !== text) el.textContent = text;
}

function pulseRing(){
  const ring = session.els.ring;
  ring.classList.remove('pulse');
  void ring.offsetWidth; // reinicia la animación
  ring.classList.add('pulse');
}

// Chips de combinación / variante (solo se ven en "PREPARADO").
function renderOptions(){
  const { els } = session;
  const options = PROGRAMS[session.mode].options(currentLevel());
  els.options.textContent = '';
  if(!options){
    delete els.view.dataset.options;
    return;
  }
  els.view.dataset.options = session.mode;
  options.forEach(opt => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'option';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(opt.id === session.option));
    chip.disabled = opt.locked;

    const label = document.createElement('strong');
    label.textContent = opt.label;
    const note = document.createElement('span');
    note.textContent = opt.note;
    chip.append(label, note);

    chip.addEventListener('click', () => selectOption(opt.id));
    els.options.appendChild(chip);
  });
}

function selectOption(id){
  if(session.status !== 'idle' || id === session.option) return;
  session.option = id;
  if(session.mode === 'special') store.set(KEYS.variant, id);
  prepareSession();
}

function render(){
  const { els, schedule, status } = session;
  if(!els) return;
  const program = PROGRAMS[session.mode];
  const elapsed = Math.min(elapsedMs(), session.totalMs);
  const phase = schedule[Math.max(session.phaseIndex, 0)];
  const next = schedule[session.phaseIndex + 1];

  els.view.dataset.status = status;
  setText(els.remaining, formatClock(session.totalMs - elapsed));

  if(status === 'idle'){
    els.view.dataset.phase = 'idle';
    setText(els.phase, 'PREPARADO');
    setText(els.count, program.unpredictable ? '?' : String((phase.end - phase.start) / 1000));
    setText(els.unit, 'segundos');
    setText(els.sub, program.describe(session.option, currentLevel()));
    setText(els.toggle, 'Iniciar');
    els.progress.style.strokeDashoffset = '0';
    return;
  }

  if(status === 'done'){
    const up = session.levelUp;
    els.view.dataset.phase = 'done';
    setText(els.phase, up ? '¡NIVEL ' + up.level + '!' : '¡COMPLETADO!');
    setText(els.count, '✓');
    setText(els.unit, up ? up.name : 'buen trabajo');
    setText(els.sub, up ? unlocksText(up) : 'Sesión de ' + session.minutes + ' min terminada');
    setText(els.toggle, 'Repetir');
    els.progress.style.strokeDashoffset = '0';
    return;
  }

  // running | paused
  const phaseLength = phase.end - phase.start;
  const phaseLeft = phase.end - elapsed;
  els.view.dataset.phase = phase.type;
  setText(els.phase, PHASE_LABEL[phase.type]);
  setText(els.count, String(Math.ceil(phaseLeft / 1000)));
  setText(els.unit, 'segundos');
  els.progress.style.strokeDashoffset = String(100 * (1 - phaseLeft / phaseLength));

  if(status === 'paused'){
    setText(els.sub, 'En pausa');
    setText(els.toggle, 'Continuar');
  }else{
    const isPyramid = session.mode === 'special' && session.option === 'pyramid';
    const prefix = isPyramid ? 'Escalón ' + phase.step + ' · ' : '';
    setText(els.sub, prefix + (next ? 'Siguiente: ' + PHASE_NAME[next.type] : 'Última fase'));
    setText(els.toggle, 'Pausar');
  }
}

// ============================================================
// VISTA INICIO
// ============================================================
const appEl = document.getElementById('app');
const homeView = document.getElementById('view-home');
const sessionsEl = document.getElementById('sessions');
const levelNameEl = document.getElementById('levelName');
const levelProgressEl = document.getElementById('levelProgress');
const levelBarEl = document.getElementById('levelBar');
const levelFillEl = document.getElementById('levelFill');
const durationButtons = [...document.querySelectorAll('.duration')];

function renderHome(){
  const sessions = getSessions();
  const level = levelFor(sessions);
  const next = LEVELS.find(l => l.level === level.level + 1);

  let percent = 100;
  let progressText = 'Nivel máximo';
  if(next){
    const done = sessions - level.from;
    const needed = next.from - level.from;
    percent = Math.round(100 * done / needed);
    progressText = done + '/' + needed + ' sesiones para Nivel ' + next.level;
  }

  levelNameEl.textContent = 'Nivel ' + level.level + ' · ' + level.name;
  levelProgressEl.textContent = progressText;
  levelFillEl.style.width = percent + '%';
  levelBarEl.setAttribute('aria-valuenow', String(percent));
  sessionsEl.textContent = String(sessions);

  const pills = {
    progressive: 'Sugerida ' + suggestedCombo(level).id,
    random: RANDOM_MIN_SECONDS + '–' + level.randomMax + ' s',
    special: savedVariant().name
  };
  Object.keys(pills).forEach(mode => {
    homeView.querySelector('[data-pill="' + mode + '"]').textContent = pills[mode];
  });
}

function selectMinutes(minutes){
  session.minutes = minutes;
  store.set(KEYS.minutes, minutes);
  durationButtons.forEach(btn => {
    btn.setAttribute('aria-checked', String(Number(btn.dataset.minutes) === minutes));
  });
}

durationButtons.forEach(btn => {
  btn.addEventListener('click', () => selectMinutes(Number(btn.dataset.minutes)));
});

document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => openTimer(card.dataset.mode));
});

// ============================================================
// VISTAS DE CRONÓMETRO Y NAVEGACIÓN
// ============================================================
const timerViews = {};

function updateMuteButtons(){
  Object.values(timerViews).forEach(els => {
    els.mute.setAttribute('aria-pressed', String(muted));
    els.mute.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar sonido');
  });
}

// Crea una vista de cronómetro (una por modalidad) a partir de la plantilla.
function createTimerView(mode){
  const fragment = document.getElementById('timerTemplate').content.cloneNode(true);
  const view = fragment.querySelector('.timer');
  view.id = 'view-' + mode;

  const els = { view };
  view.querySelectorAll('[data-el]').forEach(el => { els[el.dataset.el] = el; });
  els.title.textContent = PROGRAMS[mode].title;

  els.toggle.addEventListener('click', () => {
    initAudio();
    if(session.status === 'running') pauseSession();
    else startSession();
  });

  els.reset.addEventListener('click', prepareSession);

  els.back.addEventListener('click', () => {
    if(history.state && history.state.timer) history.back();
    else goHome();
  });

  els.mute.addEventListener('click', () => {
    muted = !muted;
    store.set(KEYS.muted, muted ? '1' : '0');
    updateMuteButtons();
    if(!muted) playTone(660, 0, 0.12); // confirma que el sonido volvió
  });

  appEl.appendChild(fragment);
  timerViews[mode] = els;
}

function showView(view){
  [homeView, ...Object.values(timerViews).map(els => els.view)].forEach(v => {
    v.hidden = v !== view;
  });
}

function openTimer(mode){
  initAudio();
  session.mode = mode;
  session.els = timerViews[mode];
  session.option = PROGRAMS[mode].defaultOption(currentLevel());
  prepareSession();
  showView(session.els.view);
  // Permite volver a Inicio con el botón "atrás" de Android.
  history.pushState({ timer: mode }, '');
}

function goHome(){
  clearInterval(session.intervalId);
  allowScreenOff();
  session.status = 'idle';
  session.els = null;
  renderHome();
  showView(homeView);
}

window.addEventListener('popstate', goHome);

// Al volver a la app: recupera la pantalla encendida y actualiza el reloj.
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && session.status === 'running'){
    keepScreenOn();
    tick();
  }
});

// ============================================================
// SERVICE WORKER (modo sin internet)
// ============================================================
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// ============================================================
// ARRANQUE
// ============================================================
Object.keys(PROGRAMS).forEach(createTimerView);
updateMuteButtons();

const savedMinutes = parseInt(store.get(KEYS.minutes), 10);
selectMinutes(savedMinutes >= 1 && savedMinutes <= 5 ? savedMinutes : DEFAULT_MINUTES);

// Al recargar siempre se vuelve a Inicio.
if(history.state) history.replaceState(null, '');
goHome();

if(store.get(KEYS.unlocked) === '1'){
  showApp();
}
