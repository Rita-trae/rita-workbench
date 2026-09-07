/* ===== Rita 数据同步层 =====
 * 设计：
 *  - loadStore()   同步：从本地缓存读取，保证 UI 立即可用
 *  - saveStore(d)  同步：写本地缓存；异步推送云端（失败则入离线队列）
 *  - pullFromCloud()  异步：启动后后台拉取云端最新数据合并到本地
 *  - 未配置 Supabase 凭据时，完全回退到 localStorage，行为与改造前一致
 */
(function (global) {
  const STORE_KEY = 'rita_data_v1';
  const QUEUE_KEY = 'rita_sync_queue';
  const DEVICE_KEY = 'rita_device_id';
  const LOCAL_TS_KEY = 'rita_local_updated_at';

  /* ---------- 工具 ---------- */
  function defaultData() {
    return {
      daily: {},
      baby: {},
      growth: { measurements: [], milestones: [], allergies: [], vaccines: [], photos: [] },
    };
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return 'unknown';
    }
  }

  function getSupabase() {
    if (
      typeof globalThis.supabase !== 'undefined' &&
      window.SUPABASE_URL &&
      window.SUPABASE_ANON_KEY
    ) {
      return globalThis.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
    return null;
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeLocal(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('本地写入失败:', e);
    }
  }

  // 本地数据最后修改时间戳（ms）
  function getLocalTs() {
    try {
      return parseInt(localStorage.getItem(LOCAL_TS_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function setLocalTs(ts) {
    try {
      localStorage.setItem(LOCAL_TS_KEY, String(ts));
    } catch (e) {}
  }

  /* ---------- 云端操作 ---------- */
  async function fetchCloud(sb) {
    const deviceId = getDeviceId();
    const { data, error } = await sb
      .from('rita_app_data')
      .select('data, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data && data[0] ? data[0] : null;
  }

  async function pushCloud(sb, data) {
    const deviceId = getDeviceId();
    const now = new Date().toISOString();
    const { error } = await sb.from('rita_app_data').upsert(
      { id: deviceId, user_device: deviceId, data: data, updated_at: now },
      { onConflict: 'id' }
    );
    if (error) throw error;
  }

  /* ---------- 离线队列（全量快照，最后写入为准） ----------
   * 由于存储是整个 data blob，多次离线修改只保留最后一次快照，
   * flush 时推送最新状态即可，无需逐条重放。
   */
  function enqueue(data) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch (e) {}
  }

  async function flushQueue() {
    const sb = getSupabase();
    if (!sb) return;
    let raw;
    try {
      raw = localStorage.getItem(QUEUE_KEY);
    } catch (e) {
      return;
    }
    if (!raw) return;
    try {
      const { data } = JSON.parse(raw);
      await pushCloud(sb, data);
      localStorage.removeItem(QUEUE_KEY);
      console.log('[RitaSync] 离线队列已同步');
    } catch (e) {
      console.warn('[RitaSync] 队列同步失败:', e);
    }
  }

  /* ---------- 对外接口 ---------- */

  // 同步加载：从本地缓存读取（保证 UI 立即可用）
  function loadStore() {
    const data = readLocal();
    if (!data) return defaultData();
    // 兼容旧数据结构
    if (!data.growth) data.growth = { measurements: [], milestones: [] };
    if (!data.growth.measurements) data.growth.measurements = [];
    if (!data.growth.milestones) data.growth.milestones = [];
    if (!data.growth.allergies) data.growth.allergies = [];
    if (!data.growth.vaccines) data.growth.vaccines = [];
    if (!data.growth.photos) data.growth.photos = [];
    return data;
  }

  // 保存：同步写本地，异步推云端（失败入队）
  function saveStore(data) {
    writeLocal(data);
    setLocalTs(Date.now());
    const sb = getSupabase();
    if (!sb) return;
    pushCloud(sb, data)
      .then(() => {
        try {
          localStorage.removeItem(QUEUE_KEY);
        } catch (e) {}
      })
      .catch((e) => {
        console.warn('[RitaSync] 云端推送失败，已加入离线队列:', e.message);
        enqueue(data);
      });
  }

  // 后台从云端拉取最新数据，按时间戳合并到本地
  async function pullFromCloud() {
    const sb = getSupabase();
    if (!sb) return false;
    try {
      const cloud = await fetchCloud(sb);
      const localTs = getLocalTs();
      if (cloud && cloud.data) {
        const cloudTs = new Date(cloud.updated_at).getTime();
        if (cloudTs > localTs) {
          // 云端更新，覆盖本地
          writeLocal(cloud.data);
          setLocalTs(cloudTs);
          console.log('[RitaSync] 已从云端同步最新数据');
        } else {
          // 本地更新，推送到云端
          const local = readLocal();
          if (local) await pushCloud(sb, local);
          console.log('[RitaSync] 本地数据较新，已推送云端');
        }
      } else {
        // 云端无数据，首次上传本地数据
        const local = readLocal();
        if (local) {
          await pushCloud(sb, local);
          console.log('[RitaSync] 本地数据已首次上传到云端');
        }
      }
      // 启动时 flush 离线队列，确保上次未提交的更改不滞留
      await flushQueue();
      return true;
    } catch (e) {
      console.warn('[RitaSync] 云端拉取失败:', e.message);
      return false;
    }
  }

  // 监听网络恢复，自动 flush 队列
  if (typeof window !== 'undefined') {
    window.addEventListener('online', flushQueue);
  }

  global.RitaSync = { loadStore, saveStore, pullFromCloud, flushQueue, getDeviceId };
})(typeof window !== 'undefined' ? window : globalThis);
