/* QuizCraft v3: ezber, haftalık rapor, aralıklı tekrar, dersler, paylaşım, görevler */
Object.assign(state, { decks: [], srs: {}, meta: {} });
Object.assign(TITLES, {
  ezber: ['Ezber', 'Konuları kartlar ve hafıza ipuçlarıyla ezberle'],
  missions: ['Görevler', 'Tamamladıkça yeni seviyeler açılır'],
  weekly: ['Haftalık değerlendirme', 'Son 7 günün özeti, konu analizi ve çalışma planı']
});
const DAYS = { sat: ['Cumartesi', 6], sun: ['Pazar', 0] };
const INT = [1, 3, 7, 14]; // aralıklı tekrar günleri
const COLORS = ['#f0b45a', '#4fd1b5', '#6ea8fe', '#f0708a', '#a995f5', '#fbbf24'];
const saveTm = {};
function saveData(k) {
  if (state.noSave) return;
  clearTimeout(saveTm[k]); dirty.add(k);
  saveTm[k] = setTimeout(() => { dirty.delete(k); api('/api/data/' + k, { data: state[k] }, 'PUT').catch(e => toast('Kaydedilemedi: ' + e.message, 1)); }, 500);
}
// Kayıtlar 0,5 sn geciktirilerek toplu gönderilir; sayfa kapanırken/yenilenirken bekleyenler hemen gönderilir (veri kaybolmaz)
const dirty = new Set();
function flushSaves() {
  const put = (url, body) => { const s = JSON.stringify(body); return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: s, keepalive: s.length < 60000 }).catch(() => {}); };
  dirty.forEach(k => { clearTimeout(saveTm[k]); put('/api/data/' + k, { data: state[k] }); }); dirty.clear();
  if (window.__archDirty) { clearTimeout(saveT); put('/api/archive', { archive: state.archive }); window.__archDirty = false; }
}
addEventListener('pagehide', flushSaves);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });
const cnt = k => state.meta.counters?.[k] || 0;
function addCounter(k, n = 1) { const c = state.meta.counters || (state.meta.counters = {}); c[k] = (c[k] || 0) + n; saveData('meta'); checkMissions(); }

/* ---------- Görevler (seviyeli) ---------- */
const known = () => state.decks.reduce((s, d) => s + d.cards.filter(c => c.known).length, 0);
function bestStreak() {
  const ds = [...new Set(state.archive.map(a => day(a.ts || a.id)))].sort(); let b = 0, c = 0, p = null;
  ds.forEach(d => { c = p && new Date(d) - new Date(p) === 864e5 ? c + 1 : 1; b = Math.max(b, c); p = d; });
  return b;
}
const MISSIONS = [
  { id: 'q', icon: 'fa-bullseye', color: '#f0b45a', name: 'Soru Avcısı', desc: n => `${n} soru çöz`, tiers: [100, 500, 1000, 2500, 5000], val: () => state.archive.reduce((s, a) => s + a.total, 0) },
  { id: 'ex', icon: 'fa-flag-checkered', color: '#6ea8fe', name: 'Sınav Maratoncusu', desc: n => `${n} sınav tamamla`, tiers: [5, 25, 50, 100, 250], val: () => state.archive.length },
  { id: 'st', icon: 'fa-fire', color: '#f0708a', name: 'Seri Ustası', desc: n => `${n} gün üst üste çalış`, tiers: [3, 7, 14, 30, 100], val: bestStreak },
  { id: 'pf', icon: 'fa-crown', color: '#fbbf24', name: 'Mükemmeliyetçi', desc: n => `${n} sınavdan 100 al`, tiers: [1, 5, 15, 30, 60], val: () => state.archive.filter(a => a.score >= 100).length },
  { id: 'fx', icon: 'fa-screwdriver-wrench', color: '#4fd1b5', name: 'Hata Avcısı', desc: n => `${n} yanlışını düzelt`, tiers: [10, 50, 150, 400, 1000], val: () => cnt('fixed') },
  { id: 'mz', icon: 'fa-brain', color: '#a995f5', name: 'Ezber Ustası', desc: n => `${n} kartı ezberle`, tiers: [25, 100, 300, 1000, 2500], val: known },
  { id: 'sh', icon: 'fa-share-nodes', color: '#8ab4ff', name: 'Paylaşımcı', desc: n => `${n} sınav paylaş`, tiers: [1, 5, 15, 30, 60], val: () => cnt('shares') },
  { id: 'wk', icon: 'fa-calendar-check', color: '#5eead4', name: 'Düzenli Değerlendirme', desc: n => `${n} haftalık rapor tamamla`, tiers: [1, 4, 12, 26, 52], val: () => cnt('reviews') },
  { id: 'rv', icon: 'fa-robot', color: '#f0abfc', name: 'Rakip Avcısı', desc: n => `Sanal rakibi ${n} kez yen`, tiers: [1, 5, 15, 40, 100], val: () => cnt('wins') }
];
// Tanımlı seviyeler bitince hedef iki katına çıkarak sonsuza kadar sürer
const tierAt = (m, i) => (i < m.tiers.length ? m.tiers[i] : m.tiers[m.tiers.length - 1] * 2 ** (i - m.tiers.length + 1));
function lvlOf(m) { const v = m.val(); let l = 0; while (v >= tierAt(m, l)) l++; return l; }
function checkMissions() {
  const ml = state.meta.ml || (state.meta.ml = {}); let up = false;
  MISSIONS.forEach(m => {
    const l = lvlOf(m);
    if (l > (ml[m.id] || 0)) {
      ml[m.id] = l; up = true;
      toast(`🏆 ${m.name} · Seviye ${l} tamamlandı! Yeni hedef: ${m.desc(tierAt(m, l))}`);
      window.confetti && confetti({ particleCount: 90, spread: 65, origin: { y: .4 } });
    }
  });
  if (up) saveData('meta');
}
const mProg = m => { const v = m.val(), l = lvlOf(m), nx = tierAt(m, l), pv = l ? tierAt(m, l - 1) : 0; return { v, l, nx, p: Math.min(100, (v - pv) / (nx - pv) * 100) }; };
function renderMissions() {
  $('view-missions').innerHTML = '<div class="g3">' + MISSIONS.map(m => {
    const { v, l, nx, p } = mProg(m);
    return `<div class="card lift ms-c"><div class="ms-i" style="--c:${m.color}"><i class="fa-solid ${m.icon}"></i></div>
    <div class="row sp"><b>${m.name}</b><span class="chip">Seviye ${l}</span></div><div class="muted">${m.desc(nx)}</div>
    <div class="pbar"><div style="width:${p}%;background:${m.color}"></div></div>
    <div class="row sp muted"><span>${v} / ${nx}</span><span>%${Math.round(p)}</span></div>
    <div class="dots">${[...Array(Math.max(5, l + 1))].map((_, i) => `<i style="${i < l ? 'background:' + m.color : ''}"></i>`).join('')}</div></div>`;
  }).join('') + '</div>';
}

/* ---------- Aralıklı tekrar ---------- */
const qk = q => { let h = 0; for (const c of q.question) h = (h * 31 + c.charCodeAt(0)) | 0; return 'q' + h; };
function srsUpdate(quiz, scores) {
  const now = Date.now(); let fx = 0;
  quiz.questions.forEach(q => {
    const k = qk(q), e = state.srs[k];
    if (scores[q.id] === 1) {
      if (e && now >= e.due) { e.box++; if (e.box >= INT.length) { delete state.srs[k]; fx++; } else e.due = now + INT[e.box] * 864e5; }
    } else state.srs[k] = { box: 0, due: now + 864e5, q: { question: q.question, options: q.options || [], correctAnswer: q.correctAnswer, explanation: q.explanation, topic: q.topic || '' } };
  });
  saveData('srs'); if (fx) addCounter('fixed', fx);
}
const dueQs = () => Object.values(state.srs).filter(e => e.due <= Date.now()).map(e => ({ ...e.q }));
function startSrs() {
  const l = dueQs(); if (!l.length) return toast('Şu an tekrar zamanı gelen soru yok.');
  openQuiz({ title: 'Aralıklı tekrar', questions: l.sort(() => Math.random() - .5).slice(0, 15).map((q, i) => ({ ...q, isBonus: false, id: i + 1 })) }, { review: true, timer: 0 });
}

/* ---------- Dersler (klasörler) ---------- */
const courseOf = id => state.meta.courses?.find(c => c.id === id);
function newCourse() {
  const n = (prompt('Ders adı (ör. Tarih, Fizik):') || '').trim().slice(0, 30); if (!n) return null;
  const c = { id: 'c' + Date.now().toString(36), name: n, color: COLORS[state.meta.courses.length % COLORS.length] };
  state.meta.courses.push(c); saveData('meta'); fillCourseSel(); return c;
}
function fillCourseSel() {
  const o = '<option value="">Otomatik algıla</option><option value="none">Ders yok</option>' + (state.meta.courses || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  ['course-sel', 'ez-course'].forEach(id => { const e = $(id); if (e) { const v = e.value; e.innerHTML = o; e.value = v; } });
}
function delCourse(id) {
  if (!confirm('Ders silinsin mi? İçindeki sınavlar silinmez, "dersi yok" olur.')) return;
  state.meta.courses = state.meta.courses.filter(c => c.id !== id);
  state.archive.forEach(a => a.course === id && (a.course = null)); state.decks.forEach(d => d.course === id && (d.course = null));
  arcFilter = 'all'; saveData('meta'); saveData('decks'); save(); fillCourseSel(); renderArchive();
}
function setCourse(i, v) { state.archive[i].course = v || null; save(); renderArchive(); }
let arcFilter = 'all';
function renderArchive() {
  const cs = state.meta.courses || [], b = 'class="opt-btn" style="flex:none;padding:6px 14px"';
  const chips = `<div class="row" style="flex-wrap:wrap;gap:8px"><button ${b.replace('"opt-btn"', `"opt-btn ${arcFilter === 'all' ? 'sel' : ''}"`)} onclick="arcFilter='all';renderArchive()">Tümü</button>` +
    cs.map(c => `<button ${b.replace('"opt-btn"', `"opt-btn ${arcFilter === c.id ? 'sel' : ''}"`)} onclick="arcFilter='${c.id}';renderArchive()"><i class="fa-solid fa-folder" style="color:${c.color}"></i> ${esc(c.name)}</button>`).join('') +
    `<button class="btn" style="padding:6px 12px" onclick="newCourse();renderArchive()">+ Ders</button>${courseOf(arcFilter) ? `<button class="btn btn-r" style="padding:6px 12px" onclick="delCourse('${arcFilter}')">Dersi sil</button>` : ''}</div>`;
  const list = state.archive.map((a, i) => [a, i]).filter(([a]) => arcFilter === 'all' || a.course === arcFilter);
  $('archive-grid').innerHTML = analyticsHTML('a') + chips + (list.length ? list.map(([a, i]) => `<div class="card lift q"><div class="row sp"><span class="muted">${new Date(a.ts || a.id).toLocaleDateString('tr-TR')}</span><div class="row" style="gap:6px"><span class="chip" style="background:rgba(79,209,181,.15);color:var(--tl)">${a.correct}/${a.total} doğru</span><span class="chip">Not ${a.score}</span></div></div>
    <h4 style="font-size:17px">${esc(a.title)}</h4>
    <div class="row sp" style="flex-wrap:wrap">${(a.wrong || []).length ? `<div class="muted" style="color:var(--ro)"><i class="fa-solid fa-triangle-exclamation"></i> ${a.wrong.length} yanlış soru</div>` : `<div class="muted" style="color:var(--tl)"><i class="fa-solid fa-circle-check"></i> Hiç yanlışın yok</div>`}
    <select onchange="setCourse(${i},this.value)" style="width:auto;padding:6px 10px;font-size:11px" aria-label="Ders"><option value="">Ders yok</option>${cs.map(c => `<option value="${c.id}" ${a.course === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="row" style="flex-wrap:wrap"><button class="btn btn-a" onclick="openQuiz(state.archive[${i}].quizData,{timer:0,review:true})">Tekrar çöz</button>${(a.wrong || []).length ? `<button class="btn btn-r" onclick="mistakeQuiz(state.archive[${i}].wrong.map(w=>({...w})))">Yanlışlarla sınav yap</button>` : ''}<button class="btn" onclick="shareQuiz(${i})"><i class="fa-solid fa-share-nodes"></i> ${a.shareCode ? 'Paylaşım' : 'Paylaş'}</button><button class="btn" onclick="delArchive(${i})" aria-label="Sil"><i class="fa-solid fa-trash"></i></button></div></div>`).join('')
    : '<div class="card muted">Bu klasörde sınav yok.</div>');
  drawAnalytics('a', list.map(([a]) => a));
}

/* ---------- Paylaşım ---------- */
function dlg(html) {
  let d = $('dlg'); if (!d) { d = document.createElement('dialog'); d.id = 'dlg'; document.body.appendChild(d); }
  d.innerHTML = html + '<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" onclick="$(\'dlg\').close()">Kapat</button></div>'; d.showModal();
}
const board = r => r.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">${r.map((x, i) => `<div class="item" style="cursor:default"><span>${i + 1}. <b>${esc(x.username)}</b></span><span class="chip">${x.score} puan · ${x.correct}/${x.total}</span></div>`).join('')}</div>` : '<p class="muted" style="margin-top:10px">Henüz kimse çözmedi.</p>';
async function shareQuiz(i) {
  const a = state.archive[i];
  try {
    if (!a.shareCode) { a.shareCode = (await api('/api/shares', { quiz: a.quizData })).code; save(); addCounter('shares'); }
    const s = await api('/api/shares/' + a.shareCode), link = `${location.origin}/?s=${a.shareCode}`;
    dlg(`<h3>Sınavı paylaş</h3><p class="muted" style="margin:6px 0 12px">Bu bağlantıyı arkadaşına gönder. Hesabıyla girince sınavı çözer, sonuçlar burada karşılaştırılır.</p><div class="row"><input readonly value="${link}" id="sh-link" onclick="this.select()"><button class="btn btn-a" onclick="navigator.clipboard.writeText($('sh-link').value).then(()=>toast('Bağlantı kopyalandı.'))">Kopyala</button></div><h4 style="margin-top:18px">Sonuçlar</h4>${board(s.results)}`);
  } catch (e) { toast(e.message, 1); }
}
async function handleShareLink() {
  const c = new URLSearchParams(location.search).get('s'); if (!c) return;
  history.replaceState(null, '', '/');
  try {
    const s = await api('/api/shares/' + encodeURIComponent(c)); window._sh = s;
    dlg(`<h3>${esc(s.owner)} seninle bir sınav paylaştı</h3><p style="margin:10px 0"><b>${esc(s.title)}</b> · ${s.quiz.questions.length} soru</p><button class="btn btn-a" onclick="$('dlg').close();openQuiz(window._sh.quiz,{timer:0,share:'${s.code}'})">Sınavı çöz</button><h4 style="margin-top:18px">Şu ana kadar</h4>${board(s.results)}`);
  } catch (e) { toast(e.message, 1); }
}

/* ---------- Sınav bitince ---------- */
async function afterQuiz(quiz, scores, item) {
  state.lastResult = { quiz, A: { ...state.answers } };
  document.querySelectorAll('#r-list > .card').forEach((c, i) => { // paylaşım tablosu eklenmeden önce, kart sırası = soru sırası
    const q = quiz.questions[i];
    if (q && scores[q.id] !== 1) c.insertAdjacentHTML('beforeend', `<div class="noprint"><button class="btn coach-btn" onclick="coachResult(${i})"><i class="fa-solid fa-comments"></i> Hocama sor</button></div>`);
  });
  srsUpdate(quiz, scores);
  const c = state.cfg?.share;
  if (c) {
    try { const r = await api(`/api/shares/${c}/result`, { score: item.score, correct: item.correct, total: item.total }); $('r-list').insertAdjacentHTML('afterbegin', `<div class="card"><h4>Sonuç karşılaştırması</h4>${board(r.results)}</div>`); }
    catch (e) { toast(e.message, 1); }
  }
  checkMissions();
}

/* ---------- Haftalık değerlendirme ---------- */
function wkDue() {
  const d = state.meta.reviewDay; if (!d) return false;
  const t = new Date(); t.setHours(0, 0, 0, 0); while (t.getDay() !== DAYS[d][1]) t.setDate(t.getDate() - 1);
  return (state.meta.lastReview || 0) < t.getTime();
}
function nextWk() { const t = new Date(); t.setHours(0, 0, 0, 0); do t.setDate(t.getDate() + 1); while (t.getDay() !== DAYS[state.meta.reviewDay][1]); return t.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }); }
function setReviewDay(d) {
  state.meta.reviewDay = d; state.meta.lastReview = Date.now(); saveData('meta');
  toast(`Haftalık değerlendirme her ${DAYS[d][0]} günü ilk girişte gösterilecek.`);
  renderDashExtras(); if (!$('view-weekly').classList.contains('hidden')) renderWeekly();
}
function maybeWeekly() { if (wkDue()) { state.meta.lastReview = Date.now(); addCounter('reviews'); saveData('meta'); switchTab('weekly'); } }
function topicStats(items) {
  const m = {};
  items.forEach(a => {
    const wr = new Set((a.wrong || []).map(w => w.question));
    (a.quizData?.questions || []).forEach(q => { const t = q.topic || a.title, o = m[t] || (m[t] = { topic: t, total: 0, wrong: 0 }); o.total++; if (wr.has(q.question)) o.wrong++; });
  });
  return Object.values(m).sort((a, b) => (a.total - a.wrong) / a.total - (b.total - b.wrong) / b.total);
}
const coachHTML = c => `<p style="line-height:1.7;color:#c3cce2">${esc(c.summary)}</p>${c.focus.length ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin:12px 0">${c.focus.map(f => `<span class="chip" style="background:rgba(240,112,138,.15);color:var(--ro)">${esc(f)}</span>`).join('')}</div>` : ''}<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">${c.plan.map(p => `<div class="item" style="cursor:default"><b style="min-width:86px">${esc(p.day)}</b><span style="flex:1;font-size:13px">${esc(p.task)}</span></div>`).join('')}</div><p class="muted" style="margin-top:12px"><i class="fa-solid fa-heart" style="color:var(--ro)"></i> ${esc(c.motivation)}</p>`;
function localCoach(topics, due) {
  const w = topics.filter(t => t.wrong / t.total >= .4).slice(0, 3).map(t => t.topic), d = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  return { summary: topics.length ? 'Yapay zekâ koçuna şu an ulaşılamadı; verilerine göre hazır bir plan çıkardım.' : 'Bu hafta sınav çözmedin. Küçük adımlarla başlayalım.', focus: w, motivation: 'Her gün biraz, haftada çok şey demektir.',
    plan: d.map((x, i) => ({ day: x, task: i === 6 ? 'Haftayı gözden geçir, dinlen.' : i % 2 ? (due ? 'Aralıklı tekrar sorularını çöz.' : 'Ezber kartlarından bir deste çalış.') : (w[i % (w.length || 1)] ? w[i % w.length] + ' konusundan 10 soru çöz.' : 'Yeni bir sınav hazırla ve çöz.') })) };
}
async function renderWeekly() {
  const v = $('view-weekly'), now = Date.now(), W = 7 * 864e5, A = state.archive;
  const cur = A.filter(a => now - (a.ts || a.id) < W), prev = A.filter(a => { const d = now - (a.ts || a.id); return d >= W && d < 2 * W; });
  const avg = l => (l.length ? Math.round(l.reduce((s, a) => s + a.score, 0) / l.length) : null);
  const tq = cur.reduce((s, a) => s + a.total, 0), tc = cur.reduce((s, a) => s + a.correct, 0), av = avg(cur), pa = avg(prev), topics = topicStats(cur), due = dueQs().length;
  const dl = av !== null && pa !== null ? av - pa : null, rd = state.meta.reviewDay;
  const sc = (l, x, c) => `<div class="card stat"><div class="muted">${l}</div><div class="num" style="color:${c}">${x}</div></div>`;
  v.innerHTML = `<div class="card row sp" style="flex-wrap:wrap"><div><span class="chip">Son 7 gün</span><h3 style="font-size:20px;margin-top:6px">Haftalık rapor</h3><p class="muted">Rapor günü: ${['sat', 'sun'].map(d => `<button class="opt-btn ${rd === d ? 'sel' : ''}" style="flex:none;padding:4px 12px;margin-left:6px" onclick="setReviewDay('${d}')">${DAYS[d][0]}</button>`).join('')}</p></div><button class="btn" onclick="switchTab('dashboard')">Ana panele dön</button></div>
  <div class="g4">${sc('Çözülen sınav', cur.length, 'var(--bl)')}${sc('Çözülen soru', tq, 'var(--am)')}${sc('Ortalama not', av ?? '–', 'var(--tl)')}${sc('Geçen haftaya göre', dl === null ? '–' : (dl > 0 ? '+' : '') + dl, dl < 0 ? 'var(--ro)' : 'var(--vi)')}</div>
  <div class="card"><h3 style="font-size:16px;margin-bottom:14px">Konu bazlı başarı</h3>${topics.length ? topics.map(t => { const p = Math.round((t.total - t.wrong) / t.total * 100), c = p < 50 ? 'var(--ro)' : p < 75 ? 'var(--am)' : 'var(--tl)'; return `<div class="tb"><div class="row sp"><b style="font-size:13px">${esc(t.topic)}</b><span class="muted">%${p} · ${t.total - t.wrong}/${t.total} doğru</span></div><div class="pbar" style="margin-top:6px"><div style="width:${p}%;background:${c}"></div></div></div>`; }).join('') : '<p class="muted">Bu hafta sınav çözmediğin için konu analizi yok.</p>'}</div>
  <div class="card"><h3 style="font-size:16px;margin-bottom:14px"><i class="fa-solid fa-user-graduate" style="color:var(--am)"></i> Çalışma koçun</h3><div id="wk-coach" class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Planın hazırlanıyor…</div></div>
  <div class="card row sp" style="flex-wrap:wrap"><div><h3 style="font-size:16px"><i class="fa-solid fa-rotate" style="color:var(--tl)"></i> Aralıklı tekrar</h3><p class="muted" style="margin-top:4px">${due ? `${due} soruyu tekrar etme zamanı geldi.` : 'Şu an tekrar zamanı gelen soru yok.'}</p></div><button class="btn btn-a" ${due ? '' : 'disabled'} onclick="startSrs()">Tekrar sınavını başlat</button></div>`;
  const stats = { sinav: cur.length, soru: tq, dogru: tc, ortalama: av, oncekiHaftaOrtalama: pa, zayifKonular: topics.slice(0, 4).map(t => `${t.topic} (%${Math.round((t.total - t.wrong) / t.total * 100)})`), gucluKonular: topics.slice(-2).map(t => t.topic), tekrarBekleyen: due, seri: bestStreak() };
  let c; try { c = await api('/api/coach', { stats }); if (!c.plan.length) throw 0; } catch { c = localCoach(topics, due); }
  const el = $('wk-coach'); if (el) { el.classList.remove('muted'); el.innerHTML = coachHTML(c); }
}

/* ---------- Ana panel kartları ---------- */
function renderDashExtras() {
  const el = $('dash-extra'); if (!el) return;
  const m = state.meta, due = dueQs().length, rd = m.reviewDay, tot = state.decks.reduce((s, d) => s + d.cards.length, 0), kn = known(), kp = tot ? Math.round(kn / tot * 100) : 0;
  const top = MISSIONS.map(x => ({ x, ...mProg(x) })).sort((a, b) => b.p - a.p).slice(0, 3);
  el.innerHTML = analyticsHTML('d') + `<div class="g2">
  <div class="card"><h3 style="font-size:15px"><i class="fa-solid fa-calendar-week" style="color:var(--am)"></i> Haftalık değerlendirme</h3>
    ${rd ? `<p class="muted" style="margin:10px 0 14px">${wkDue() ? 'Raporun hazır!' : `Sonraki rapor: <b style="color:var(--tx)">${DAYS[rd][0]}, ${nextWk()}</b>. O günden sonraki ilk girişinde otomatik açılır.`}</p>` : '<p class="muted" style="margin:10px 0 14px">Rapor için bir gün seç: o günden sonraki ilk girişinde konu analizi ve çalışma planın karşına çıkar.</p>'}
    <div class="row" style="flex-wrap:wrap">${['sat', 'sun'].map(d => `<button class="opt-btn ${rd === d ? 'sel' : ''}" style="flex:none;padding:8px 16px" onclick="setReviewDay('${d}')">${DAYS[d][0]}</button>`).join('')}<button class="btn" onclick="switchTab('weekly')">Raporu şimdi aç</button></div></div>
  <div class="card"><h3 style="font-size:15px"><i class="fa-solid fa-rotate" style="color:var(--tl)"></i> Aralıklı tekrar</h3><div class="num" style="font-size:38px;font-weight:800;margin:10px 0">${due}<span class="muted" style="font-size:13px;font-family:Manrope"> soru bekliyor</span></div><p class="muted" style="margin-bottom:14px">Yanlışların 1, 3, 7 ve 14 gün sonra tekrar karşına çıkar.</p><button class="btn btn-a" ${due ? '' : 'disabled'} onclick="startSrs()">Tekrarı başlat</button></div></div>
  <div class="g2">
  <div class="card"><h3 style="font-size:15px"><i class="fa-solid fa-layer-group" style="color:var(--vi)"></i> Ezber</h3><p class="muted" style="margin:10px 0">${state.decks.length ? `${state.decks.length} deste · ${kn}/${tot} kart ezberlendi` : 'Bir konu yaz, yapay zekâ ezber kartlarını hazırlasın.'}</p><div class="pbar" style="margin-bottom:14px"><div style="width:${kp}%;background:var(--vi)"></div></div><button class="btn btn-a" onclick="switchTab('ezber')">Ezbere git</button></div>
  <div class="card"><div class="row sp" style="margin-bottom:12px"><h3 style="font-size:15px"><i class="fa-solid fa-trophy" style="color:var(--am)"></i> Görevler</h3><button class="btn" style="padding:5px 10px;font-size:11px" onclick="switchTab('missions')">Tümü</button></div>
    ${top.map(t => `<div class="row" style="margin-bottom:10px"><div class="ms-i" style="--c:${t.x.color};width:38px;height:38px;font-size:16px;border-radius:11px"><i class="fa-solid ${t.x.icon}"></i></div><div style="flex:1;min-width:0"><div class="row sp"><b style="font-size:12px">${t.x.name} · Sv ${t.l}</b><span class="muted">${t.v}/${t.nx}</span></div><div class="pbar" style="margin-top:5px"><div style="width:${t.p}%;background:${t.x.color}"></div></div></div></div>`).join('')}</div></div>`;
  drawAnalytics('d', state.archive);
}

/* ---------- Ezber ---------- */
const ez = { mode: null, deck: null, q: [], flip: false, type: false, res: null };
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
function ezCmp(a, b) { const x = norm(a), y = norm(b); if (!x) return 0; if (y.split(' ').length <= 3) return x.includes(y) || y.includes(x) ? 1 : 0; return kwCheck(a, b); }
function renderEzber() {
  const v = $('view-ezber');
  if (ez.mode === 'study') return (v.innerHTML = studyHTML());
  const kn = d => d.cards.filter(c => c.known).length;
  v.innerHTML = `<form class="card stack" onsubmit="genDeck(event)"><div><h3 style="font-size:16px">Ezber destesi oluştur</h3><p class="muted">Bir konu yaz; yapay zekâ ezberlemen gereken bilgileri kısa kartlara ve hafıza ipuçlarına çevirsin.</p></div>
  <div class="g2"><div><label class="f" for="ez-topic">Konu</label><input id="ez-topic" placeholder="Örn: Kurtuluş Savaşı cepheleri ve tarihleri" required></div>
  <div class="g2" style="gap:12px"><div><label class="f" for="ez-n">Kart sayısı</label><select id="ez-n"><option>10</option><option selected>15</option><option>20</option><option>30</option></select></div><div><label class="f" for="ez-course">Ders</label><div class="row" style="gap:6px"><select id="ez-course"></select><button type="button" class="btn" style="flex-shrink:0" onclick="const c=newCourse();if(c)$('ez-course').value=c.id">+ Ders</button></div></div></div></div>
  <details><summary class="muted" style="cursor:pointer">Kendi notlarımdan üret (isteğe bağlı)</summary><textarea id="ez-mat" rows="5" style="margin-top:10px" placeholder="Notlarını yapıştır; kartlar sadece bunlardan çıkarılır."></textarea></details>
  <div class="row" style="justify-content:flex-end"><button class="btn btn-a" id="ez-go"><i class="fa-solid fa-layer-group"></i> Kartları hazırla</button></div></form>
  <div class="g3">${state.decks.map(d => { const k = kn(d), p = Math.round(k / d.cards.length * 100), c = courseOf(d.course); return `<div class="card lift deck"><div class="row sp">${c ? `<span class="chip" style="color:${c.color}">${esc(c.name)}</span>` : '<span></span>'}<span class="muted">${d.cards.length} kart</span></div><h4>${esc(d.name)}</h4><div class="pbar"><div style="width:${p}%;background:var(--vi)"></div></div><div class="muted">${k}/${d.cards.length} ezberlendi</div><div class="row" style="flex-wrap:wrap"><button class="btn btn-a" onclick="startStudy('${d.id}',false)">Kart çalış</button><button class="btn" onclick="startStudy('${d.id}',true)">Yazarak</button><button class="btn" onclick="delDeck('${d.id}')" aria-label="Sil"><i class="fa-solid fa-trash"></i></button></div></div>`; }).join('')}</div>`;
  fillCourseSel();
}
async function genDeck(e) {
  e.preventDefault(); const topic = $('ez-topic').value.trim(), b = $('ez-go'), html = b.innerHTML;
  b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Kartlar hazırlanıyor…';
  try {
    const csel = $('ez-course').value, d = await api('/api/ezber', { topic, material: $('ez-mat').value, count: +$('ez-n').value, courses: state.meta.courses.map(c => c.name) });
    let course = csel && csel !== 'none' ? csel : null;
    if (!csel && d.course) { const c = state.meta.courses.find(x => x.name.toLowerCase() === d.course.toLowerCase()); if (c) { course = c.id; toast('Ders algılandı: ' + c.name); } }
    const deck = { id: 'd' + Date.now().toString(36), name: d.title, topic, course, tip: d.tip, created: Date.now(), cards: d.cards.map((c, i) => ({ id: i, f: c.f, b: c.b, m: c.m, known: false })) };
    state.decks.unshift(deck); saveData('decks'); toast('Deste hazır: ' + deck.name); startStudy(deck.id, false);
  } catch (x) { toast(x.message, 1); b.disabled = false; b.innerHTML = html; }
}
function delDeck(id) { if (confirm('Bu deste silinsin mi?')) { state.decks = state.decks.filter(d => d.id !== id); saveData('decks'); renderEzber(); renderDashExtras(); } }
function startStudy(id, type) {
  ez.deck = state.decks.find(d => d.id === id); ez.type = type;
  if (ez.deck.cards.every(c => c.known)) ez.deck.cards.forEach(c => (c.known = false));
  ez.q = ez.deck.cards.filter(c => !c.known).sort(() => Math.random() - .5); ez.flip = false; ez.res = null; ez.mode = 'study'; renderEzber();
}
function studyHTML() {
  const d = ez.deck, k = d.cards.filter(c => c.known).length, n = d.cards.length;
  const top = `<div class="card"><div class="row sp" style="flex-wrap:wrap"><div class="row"><button class="btn" onclick="ez.mode=null;renderEzber();renderDashExtras()"><i class="fa-solid fa-arrow-left"></i> Destelerim</button><h3 style="font-size:17px">${esc(d.name)}</h3></div><span class="muted">${k}/${n} ezberlendi</span></div><div class="pbar" style="margin-top:12px"><div style="width:${k / n * 100}%;background:var(--vi)"></div></div>${d.tip ? `<p class="muted" style="margin-top:12px"><i class="fa-solid fa-lightbulb" style="color:var(--am)"></i> ${esc(d.tip)}</p>` : ''}</div>`;
  if (!ez.q.length) return top + `<div class="card" style="text-align:center;padding:44px"><h3 style="font-size:24px">Deste tamamlandı 🎉</h3><p class="muted" style="margin:10px 0 20px">Bütün kartları ezberledin. Pekiştirmek için baştan çalışabilirsin.</p><div class="row" style="justify-content:center"><button class="btn btn-a" onclick="startStudy('${d.id}',${ez.type})">Baştan çalış</button><button class="btn" onclick="ez.mode=null;renderEzber()">Destelerim</button></div></div>`;
  const c = ez.q[0];
  if (ez.type) return top + `<div class="card stack" style="max-width:640px;margin:20px auto 0;width:100%"><small class="muted">Soru · kalan ${ez.q.length}</small><p style="font:700 21px/1.4 'Bricolage Grotesque'">${esc(c.f)}</p>
    ${ez.res ? `<div style="padding:14px;border-radius:12px;background:var(--bg);line-height:1.7"><b style="color:${ez.res.s === 1 ? 'var(--tl)' : ez.res.s ? 'var(--am)' : 'var(--ro)'}">${ez.res.s === 1 ? 'Doğru!' : ez.res.s ? 'Kısmen doğru' : 'Yanlış'}</b><div class="muted">Cevabın: ${esc(ez.res.a) || '—'}</div><div><b style="color:var(--tl)">Doğrusu:</b> ${esc(c.b)}</div>${c.m ? `<div class="mn" style="margin-top:8px"><i class="fa-solid fa-lightbulb"></i> ${esc(c.m)}</div>` : ''}</div><div class="row" style="justify-content:flex-end"><button class="btn" onclick="ezMark(false)">Tekrar göster</button><button class="btn btn-a" onclick="ezMark(true)">Doğru say</button></div>`
    : `<textarea id="ez-ans" rows="2" placeholder="Cevabını yaz…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ezCheck()}"></textarea><div class="row" style="justify-content:flex-end"><button class="btn" onclick="ezMark(false)">Bilmiyorum</button><button class="btn btn-a" onclick="ezCheck()">Kontrol et</button></div>`}</div>`;
  return top + `<div class="flip ${ez.flip ? 'on' : ''}" style="margin-top:20px" onclick="ezFlip()"><div class="in"><div class="fc"><small>Soru · kalan ${ez.q.length}</small><p>${esc(c.f)}</p><span class="kbd">Çevirmek için tıkla veya Boşluk tuşuna bas</span></div><div class="fc b"><small>Cevap</small><p>${esc(c.b)}</p>${c.m ? `<div class="mn"><i class="fa-solid fa-lightbulb"></i> ${esc(c.m)}</div>` : ''}</div></div></div>
    <div class="row ${ez.flip ? '' : 'hidden'}" id="ez-btns" style="justify-content:center;margin-top:18px"><button class="btn btn-r" onclick="ezMark(false)"><i class="fa-solid fa-rotate-left"></i> Tekrar göster <span class="kbd">←</span></button><button class="btn btn-a" onclick="ezMark(true)"><i class="fa-solid fa-check"></i> Biliyorum <span class="kbd">→</span></button></div>`;
}
function ezFlip() { ez.flip = !ez.flip; document.querySelector('.flip')?.classList.toggle('on', ez.flip); $('ez-btns')?.classList.toggle('hidden', !ez.flip); }
function ezCheck() { const a = $('ez-ans').value; ez.res = { a, s: ezCmp(a, ez.q[0].b) }; renderEzber(); }
function ezMark(ok) {
  const c = ez.q.shift(); if (ok) { c.known = true; saveData('decks'); checkMissions(); } else ez.q.push(c);
  ez.flip = false; ez.res = null; renderEzber();
  if (!ez.q.length && window.confetti) confetti({ particleCount: 100, spread: 70, origin: { y: .4 } });
}
document.addEventListener('keydown', e => {
  if (ez.mode !== 'study' || ez.type || $('view-ezber').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !ez.q.length) return;
  if (e.code === 'Space') { e.preventDefault(); ezFlip(); }
  else if (ez.flip && e.key === 'ArrowRight') ezMark(true);
  else if (ez.flip && e.key === 'ArrowLeft') ezMark(false);
});

/* ---------- Mevcut fonksiyonlara bağlantı ---------- */
async function loadExtras() {
  const bs = window.__bs, g = async (k, d) => (bs ? bs[k] : (await api('/api/data/' + k)).data) ?? d; // açılış paketi varsa ağa gitmez
  try { [state.decks, state.srs, state.meta] = await Promise.all([g('decks', []), g('srs', {}), g('meta', {})]); state.noSave = false; }
  catch (e) { state.noSave = true; toast('Ezber/görev verileri yüklenemedi, sayfayı yenile. (' + e.message + ')', 1); }
  const m = state.meta; m.courses = m.courses || []; m.counters = m.counters || {};
  fillCourseSel();
}
const _sw = switchTab;
switchTab = function (t, k) {
  _sw(t, k);
  if (t === 'ezber') { ez.mode = null; renderEzber(); }
  if (t === 'missions') renderMissions();
  if (t === 'weekly') renderWeekly();
};
const _rd = renderDash;
renderDash = function () { _rd(); renderDashExtras(); };
const _en = enter;
enter = async function (u) {
  await loadExtras(); await _en(u); window.__bs = null;
  if (!state.meta.ml) { state.meta.ml = {}; MISSIONS.forEach(m => (state.meta.ml[m.id] = lvlOf(m))); saveData('meta'); } // eski verideki seviyeler sessizce işlenir
  maybeWeekly();
  if (!state.meta.profile) { window._onbDone = handleShareLink; openOnboarding(false); } else handleShareLink();
};

/* ---------- Sınıf / dönem profili ve ders listesi ---------- */
const GRADES = [...Array(12)].map((_, i) => `${i + 1}. sınıf`).concat(['Mezun / YKS hazırlık', 'Üniversite']);
const levelText = () => { const p = state.meta?.profile; return p && p.grade ? `${p.grade}${p.term ? ', ' + p.term + '. dönem' : ''}${p.field ? ', ' + p.field : ''}` : ''; };
function qcLabel() {
  const b = $('bonus')?.checked, d = $('duel')?.checked;
  $('qc-val').textContent = `${$('qcount').value} soru${b ? ' + 1 bonus' : ''}`;
  const on = [b && 'Bonus', d && 'Rakip'].filter(Boolean); $('extra-sum').textContent = on.length ? on.join(' · ') : 'Kapalı';
}
function openOnboarding(edit, done) {
  let d = $('onb'); if (!d) { d = document.createElement('dialog'); d.id = 'onb'; document.body.appendChild(d); }
  if (done) window._onbDone = done;
  d.oncancel = e => { if (!edit) e.preventDefault(); }; // ilk girişte Esc ile kapanmaz
  const p = state.meta.profile || {}, m = new Date().getMonth(), t = p.term || (m >= 8 || m === 0 ? '1' : '2');
  d.innerHTML = `<h3 style="font-size:20px">${edit ? 'Sınıf ve dönem' : 'Hoş geldin! Seni tanıyalım 👋'}</h3><p class="muted" style="margin:6px 0 16px">Şu anki sınıfını ve dönemini seç; o sınıfın derslerini senin için hazırlayalım. Sınavların da bu derslere göre otomatik düzenlensin.</p>
  <form onsubmit="onbSubmit(event)"><label class="f" for="onb-g">Sınıf</label><select id="onb-g">${GRADES.map(g => `<option ${g === p.grade ? 'selected' : ''}>${g}</option>`).join('')}</select>
  <label class="f" for="onb-t" style="margin-top:14px">Dönem</label><select id="onb-t"><option value="1" ${t === '1' ? 'selected' : ''}>1. Dönem</option><option value="2" ${t === '2' ? 'selected' : ''}>2. Dönem</option></select>
  <label class="f" for="onb-fld" style="margin-top:14px">Alan / bölüm (isteğe bağlı)</label><input id="onb-fld" value="${esc(p.field || '')}" placeholder="Örn: Sayısal, Sözel, Bilgisayar Mühendisliği">
  <div class="row" style="justify-content:flex-end;margin-top:20px">${edit ? '<button type="button" class="btn" onclick="onbClose()">Vazgeç</button>' : '<button type="button" class="btn" onclick="onbSkip()">Şimdilik atla</button>'}<button class="btn btn-a">Devam</button></div></form>`;
  d.showModal();
}
async function onbSubmit(e) {
  e.preventDefault(); const g = $('onb-g').value, t = $('onb-t').value, f = $('onb-fld').value.trim(), d = $('onb');
  state.meta.profile = { grade: g, term: t, field: f, at: Date.now() }; saveData('meta');
  d.innerHTML = '<div style="text-align:center;padding:30px 10px"><i class="fa-solid fa-spinner fa-spin" style="font-size:26px;color:var(--am)"></i><p style="margin-top:14px">Dersler hazırlanıyor…</p></div>';
  try {
    const r = await api('/api/courses/suggest', { grade: g, term: t, field: f });
    const have = new Set(state.meta.courses.map(c => c.name.toLowerCase())), list = r.courses.filter(n => !have.has(n.toLowerCase()));
    d.innerHTML = `<h3 style="font-size:19px">${esc(g)} dersleri</h3><p class="muted" style="margin:6px 0 14px">${list.length ? 'Eklemek istediklerini işaretle. Sonradan ders ekleyip silebilirsin.' : 'Bu sınıfın dersleri zaten ekli.'}</p>
    <div id="onb-list" style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto">${list.map(n => `<label class="tg"><b>${esc(n)}</b><input type="checkbox" checked value="${esc(n)}"></label>`).join('')}</div>
    <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn btn-a" onclick="onbAdd()">${list.length ? 'Seçilenleri ekle' : 'Tamam'}</button></div>`;
  } catch (x) {
    d.innerHTML = `<h3 style="font-size:19px">Dersler getirilemedi</h3><p class="muted" style="margin:8px 0 16px">${esc(x.message)}<br>Bilgilerin kaydedildi; Hesabım sayfasından tekrar deneyebilirsin.</p><div class="row" style="justify-content:flex-end"><button class="btn btn-a" onclick="onbClose()">Tamam</button></div>`;
  }
}
function onbAdd() {
  const names = [...document.querySelectorAll('#onb-list input:checked')].map(i => i.value);
  names.forEach(n => state.meta.courses.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: n, color: COLORS[state.meta.courses.length % COLORS.length] }));
  if (names.length) { saveData('meta'); fillCourseSel(); toast(`${names.length} ders eklendi.`); }
  onbClose();
}
function onbSkip() { state.meta.profile = { skipped: true, at: Date.now() }; saveData('meta'); onbClose(); }
function onbClose() {
  const d = $('onb'); d.oncancel = null; d.close();
  const f = window._onbDone; window._onbDone = null; f && f();
  if (!$('view-archive').classList.contains('hidden')) renderArchive();
}
const _ra = renderAccount;
renderAccount = async function () {
  await _ra(); $('prof-card')?.remove();
  $('view-account').insertAdjacentHTML('afterbegin', `<div class="card row sp" id="prof-card" style="flex-wrap:wrap"><div><h3 style="font-size:16px">Sınıf ve dönem</h3><p class="muted" style="margin-top:4px">${esc(levelText()) || 'Henüz belirlenmedi'}</p></div><button class="btn btn-a" onclick="openOnboarding(true)">${levelText() ? 'Değiştir / dersleri yenile' : 'Belirle ve dersleri getir'}</button></div>`);
};

/* ================= AI sohbet koçu ================= */
const co = { q: null, ua: '', hist: [], busy: false };
const CO_CHIPS = ['Nerede hata yaptım?', 'Bunu daha basit açıklar mısın?', 'Benzer bir örnek verir misin?', 'Bunu nasıl akılda tutarım?'];
const ansText = (q, ua) => (ua === undefined || ua === null || ua === '' ? 'Boş bıraktı' : q.options?.length ? String(q.options[ua] ?? ua) : String(ua));
const fmtMsg = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
function openCoach(q, ua) {
  co.q = q; co.ua = ansText(q, ua); co.hist = []; co.busy = false;
  let d = $('coach'); if (!d) { d = document.createElement('dialog'); d.id = 'coach'; d.className = 'coach'; document.body.appendChild(d); }
  const right = q.options?.length ? q.options[q.correctAnswer] : q.correctAnswer;
  d.innerHTML = `<div class="co-h"><div class="ms-i" style="--c:var(--am);width:38px;height:38px;font-size:16px;border-radius:11px"><i class="fa-solid fa-user-graduate"></i></div><div style="flex:1"><b>Hocana sor</b><div class="muted">Bu soru hakkında istediğini sor</div></div><button class="btn" style="padding:6px 11px" onclick="$('coach').close()" aria-label="Kapat">✕</button></div>
  <div class="co-q"><b>Soru:</b> ${esc(q.question)}<br><b style="color:var(--tl)">Doğru cevap:</b> ${esc(right)}<br><b style="color:var(--ro)">Senin cevabın:</b> ${esc(co.ua)}</div>
  <div class="co-m" id="co-m"></div>
  <div class="co-c">${CO_CHIPS.map(c => `<button type="button" onclick="coSend(this.textContent)">${c}</button>`).join('')}</div>
  <form class="co-f" onsubmit="coSubmit(event)"><input id="co-in" placeholder="Sorunu yaz…" maxlength="1000" autocomplete="off"><button class="btn btn-a" id="co-go" aria-label="Gönder"><i class="fa-solid fa-paper-plane"></i></button></form>`;
  coAdd('a', 'Merhaba! Bu soruda takıldığını görüyorum. Aşağıdaki hazır sorulardan birini seçebilir ya da kendi sorunu yazabilirsin.');
  d.showModal(); $('co-in').focus();
}
function coAdd(role, text) { const m = $('co-m'); m.insertAdjacentHTML('beforeend', `<div class="msg ${role}">${fmtMsg(text)}</div>`); m.scrollTop = m.scrollHeight; }
function coTyping(on) { $('co-typing')?.remove(); if (on) { const m = $('co-m'); m.insertAdjacentHTML('beforeend', '<div class="msg a typing" id="co-typing"><span></span><span></span><span></span></div>'); m.scrollTop = m.scrollHeight; } }
async function coSend(text) {
  text = String(text || '').trim(); if (!text || co.busy) return;
  co.busy = true; $('co-go').disabled = true; coAdd('u', text); coTyping(true);
  try {
    const q = co.q, r = await api('/api/chat-coach', { question: { question: q.question, options: q.options || [], correctAnswer: q.correctAnswer, explanation: q.explanation, topic: q.topic || '' }, userAnswer: co.ua, history: co.hist, message: text });
    co.hist.push({ role: 'user', content: text }, { role: 'assistant', content: r.reply }); co.hist = co.hist.slice(-12);
    coTyping(false); coAdd('a', r.reply);
  } catch (e) { coTyping(false); coAdd('a', '⚠️ ' + e.message); }
  co.busy = false; $('co-go').disabled = false; $('co-in').focus();
}
function coSubmit(e) { e.preventDefault(); const i = $('co-in'), v = i.value; i.value = ''; coSend(v); }
function coachResult(i) { const { quiz, A } = state.lastResult, q = quiz.questions[i]; openCoach(q, A[q.id]); }
function coachMistake(i) { const m = allMistakes()[i]; if (m) openCoach(m, m.userAnswer); }
const _rm = renderMistakes;
renderMistakes = function () {
  _rm(); const m = allMistakes();
  document.querySelectorAll('#mistake-list > .card').forEach((c, i) => { if (m[i]) c.insertAdjacentHTML('beforeend', `<div><button class="btn coach-btn" onclick="coachMistake(${i})"><i class="fa-solid fa-comments"></i> Hocama sor</button></div>`); });
};

/* ================= Görselden soru/metin okuma (Gemini Vision) ================= */
state.imgs = [];
const IMG_OK = /^image\/(png|jpe?g|webp)$/;
async function shrink(f) { // büyük telefon fotoğraflarını küçült (yükleme ve okuma daha hızlı olur)
  if (f.size < 1.5e6) return f;
  try {
    const bmp = await createImageBitmap(f), sc = Math.min(1, 1800 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
    return b ? new File([b], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
  } catch { return f; }
}
async function addFiles(fs) {
  for (const f of Array.from(fs)) { // Array.from ilk satırda: input temizlenmeden dosyalar yakalanır
    if (f.type === 'application/pdf') { if (state.pdfs.length < 10 && !state.pdfs.some(p => p.name === f.name && p.size === f.size)) state.pdfs.push(f); }
    else if (IMG_OK.test(f.type)) { if (state.imgs.length >= 6) { toast('En fazla 6 görsel yükleyebilirsin.', 1); continue; } state.imgs.push(await shrink(f)); }
    else toast(`${f.name}: desteklenmeyen dosya (PDF, PNG, JPG veya WEBP yükle).`, 1);
  }
  renderPdfs();
}
function renderPdfs() {
  $('pdf-count').textContent = `${state.pdfs.length} PDF · ${state.imgs.length} görsel`;
  const rm = (arr, i) => `<button class="btn" style="padding:3px 9px" onclick="state.${arr}.splice(${i},1);renderPdfs()" aria-label="Kaldır">×</button>`;
  $('pdf-list').innerHTML = state.pdfs.map((f, i) => `<div class="item" style="cursor:default"><span style="font-size:12px"><i class="fa-solid fa-file-pdf" style="color:var(--ro)"></i> ${esc(f.name)}</span>${rm('pdfs', i)}</div>`).join('')
    + state.imgs.map((f, i) => `<div class="item" style="cursor:default"><span style="font-size:12px;display:flex;align-items:center;gap:8px"><img src="${URL.createObjectURL(f)}" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:6px">${esc(f.name)}</span>${rm('imgs', i)}</div>`).join('');
}

/* ================= Başarı grafikleri (Chart.js) ================= */
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('yüklenemedi')); document.head.appendChild(s); });
let chartP; const loadChart = () => chartP || (chartP = loadScript('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js').catch(e => { chartP = null; throw e; }));
// Konfeti de ilk kullanımda yüklenir; yüklenene kadar çağrılar bekletilir
window.confetti = o => loadScript('https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js').then(() => { if (!window.confetti.lazy) window.confetti(o); }).catch(() => {});
window.confetti.lazy = true;
let anRange = '30', anTopic = 'bar';
const anSrc = {}, anCh = {};
const cvar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const anItems = all => (anRange === 'all' ? all : all.filter(a => (a.ts || a.id) >= Date.now() - +anRange * 864e5));
function analyticsHTML(p) {
  const rb = (v, l) => `<button class="opt-btn ${anRange === v ? 'sel' : ''}" style="flex:none;padding:5px 12px" onclick="setRange('${v}')">${l}</button>`;
  const tb = (v, l) => `<button class="opt-btn ${anTopic === v ? 'sel' : ''}" style="flex:none;padding:4px 10px;font-size:11px" onclick="setTopicMode('${v}')">${l}</button>`;
  return `<div class="stack" id="an-${p}"><div class="row sp" style="flex-wrap:wrap"><h3 style="font-size:16px"><i class="fa-solid fa-chart-line" style="color:var(--am)"></i> Başarı analizi</h3><div class="row" style="gap:6px">${rb('7', '7 gün')}${rb('30', '30 gün')}${rb('all', 'Tümü')}</div></div>
  <div class="g2"><div class="card"><div class="row sp"><b style="font-size:13px">Puan trendi</b><span class="chip" id="an-${p}-d" style="display:none"></span></div><div class="chart-box" id="an-${p}-lb"><canvas id="an-${p}-line"></canvas></div></div>
  <div class="card"><div class="row sp"><b style="font-size:13px">Konu bazlı başarı</b><div class="row" style="gap:6px">${tb('bar', 'Çubuk')}${tb('pie', 'Pasta')}</div></div><div class="chart-box" id="an-${p}-tb"><canvas id="an-${p}-topic"></canvas></div></div></div></div>`;
}
function drawAnalytics(p, all) {
  anSrc[p] = all;
  ['line', 'topic'].forEach(k => { anCh[p + k]?.destroy(); delete anCh[p + k]; });
  if (!$('an-' + p)) return;
  const empty = (id, msg) => { $(id).innerHTML = `<p class="muted" style="padding:80px 10px;text-align:center">${msg}</p>`; };
  if (!window.Chart) { // Chart.js ilk ihtiyaçta yüklenir (açılışı yavaşlatmaz)
    empty(`an-${p}-lb`, 'Grafikler yükleniyor…'); empty(`an-${p}-tb`, ' ');
    loadChart().then(() => { const el = $('an-' + p); if (el) { el.outerHTML = analyticsHTML(p); drawAnalytics(p, all); } },
      () => { empty(`an-${p}-lb`, 'Grafik kütüphanesi yüklenemedi.'); empty(`an-${p}-tb`, 'İnternet bağlantını kontrol et.'); });
    return;
  }
  const items = anItems(all).slice().sort((a, b) => (a.ts || a.id) - (b.ts || b.id));
  Chart.defaults.color = cvar('--mu'); Chart.defaults.font.family = 'Manrope, sans-serif'; Chart.defaults.borderColor = cvar('--ln');
  const am = cvar('--am'), tl = cvar('--tl'), ro = cvar('--ro'), grid = { color: cvar('--ln') };
  if (items.length < 2) empty(`an-${p}-lb`, 'Trend için bu aralıkta en az 2 sınav gerekli.');
  else {
    const sc = items.map(a => a.score), ma = sc.map((_, i) => Math.round(sc.slice(Math.max(0, i - 2), i + 1).reduce((s, x) => s + x, 0) / Math.min(i + 1, 3)));
    const h = Math.floor(sc.length / 2), avg = l => l.reduce((s, x) => s + x, 0) / l.length, dl = Math.round(avg(sc.slice(h)) - avg(sc.slice(0, h)));
    const chip = $(`an-${p}-d`); chip.style.display = ''; chip.textContent = (dl > 0 ? '↑ +' : dl < 0 ? '↓ ' : '→ ') + dl + ' puan'; chip.style.color = dl > 0 ? tl : dl < 0 ? ro : cvar('--mu');
    anCh[p + 'line'] = new Chart($(`an-${p}-line`), { type: 'line', data: { labels: items.map(a => new Date(a.ts || a.id).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })), datasets: [
      { label: 'Not', data: sc, borderColor: am, backgroundColor: `rgba(${cvar('--amr')},.15)`, fill: true, tension: .35, pointRadius: 4, pointBackgroundColor: am },
      { label: 'Hareketli ortalama (3 sınav)', data: ma, borderColor: tl, borderDash: [6, 5], pointRadius: 0, tension: .35, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { min: 0, suggestedMax: Math.max(100, ...sc), grid }, x: { grid: { display: false } } },
        plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { title: c => items[c[0].dataIndex].title, afterBody: c => { const a = items[c[0].dataIndex]; return `${a.correct}/${a.total} doğru`; } } } } } });
  }
  const ts = topicStats(items).sort((a, b) => b.total - a.total).slice(0, 8);
  if (!ts.length) empty(`an-${p}-tb`, 'Konu analizi için bu aralıkta sınav yok.');
  else {
    const lab = ts.map(t => (t.topic.length > 22 ? t.topic.slice(0, 21) + '…' : t.topic)), pct = ts.map(t => Math.round((t.total - t.wrong) / t.total * 100));
    const pal = [am, tl, cvar('--bl'), cvar('--vi'), ro, '#fbbf24', '#8ab4ff', '#f0abfc'];
    anCh[p + 'topic'] = new Chart($(`an-${p}-topic`), anTopic === 'bar'
      ? { type: 'bar', data: { labels: lab, datasets: [{ data: pct, borderRadius: 6, backgroundColor: pct.map(v => (v < 50 ? ro : v < 75 ? am : tl)) }] },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { min: 0, max: 100, grid, ticks: { callback: v => v + '%' } }, y: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `%${c.raw} · ${ts[c.dataIndex].total - ts[c.dataIndex].wrong}/${ts[c.dataIndex].total} doğru` } } } } }
      : { type: 'doughnut', data: { labels: lab, datasets: [{ data: ts.map(t => t.total), backgroundColor: pal, borderColor: cvar('--s1'), borderWidth: 3 }] },
          options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: c => `${c.raw} soru · başarı %${pct[c.dataIndex]}` } } } } });
  }
}
function redrawCharts() {
  Object.keys(anSrc).forEach(p => { const el = $('an-' + p); if (!el || !el.offsetParent) return; const src = anSrc[p]; el.outerHTML = analyticsHTML(p); drawAnalytics(p, src); });
}
const setRange = v => { anRange = v; redrawCharts(); };
const setTopicMode = v => { anTopic = v; redrawCharts(); };
const _at = applyTheme; // tema değişince grafik renkleri de güncellensin
applyTheme = function (t) { _at(t); setTimeout(redrawCharts, 0); };
