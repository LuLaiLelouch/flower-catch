/* ==========================================================================
   cloud-board.js · 全服共享排行榜（WorkBuddy 云数据库）
   --------------------------------------------------------------------------
   榜单存在云端数据库，所有通过发布网址打开的人看到的是同一份数据。
   本地 file:// 直接打开时 Origin 不匹配，云端会拒绝请求 —— 这是正常的，
   页面会给出明确的失败提示，不会静默退回本地 localStorage 假装有数据。
   ========================================================================== */
(() => {
  'use strict';

  // 云服务激活时返回的公开配置：可以放在前端，不含任何管理员密钥。
  // 必须原样使用 publicConfig，不要用 location / 硬编码其它域名去拼。
  const publicConfig = {
    endpoint: 'https://wbapp-yudaw7fmiebs5k4zewgq8m.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_YUdAw7fMiEbS5K4ZewGq8M_3ztsJv5lsKaTLsgO90u08VDNDRuogUYW',
  };

  let cloud = null;
  let initError = null;
  try {
    if (!window.WorkBuddyCloud || !WorkBuddyCloud.createWorkBuddyCloud) {
      throw new Error('云服务 SDK 未加载');
    }
    cloud = WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: publicConfig.endpoint,
      oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
      publishableKey: publicConfig.publishableKey,
    });
  } catch (e) {
    initError = e;
  }

  const cache = { list: [], loaded: false, error: initError };

  /* 同名玩家按首次上榜时间编号（#1 / #2）。编号只是展示用的，
     由前端算，不写进数据库，避免并发分配时撞号。 */
  function normalize(rows) {
    const groups = {};
    rows.forEach(r => { (groups[r.player_id] = groups[r.player_id] || []).push(r); });
    Object.keys(groups).forEach(id => {
      groups[id].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      groups[id].forEach((r, i) => { r.tag = i + 1; });
    });
    return rows.map(r => ({
      id: r.player_id,
      host: r.host_key,
      tag: r.tag,
      score: Number(r.score) || 0,
      at: Date.parse(r.created_at) || Date.now(),
    }));
  }

  async function refresh() {
    if (!cloud) { cache.error = initError || new Error('云服务未就绪'); return false; }
    const { data, error } = await cloud.database
      .from('scores')
      .select('player_id, host_key, score, created_at')
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) { cache.error = error; return false; }
    cache.list = normalize(Array.isArray(data) ? data : []);
    cache.loaded = true;
    cache.error = null;
    return true;
  }

  /* 提交走数据库函数：服务端校验输入、同一玩家只保留最高分（只能升不能降）。
     客户端没有直接改表的权限，改不了别人的成绩。 */
  async function submit(playerId, hostKey, score) {
    if (!cloud) { cache.error = initError || new Error('云服务未就绪'); return false; }
    const { error } = await cloud.database.rpc('submit_score', {
      p_player_id: playerId,
      p_host_key: hostKey,
      p_score: Math.round(score),
    });
    if (error) { cache.error = error; return false; }
    cache.error = null;
    return true;
  }

  // 只删自己在云端那一条，不影响其他玩家
  async function clearMine(hostKey) {
    if (!cloud) { cache.error = initError || new Error('云服务未就绪'); return false; }
    const { error } = await cloud.database.rpc('clear_my_score', { p_host_key: hostKey });
    if (error) { cache.error = error; return false; }
    cache.error = null;
    return true;
  }

  window.CloudBoard = {
    ready: () => !!cloud,
    status: () => ({ loaded: cache.loaded, error: cache.error }),
    list: () => cache.list.slice(),
    setList: l => { cache.list = Array.isArray(l) ? l.slice() : []; },
    refresh,
    submit,
    clearMine,
  };
})();
