/* ===== Rita 生活管理工作台 核心逻辑 ===== */

// ---------- 数据层（通过 RitaSync 统一管理本地 + 云端） ----------
// loadStore / saveStore 由 sync.js 提供，支持本地缓存 + 云端同步

let store = RitaSync.loadStore();
// 后台从云端拉取最新数据（不阻塞 UI）
RitaSync.pullFromCloud().then((ok) => {
  if (ok) {
    // 云端数据已更新到本地，刷新 UI
    store = RitaSync.loadStore();
    if (typeof renderAll === 'function') renderAll();
  }
});
let currentDate = todayStr();
let currentPlatform = 'weibo';

// ---------- 日期工具 ----------
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatDateCN(dateStr) {
  const d = new Date(dateStr);
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${dateStr} 星期${week}`;
}
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function lastNDays(n) {
  const arr = [];
  for (let i = n - 1; i >= 0; i--) {
    arr.push(formatDate(new Date(Date.now() - i * 86400000)));
  }
  return arr;
}

// ---------- 初始化 ----------
// 重新渲染所有模块（仅 UI，不重新绑定事件）—— 云端同步后调用
function renderAll() {
  renderDaily();
  renderBaby();
  renderGrowth();
  renderStats();
}

function init() {
  document.getElementById('datePicker').value = currentDate;
  document.getElementById('todayText').textContent = `今天是 ${formatDateCN(currentDate)}`;

  // 标签切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // 日期切换
  document.getElementById('datePicker').addEventListener('change', (e) => {
    currentDate = e.target.value;
    document.getElementById('todayText').textContent = `记录日期：${formatDateCN(currentDate)}`;
    renderDaily();
    renderBaby();
  });

  // 平台切换
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPlatform = btn.dataset.platform;
      loadNews(currentPlatform);
    });
  });

  renderDaily();
  renderBaby();
  renderGrowth();
  renderStats();
  loadNews(currentPlatform);

  // ESC 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeVideoModal(); closeAlbumModal(); }
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'stats') renderStats();
  if (name === 'baby') { renderBaby(); renderGrowth(); }
}

// ---------- 今日打卡 ----------
function getDaily() {
  const d = store.daily[currentDate] || { water: 0, exercise: '', weight: '', outfit: '', makeup: '', english: '' };
  if (!d.outfit_links) d.outfit_links = [];
  if (!d.makeup_links) d.makeup_links = [];
  if (!d.english_links) d.english_links = [];
  return d;
}
function setDaily(d) {
  store.daily[currentDate] = d;
  RitaSync.saveStore(store);
}

function renderDaily() {
  const d = getDaily();
  document.getElementById('waterCount').textContent = d.water || 0;
  renderWaterDots(d.water || 0);
  document.getElementById('exercise').value = d.exercise || '';
  document.getElementById('weight').value = d.weight || '';
  document.getElementById('outfit').value = d.outfit || '';
  document.getElementById('makeup').value = d.makeup || '';
  document.getElementById('english').value = d.english || '';
  renderInspoList('daily', 'outfit');
  renderInspoList('daily', 'makeup');
  renderInspoList('daily', 'english');
}

function renderWaterDots(count) {
  const box = document.getElementById('waterDots');
  let html = '';
  for (let i = 0; i < 8; i++) {
    html += `<i class="${i < count ? 'on' : ''}"></i>`;
  }
  box.innerHTML = html;
  const hint = document.getElementById('waterHint');
  if (count >= 8) hint.textContent = '🎉 已达标';
  else if (count >= 6) hint.textContent = `差 ${8 - count} 杯达标`;
  else hint.textContent = `目标 8 杯`;
}

function adjustWater(delta) {
  const d = getDaily();
  d.water = Math.max(0, Math.min(20, (d.water || 0) + delta));
  setDaily(d);
  renderDaily();
  showTip('dailySavedTip', '已保存');
}

function saveDaily() {
  const old = getDaily();
  const d = {
    water: parseInt(document.getElementById('waterCount').textContent) || 0,
    exercise: document.getElementById('exercise').value.trim(),
    weight: document.getElementById('weight').value.trim(),
    outfit: document.getElementById('outfit').value.trim(),
    makeup: document.getElementById('makeup').value.trim(),
    english: document.getElementById('english').value.trim(),
    outfit_links: old.outfit_links || [],
    makeup_links: old.makeup_links || [],
    english_links: old.english_links || [],
  };
  setDaily(d);
  showTip('dailySavedTip', '✅ 今日打卡已保存');
}

function showTip(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2000);
}

// ---------- 灵感链接解析（通用：支持 daily / baby 数据源） ----------
const DIADI_SECRET = '3mCuQeOvVgeBIcpUgRSLiqWcmDkxDdBxx';

// 灵感链接字段映射：type → { inputId, listId, key }
const INSPO_FIELDS = {
  outfit:    { inputId: 'outfitLink',    listId: 'outfitInspoList',    key: 'outfit_links' },
  makeup:    { inputId: 'makeupLink',    listId: 'makeupInspoList',    key: 'makeup_links' },
  english:   { inputId: 'englishLink',   listId: 'englishInspoList',   key: 'english_links' },
  education: { inputId: 'educationLink', listId: 'educationInspoList', key: 'education_links' },
};

// 获取灵感数据上下文
function getInspoContext(source, type) {
  const f = INSPO_FIELDS[type];
  const data = source === 'baby' ? getBaby() : getDaily();
  if (!data[f.key]) data[f.key] = [];
  const save = source === 'baby' ? () => setBaby(data) : () => setDaily(data);
  return { data, key: f.key, inputId: f.inputId, listId: f.listId, save };
}

// 调用 diadi 解析接口（通过 allorigins CORS 代理），带重试
async function parseLink(url) {
  const diadi = `https://gateway.diadi.cn/api/parse?app_secret=${DIADI_SECRET}&url=${encodeURIComponent(url)}`;
  const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(diadi)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(proxy, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      if (data && data.code === 0 && data.data) return data.data;
      if (data && data.code !== 0) throw new Error(data.message || '解析失败');
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function parseAndSaveInspo(source, type) {
  const ctx = getInspoContext(source, type);
  const url = document.getElementById(ctx.inputId).value.trim();
  if (!url) return;
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '解析中...';
  try {
    const data = await parseLink(url);
    const item = {
      url,
      title: data.text || (data.title || ''),
      cover: data.cover || '',
      type: data.type || 'video',
      video: (data.video && data.video[0]) || '',
      images: data.images || [],
      savedAt: Date.now(),
    };
    ctx.data[ctx.key].push(item);
    ctx.save();
    document.getElementById(ctx.inputId).value = '';
    renderInspoList(source, type);
  } catch (e) {
    // 解析失败：仍保存原始链接，方便点击跳转
    ctx.data[ctx.key].push({ url, title: '（解析失败，点击打开原链接）', cover: '', type: 'link', video: '', images: [], savedAt: Date.now() });
    ctx.save();
    document.getElementById(ctx.inputId).value = '';
    renderInspoList(source, type);
    showTip('dailySavedTip', '⚠️ 解析失败，已保存原链接，可点击打开');
  } finally {
    btn.disabled = false;
    btn.textContent = '解析';
  }
}

function renderInspoList(source, type) {
  const ctx = getInspoContext(source, type);
  const list = document.getElementById(ctx.listId);
  const items = ctx.data[ctx.key] || [];
  if (!items.length) {
    list.innerHTML = '<div class="inspo-empty">粘贴抖音/小红书链接，点「解析」保存灵感</div>';
    return;
  }
  list.innerHTML = items.map((it, i) => {
    const thumb = it.cover
      ? `<img src="${it.cover}" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML='🎬'">`
      : (it.type === 'note' ? '📷' : '🔗');
    return `<div class="inspo-card" onclick="openInspo('${source}','${type}',${i})">
      <div class="inspo-thumb">${thumb}</div>
      <div class="inspo-info">
        <div class="inspo-title">${escapeHtml(it.title || it.url)}</div>
        <div class="inspo-meta">${it.type === 'video' ? '视频' : it.type === 'note' ? '图文' : '链接'} · 点击播放</div>
      </div>
      <button class="inspo-del" onclick="event.stopPropagation();delInspo('${source}','${type}',${i})">✕</button>
    </div>`;
  }).join('');
}

function delInspo(source, type, i) {
  const ctx = getInspoContext(source, type);
  ctx.data[ctx.key].splice(i, 1);
  ctx.save();
  renderInspoList(source, type);
}

function openInspo(source, type, i) {
  const ctx = getInspoContext(source, type);
  const it = ctx.data[ctx.key][i];
  const modal = document.getElementById('videoModal');
  const body = document.getElementById('modalBody');
  const titleEl = document.getElementById('modalTitle');
  const originEl = document.getElementById('modalOrigin');

  titleEl.textContent = it.title || '';
  originEl.href = it.url;

  if (it.type === 'video' && it.video) {
    body.innerHTML = `<video src="${it.video}" controls autoplay playsinline referrerpolicy="no-referrer"></video>`;
  } else if (it.type === 'note' && it.images && it.images.length) {
    body.innerHTML = `<div class="img-gallery">${it.images.map(img => `<img src="${img}" referrerpolicy="no-referrer">`).join('')}</div>`;
  } else {
    body.innerHTML = `<div class="modal-loading">无法直接预览<br><a href="${it.url}" target="_blank" rel="noopener" style="color:var(--primary-dark)">点击在原平台打开 ↗</a></div>`;
  }
  modal.classList.add('active');
}

function closeVideoModal(e) {
  if (e && e.target.id !== 'videoModal' && e.type === 'click') return;
  const modal = document.getElementById('videoModal');
  modal.classList.remove('active');
  document.getElementById('modalBody').innerHTML = '';
}

// ---------- 小宝贝 ----------
function getBaby() {
  const b = store.baby[currentDate] || { milk: [], food: [], sleep: [], poop: [], education: '' };
  if (!b.education_links) b.education_links = [];
  if (!b.poop) b.poop = [];
  return b;
}
function setBaby(b) {
  store.baby[currentDate] = b;
  RitaSync.saveStore(store);
}

function renderBaby() {
  const b = getBaby();
  // 奶量
  const milkList = document.getElementById('milkList');
  milkList.innerHTML = b.milk.map((m, i) =>
    `<li><span><span class="rec-time">${m.time}</span><b>${m.amount} ml</b></span><button class="del-btn" onclick="delMilk(${i})">✕</button></li>`
  ).join('');
  const milkTotal = b.milk.reduce((s, m) => s + (parseInt(m.amount) || 0), 0);
  document.getElementById('milkTotal').textContent = milkTotal;

  // 辅食
  const foodList = document.getElementById('foodList');
  foodList.innerHTML = b.food.map((f, i) =>
    `<li><span><span class="rec-time">${f.time}</span>${f.content}</span><button class="del-btn" onclick="delFood(${i})">✕</button></li>`
  ).join('');

  // 睡眠
  const sleepList = document.getElementById('sleepList');
  sleepList.innerHTML = b.sleep.map((s, i) =>
    `<li><span><span class="rec-time">${s.start} → ${s.end}</span><b>${sleepMin(s)} 分钟</b></span><button class="del-btn" onclick="delSleep(${i})">✕</button></li>`
  ).join('');
  const sleepTotal = b.sleep.reduce((s, sl) => s + sleepMin(sl), 0);
  document.getElementById('sleepTotal').textContent = sleepTotal;

  // 大便
  const poopList = document.getElementById('poopList');
  poopList.innerHTML = b.poop.length ? b.poop.map((p, i) =>
    `<li>
      <span class="rec-time">${p.time}</span>
      <span class="rec-main">
        <b>${p.texture}</b>｜${p.color}｜${p.amount}
        ${p.note ? `<br><span class="muted">${escapeHtml(p.note)}</span>` : ''}
      </span>
      <button class="del-btn" onclick="delPoop(${i})">✕</button>
    </li>`
  ).join('') : '<li class="empty-tip">暂无大便记录</li>';
  document.getElementById('poopCount').textContent = b.poop.length;

  // 教育
  document.getElementById('education').value = b.education || '';
  renderInspoList('baby', 'education');
}

function sleepMin(s) {
  if (!s.start || !s.end) return 0;
  const [sh, sm] = s.start.split(':').map(Number);
  const [eh, em] = s.end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // 跨天
  return mins;
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function addMilk() {
  const time = document.getElementById('milkTime').value || nowTime();
  const amount = document.getElementById('milkAmount').value.trim();
  if (!amount) return;
  const b = getBaby();
  b.milk.push({ time, amount: parseInt(amount) });
  setBaby(b);
  document.getElementById('milkAmount').value = '';
  renderBaby();
}
function delMilk(i) {
  const b = getBaby();
  b.milk.splice(i, 1);
  setBaby(b);
  renderBaby();
}

function addFood() {
  const time = document.getElementById('foodTime').value || nowTime();
  const content = document.getElementById('foodContent').value.trim();
  if (!content) return;
  const b = getBaby();
  b.food.push({ time, content });
  setBaby(b);
  document.getElementById('foodContent').value = '';
  renderBaby();
}
function delFood(i) {
  const b = getBaby();
  b.food.splice(i, 1);
  setBaby(b);
  renderBaby();
}

function addSleep() {
  const start = document.getElementById('sleepStart').value;
  const end = document.getElementById('sleepEnd').value;
  if (!start || !end) return;
  const b = getBaby();
  b.sleep.push({ start, end });
  setBaby(b);
  document.getElementById('sleepStart').value = '';
  document.getElementById('sleepEnd').value = '';
  renderBaby();
}
function delSleep(i) {
  const b = getBaby();
  b.sleep.splice(i, 1);
  setBaby(b);
  renderBaby();
}

function addPoop() {
  const time = document.getElementById('poopTime').value;
  if (!time) return;
  const b = getBaby();
  b.poop.push({
    time,
    texture: document.getElementById('poopTexture').value,
    color: document.getElementById('poopColor').value,
    amount: document.getElementById('poopAmount').value,
    note: document.getElementById('poopNote').value.trim(),
  });
  setBaby(b);
  document.getElementById('poopNote').value = '';
  renderBaby();
}
function delPoop(i) {
  const b = getBaby();
  b.poop.splice(i, 1);
  setBaby(b);
  renderBaby();
}

function saveEducation() {
  const b = getBaby();
  b.education = document.getElementById('education').value.trim();
  setBaby(b);
  showTip('eduSavedTip', '✅ 教育记录已保存');
}

// ---------- 成长记录 ----------
function getGrowth() {
  return store.growth;
}
function setGrowth(g) {
  store.growth = g;
  RitaSync.saveStore(store);
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function addMeasurement() {
  const date = document.getElementById('mDate').value;
  const height = document.getElementById('mHeight').value.trim();
  const weight = document.getElementById('mWeight').value.trim();
  const head = document.getElementById('mHead').value.trim();
  if (!date || (!height && !weight && !head)) return;
  const g = getGrowth();
  g.measurements.push({
    id: genId(),
    date,
    height: height ? parseFloat(height) : null,
    weight: weight ? parseFloat(weight) : null,
    head: head ? parseFloat(head) : null,
  });
  setGrowth(g);
  document.getElementById('mHeight').value = '';
  document.getElementById('mWeight').value = '';
  document.getElementById('mHead').value = '';
  renderGrowth();
}
function delMeasurement(id) {
  const g = getGrowth();
  g.measurements = g.measurements.filter(m => m.id !== id);
  setGrowth(g);
  renderGrowth();
}

function addMilestone() {
  const date = document.getElementById('msDate').value;
  const category = document.getElementById('msCategory').value;
  const content = document.getElementById('msContent').value.trim();
  if (!date || !content) return;
  const g = getGrowth();
  g.milestones.push({ id: genId(), date, category, content });
  setGrowth(g);
  document.getElementById('msContent').value = '';
  renderGrowth();
}
function delMilestone(id) {
  const g = getGrowth();
  g.milestones = g.milestones.filter(m => m.id !== id);
  setGrowth(g);
  renderGrowth();
}

// ---------- 过敏记录 ----------
function addAllergy() {
  const date = document.getElementById('alDate').value;
  const allergen = document.getElementById('alAllergen').value.trim();
  const severity = document.getElementById('alSeverity').value;
  const reaction = document.getElementById('alReaction').value.trim();
  if (!date || !allergen) return;
  const g = getGrowth();
  g.allergies.push({ id: genId(), date, allergen, severity, reaction });
  setGrowth(g);
  document.getElementById('alAllergen').value = '';
  document.getElementById('alReaction').value = '';
  renderGrowth();
}
function delAllergy(id) {
  const g = getGrowth();
  g.allergies = g.allergies.filter(a => a.id !== id);
  setGrowth(g);
  renderGrowth();
}

// ---------- 疫苗接种 ----------
function addVaccine() {
  const date = document.getElementById('vcDate').value;
  const name = document.getElementById('vcName').value.trim();
  const dose = document.getElementById('vcDose').value.trim();
  const site = document.getElementById('vcSite').value.trim();
  const next = document.getElementById('vcNext').value;
  if (!date || !name) return;
  const g = getGrowth();
  g.vaccines.push({ id: genId(), date, name, dose, site, next });
  setGrowth(g);
  document.getElementById('vcName').value = '';
  document.getElementById('vcDose').value = '';
  document.getElementById('vcSite').value = '';
  document.getElementById('vcNext').value = '';
  renderGrowth();
}
function delVaccine(id) {
  const g = getGrowth();
  g.vaccines = g.vaccines.filter(v => v.id !== id);
  setGrowth(g);
  renderGrowth();
}

// ========== IndexedDB 媒体存储 ==========
const DB_NAME = 'rita_media';
const DB_VERSION = 1;
const STORE_NAME = 'media';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbPut(key, blob) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function dbGet(key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function dbDelete(key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// 图片压缩：最大边 1600px，JPEG 质量 0.75
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.75);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ========== 成长相册 ==========
async function onPhotoFiles(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  const date = document.getElementById('photoDate').value || todayStr();
  const desc = document.getElementById('photoDesc').value.trim();
  const status = document.getElementById('uploadStatus');
  const g = getGrowth();
  let done = 0;
  for (const file of files) {
    status.textContent = `上传中 ${done + 1}/${files.length}...`;
    const isVideo = file.type.startsWith('video/');
    let blob;
    if (isVideo) {
      blob = file; // 视频直接存原始 Blob
    } else {
      try { blob = await compressImage(file); }
      catch { blob = file; }
    }
    const id = genId();
    await dbPut(id, blob);
    g.photos.push({
      id,
      date,
      desc,
      type: isVideo ? 'video' : 'image',
      mime: file.type,
      size: blob.size,
    });
    done++;
  }
  setGrowth(g);
  document.getElementById('photoDesc').value = '';
  input.value = '';
  status.textContent = `✅ 已添加 ${done} 个`;
  setTimeout(() => { status.textContent = ''; }, 2500);
  renderGrowth();
}

function renderAlbum(g) {
  const grid = document.getElementById('albumGrid');
  const photos = [...(g.photos || [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  document.getElementById('photoCount').textContent = `${photos.length} 个`;
  if (!photos.length) {
    grid.innerHTML = '<div class="album-empty">还没有照片，选一张小宝贝的可爱瞬间吧 📸</div>';
    return;
  }
  grid.innerHTML = photos.map(p =>
    `<div class="album-item" onclick="openPhoto('${p.id}')">
      <${p.type} src="" data-id="${p.id}" ${p.type === 'video' ? 'muted' : ''}></${p.type}>
      ${p.type === 'video' ? '<span class="album-type">▶ 视频</span>' : ''}
      <button class="album-del" onclick="event.stopPropagation();delPhoto('${p.id}')">✕</button>
      ${p.desc ? `<span class="album-cap">${escapeHtml(p.desc)}</span>` : ''}
    </div>`
  ).join('');
  // 异步加载缩略图
  photos.forEach(p => {
    dbGet(p.id).then(blob => {
      if (!blob) return;
      const el = grid.querySelector(`${p.type}[data-id="${p.id}"]`);
      if (el) el.src = URL.createObjectURL(blob);
    });
  });
}

async function openPhoto(id) {
  const g = getGrowth();
  const p = g.photos.find(x => x.id === id);
  if (!p) return;
  const blob = await dbGet(id);
  if (!blob) { alert('文件已丢失'); return; }
  const url = URL.createObjectURL(blob);
  const body = document.getElementById('albumModalBody');
  body.innerHTML = p.type === 'video'
    ? `<video src="${url}" controls autoplay playsinline></video>`
    : `<img src="${url}">`;
  document.getElementById('albumModalTitle').textContent = p.date + (p.desc ? ` · ${p.desc}` : '');
  document.getElementById('albumModal').classList.add('active');
}

function closeAlbumModal(e) {
  if (e && e.target && e.target.id !== 'albumModal' && e.type === 'click') return;
  const modal = document.getElementById('albumModal');
  modal.classList.remove('active');
  const body = document.getElementById('albumModalBody');
  // 释放 object URL
  const media = body.querySelector('img, video');
  if (media && media.src.startsWith('blob:')) URL.revokeObjectURL(media.src);
  body.innerHTML = '';
}

async function delPhoto(id) {
  if (!confirm('确定删除这张照片/视频吗？')) return;
  const g = getGrowth();
  g.photos = g.photos.filter(p => p.id !== id);
  setGrowth(g);
  try { await dbDelete(id); } catch {}
  renderGrowth();
}

function renderGrowth() {
  const g = getGrowth();

  // 体格测量列表（按日期倒序）
  const measures = [...g.measurements].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('measureList').innerHTML = measures.length ? measures.map(m =>
    `<li>
      <span class="rec-time">${m.date}</span>
      <span class="rec-main">
        ${m.height != null ? `身高 ${m.height}cm` : ''}
        ${m.weight != null ? `｜体重 ${m.weight}kg` : ''}
        ${m.head != null ? `｜头围 ${m.head}cm` : ''}
      </span>
      <button class="del-btn" onclick="delMeasurement('${m.id}')">✕</button>
    </li>`
  ).join('') : '<li class="empty-tip">还没有测量记录，添加第一条吧 👶</li>';

  // 默认日期填今天
  document.getElementById('mDate').value = document.getElementById('mDate').value || currentDate;
  document.getElementById('msDate').value = document.getElementById('msDate').value || currentDate;
  document.getElementById('alDate').value = document.getElementById('alDate').value || currentDate;
  document.getElementById('vcDate').value = document.getElementById('vcDate').value || currentDate;

  // 生长曲线
  renderGrowthChart('heightChart', 'height', '#7ec8e3');
  renderGrowthChart('babyWeightChart', 'weight', '#e88a9a');
  renderGrowthChart('headChart', 'head', '#a8d8a8');

  // 里程碑列表（按日期倒序）
  const milestones = [...g.milestones].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('milestoneList').innerHTML = milestones.length ? milestones.map(m =>
    `<li>
      <span class="rec-time">${m.date}</span>
      <span class="rec-main"><span class="tag tag-${m.category}">${m.category}</span> ${m.content}</span>
      <button class="del-btn" onclick="delMilestone('${m.id}')">✕</button>
    </li>`
  ).join('') : '<li class="empty-tip">记录宝宝的每一个第一次吧 🌟</li>';

  // 过敏记录列表（按日期倒序）
  const sevColor = { '轻微': '#52b788', '中度': '#f5a623', '严重': '#e85d5d' };
  const allergies = [...g.allergies].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('allergyList').innerHTML = allergies.length ? allergies.map(a =>
    `<li>
      <span class="rec-time">${a.date}</span>
      <span class="rec-main">
        <b>${a.allergen}</b>
        <span class="tag" style="background:${sevColor[a.severity] || '#9a8c86'}">${a.severity}</span>
        ${a.reaction ? `｜${a.reaction}` : ''}
      </span>
      <button class="del-btn" onclick="delAllergy('${a.id}')">✕</button>
    </li>`
  ).join('') : '<li class="empty-tip">暂无过敏记录</li>';

  // 疫苗接种列表（按日期倒序）
  const vaccines = [...g.vaccines].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('vaccineList').innerHTML = vaccines.length ? vaccines.map(v =>
    `<li>
      <span class="rec-time">${v.date}</span>
      <span class="rec-main">
        <b>${v.name}</b>
        ${v.dose ? `｜${v.dose}` : ''}
        ${v.site ? `｜${v.site}` : ''}
        ${v.next ? `<br><span class="muted">下次：${v.next}</span>` : ''}
      </span>
      <button class="del-btn" onclick="delVaccine('${v.id}')">✕</button>
    </li>`
  ).join('') : '<li class="empty-tip">暂无疫苗接种记录</li>';

  // 成长相册
  document.getElementById('photoDate').value = document.getElementById('photoDate').value || currentDate;
  renderAlbum(g);
}

function renderGrowthChart(containerId, field, color) {
  const g = getGrowth();
  const points = g.measurements
    .filter(m => m[field] != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(m => ({ date: m.date, v: m[field], ts: new Date(m.date).getTime() }));
  const svg = document.getElementById(containerId);
  if (points.length === 0) {
    svg.innerHTML = `<div class="muted" style="text-align:center;padding-top:50px;font-size:12px;">暂无数据</div>`;
    return;
  }
  if (points.length === 1) {
    svg.innerHTML = `<div class="muted" style="text-align:center;padding-top:50px;font-size:12px;">${points[0].v}（再记录一次生成曲线）</div>`;
    return;
  }
  const W = 100, H = 100, pad = 10;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const tMin = points[0].ts;
  const tMax = points[points.length - 1].ts;
  const tRange = tMax - tMin || 1;

  const pts = points.map(p => ({
    x: pad + ((p.ts - tMin) / tRange) * (W - pad * 2),
    y: H - pad - ((p.v - min) / range) * (H - pad * 2),
    v: p.v,
  }));
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const circles = pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="1.8" fill="${color}"/>`).join('');
  const valLabels = pts.map(p => `<text x="${p.x}" y="${p.y - 3}" font-size="3" fill="${color}" text-anchor="middle">${p.v}</text>`).join('');

  svg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#ece4dc" stroke-width="0.3"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="0.8"/>
    ${circles}${valLabels}
  </svg>`;
}

// ---------- 统计 ----------
function renderStats() {
  const days7 = lastNDays(7);
  const days14 = lastNDays(14);

  // 概览：近7天各项完成天数
  const overview = {
    water: days7.filter(d => (store.daily[d]?.water || 0) >= 8).length,
    exercise: days7.filter(d => store.daily[d]?.exercise).length,
    english: days7.filter(d => store.daily[d]?.english).length,
    weight: days7.filter(d => store.daily[d]?.weight).length,
  };
  document.getElementById('statOverview').innerHTML = `
    <div class="stat-item"><div class="num">${overview.water}/7</div><div class="lbl">💧 喝水达标</div></div>
    <div class="stat-item"><div class="num">${overview.exercise}/7</div><div class="lbl">🏃 健身打卡</div></div>
    <div class="stat-item"><div class="num">${overview.english}/7</div><div class="lbl">📚 英语学习</div></div>
    <div class="stat-item"><div class="num">${overview.weight}/7</div><div class="lbl">⚖️ 称重记录</div></div>
  `;

  // 喝水柱状图
  const maxWater = 10;
  document.getElementById('waterChart').innerHTML = days7.map(d => {
    const w = store.daily[d]?.water || 0;
    const h = Math.min(100, (w / maxWater) * 100);
    const lbl = d.slice(5);
    return `<div class="bar">
      <div class="bar-fill" style="height:${h}%"><span class="bar-val">${w}</span></div>
      <div class="bar-lbl">${lbl}</div>
    </div>`;
  }).join('');

  // 体重折线图
  renderWeightChart(days14);

  // 热力图
  renderHeatmap(days14);

  // 宝贝统计
  renderBabyStats(days7);
}

function renderWeightChart(days) {
  const data = days.map(d => parseFloat(store.daily[d]?.weight)).filter(v => !isNaN(v));
  const svg = document.getElementById('weightChart');
  if (data.length < 2) {
    svg.innerHTML = `<div class="muted" style="text-align:center;padding-top:60px;font-size:13px;">至少记录 2 天体重才能生成趋势图</div>`;
    return;
  }
  const W = 100, H = 100, pad = 8;
  const vals = days.map(d => parseFloat(store.daily[d]?.weight));
  const valid = vals.filter(v => !isNaN(v));
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const points = days.map((d, i) => {
    const v = vals[i];
    if (isNaN(v)) return null;
    const x = pad + (i / (days.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return { x, y, v, d: d.slice(5) };
  }).filter(Boolean);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const circles = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="1.5" fill="#e88a9a"/>`).join('');
  const labels = points.map(p => `<text x="${p.x}" y="${H - 1}" font-size="3" fill="#9a8c86" text-anchor="middle">${p.d}</text>`).join('');

  svg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#ece4dc" stroke-width="0.3"/>
    <path d="${path}" fill="none" stroke="#e88a9a" stroke-width="0.8"/>
    ${circles}${labels}
  </svg>`;
}

function renderHeatmap(days) {
  const html = days.map(d => {
    const dd = store.daily[d] || {};
    let count = 0;
    if ((dd.water || 0) >= 8) count++;
    if (dd.exercise) count++;
    if (dd.english) count++;
    if (dd.weight) count++;
    const bb = store.baby[d] || {};
    if ((bb.milk || []).length) count++;
    if ((bb.food || []).length) count++;
    if ((bb.sleep || []).length) count++;
    if (bb.education) count++;
    const lv = Math.min(4, Math.floor(count / 2));
    return `<div class="heat-cell lv${lv}" title="${d}：完成 ${count} 项">
      <div class="h-date">${d.slice(5)}</div>
      <div class="h-count">${count}</div>
    </div>`;
  }).join('');
  document.getElementById('heatmap').innerHTML = html;
}

function renderBabyStats(days) {
  let totalMilk = 0, totalSleep = 0, totalFood = 0, eduDays = 0;
  days.forEach(d => {
    const b = store.baby[d] || {};
    totalMilk += (b.milk || []).reduce((s, m) => s + (parseInt(m.amount) || 0), 0);
    totalSleep += (b.sleep || []).reduce((s, sl) => s + sleepMin(sl), 0);
    totalFood += (b.food || []).length;
    if (b.education) eduDays++;
  });
  const avgMilk = days.length ? Math.round(totalMilk / days.length) : 0;
  const avgSleep = days.length ? Math.round(totalSleep / days.length / 60 * 10) / 10 : 0;
  document.getElementById('babyStats').innerHTML = `
    <div class="stat-item"><div class="num">${avgMilk}</div><div class="lbl">🍼 日均奶量 (ml)</div></div>
    <div class="stat-item"><div class="num">${avgSleep}</div><div class="lbl">😴 日均睡眠 (小时)</div></div>
    <div class="stat-item"><div class="num">${totalFood}</div><div class="lbl">🥣 辅食次数</div></div>
    <div class="stat-item"><div class="num">${eduDays}/7</div><div class="lbl">🎓 教育打卡</div></div>
  `;
}

// ---------- 热点新闻 ----------
const PLATFORMS = {
  weibo: { name: '微博', url: 'https://60s.viki.moe/v2/weibo', emoji: '🦊' },
  zhihu: { name: '知乎', url: 'https://60s.viki.moe/v2/zhihu', emoji: '❓' },
  baidu: { name: '百度', url: 'https://60s.viki.moe/v2/baidu/hot', emoji: '🅱️' },
  douyin: { name: '抖音', url: 'https://60s.viki.moe/v2/douyin', emoji: '🎵' },
  toutiao: { name: '头条', url: 'https://60s.viki.moe/v2/toutiao', emoji: '📰' },
  rednote: { name: '小红书', url: 'https://60s.viki.moe/v2/rednote', emoji: '📕' },
};

// 简易新闻缓存（按平台+日期）
function getNewsCacheKey(p) { return `rita_news_${p}_${todayStr()}`; }

async function loadNews(platform) {
  const listEl = document.getElementById('newsList');
  const metaEl = document.getElementById('newsMeta');
  listEl.innerHTML = '<div class="loading">正在加载热点新闻...</div>';
  metaEl.textContent = '';

  if (platform === 'all') {
    await loadAllNews();
    return;
  }

  const p = PLATFORMS[platform];
  try {
    const data = await fetchNews(p.url);
    if (!data || !data.data) throw new Error('无数据');
    renderNewsGroup(listEl, p, data.data, true);
    metaEl.textContent = `${p.emoji} ${p.name}热搜 · 共 ${data.data.length} 条 · ${new Date().toLocaleTimeString('zh-CN')} 更新`;
  } catch (e) {
    listEl.innerHTML = `<div class="error-msg">⚠️ ${p.name}热点加载失败：${e.message}，请稍后刷新</div>`;
  }
}

async function loadAllNews() {
  const listEl = document.getElementById('newsList');
  const metaEl = document.getElementById('newsMeta');
  listEl.innerHTML = '';
  const keys = Object.keys(PLATFORMS);
  let ok = 0;
  for (const k of keys) {
    const p = PLATFORMS[k];
    try {
      const data = await fetchNews(p.url);
      if (data && data.data) {
        renderNewsGroup(listEl, p, data.data.slice(0, 10), false);
        ok++;
      }
    } catch (e) {
      // 单个平台失败不影响其他
    }
  }
  metaEl.textContent = `全部平台汇总 · 成功加载 ${ok}/${keys.length} 个平台 · ${new Date().toLocaleTimeString('zh-CN')}`;
  if (ok === 0) {
    listEl.innerHTML = '<div class="error-msg">⚠️ 所有平台热点加载失败，请检查网络后刷新</div>';
  }
}

function renderNewsGroup(container, p, items, single) {
  const group = document.createElement('div');
  group.className = 'news-group';
  group.innerHTML = `<h4>${p.emoji} ${p.name}热搜</h4>`;
  items.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'news-item';
    const hot = formatHot(item.hot_value || item.hot || item.score || item.desc);
    const link = item.link || item.url || '#';
    div.innerHTML = `
      <div class="news-rank">${i + 1}</div>
      <a class="news-title" href="${link}" target="_blank" rel="noopener">${escapeHtml(item.title || '')}</a>
      ${hot ? `<span class="news-hot">${hot}</span>` : ''}
    `;
    group.appendChild(div);
  });
  container.appendChild(group);
}

function formatHot(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return v + '';
  }
  return String(v).slice(0, 20);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function fetchNews(url) {
  // 优先用缓存（当天），减少请求
  const cacheKey = 'rita_news_cache_' + url;
  const cached = sessionStorage.getItem(cacheKey);
  const now = Date.now();
  if (cached) {
    try {
      const c = JSON.parse(cached);
      if (now - c.ts < 10 * 60 * 1000) return c.data; // 缓存10分钟
    } catch (e) {}
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  sessionStorage.setItem(cacheKey, JSON.stringify({ ts: now, data }));
  return data;
}

// 启动
document.addEventListener('DOMContentLoaded', init);
