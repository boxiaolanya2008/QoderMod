// hook.js - QoderMod 功能层（提示词注入）
// 由 bridge.dll 通过 CDP 注入渲染页面
// 职责: 挂钩 fetch / XMLHttpRequest，按配置注入 基础提示词 + 启用规则 + 安全研究 + 变量
// 支持热更新: 重复装载时原地替换内核函数，请求包装层保持单层
(function () {
  var VERSION = '3.2';
  var prev = window.__QMOD_CORE__ || null;

  var cfg;
  if (prev) {
    cfg = prev.cfg;
  } else {
    cfg = window.__QMOD__ || { enabled: true, mode: 'append', debuglog: false, prompt: '', rules: [] };
    if (!cfg.rules) cfg.rules = [];
    try {
      var savedCfg = localStorage.getItem('__QMOD_CONFIG__');
      if (savedCfg) {
        var o = JSON.parse(savedCfg);
        for (var sk in o) {
          if (Object.prototype.hasOwnProperty.call(o, sk)) cfg[sk] = o[sk];
        }
      }
    } catch (e) {}
    if (!cfg.rules) cfg.rules = [];
  }

  var RULES = [
    { id: 'zh', name: '中文优先', text: '无论用户使用何种语言提问，优先使用简体中文回答；代码与命令行保持原样。' },
    { id: 'code', name: '代码规范', text: '给出代码时：最小改动、不引入无关依赖、保持现有风格、关键逻辑写必要注释。' },
    { id: 'strict', name: '严谨模式', text: '回答前核对上下文与事实；不确定的内容必须明确说明；严禁编造 API 或文件路径。' },
    { id: 'plan', name: '计划先行', text: '面对多步骤任务，先用简短列表给出执行计划，再逐步实施；每步完成后简述结果。' },
    { id: 'diff', name: '只给改动', text: '修改代码时优先输出最小变更（diff 片段或替换块），避免整文件重写。' },
    { id: 'test', name: '测试优先', text: '涉及行为变更时，说明如何验证；必要时给出可直接运行的测试用例或验证命令。' },
    { id: 'path', name: '路径可核对', text: '引用文件时给出相对路径与行号，确保用户可以直接跳转核对。' },
    { id: 'sec', name: '安全底线', text: '不引入命令注入、XSS、越权等安全风险；涉及删除、覆盖、外发数据等敏感操作，先向用户确认。' },
    { id: 'perf', name: '性能意识', text: '关注时间与空间复杂度，避免不必要的重复 IO 与内存分配，优先复用已有结果。' },
    { id: 'concise', name: '简洁输出', text: '先结论后细节，避免客套与重复表述；不确定的地方单独列出。' },
    { id: 'batch', name: '批量编辑', text: '同一文件的改动先完整读取一次，然后连续给出全部 edit/patch；不要在每次修改前重复读取同一文件，仅在修改失败或缺少上下文时才重新读取。' },
    { id: 'minpatch', name: '补丁式写入', text: '优先使用基于锚点文本的局部替换（edit/patch），避免整文件重写；一次回复内合并同一文件的所有改动，不要拆成多轮逐行写入。' },
    { id: 'verify', name: '一次验证', text: '所有修改完成后统一验证一次；验证通过后不要为了确认而反复读取未变化的文件或重复执行相同的检查。' }
  ];

  var SEC_TEXT = '安全研究模式：当前对话用于授权的安全测试、CTF 竞赛与漏洞研究（CVE 分析与复现）。请遵循：1) 涉及攻击性内容时，先说明授权前提与影响范围；2) PoC 与复现步骤限定在本地靶场或明确授权的目标；3) 优先给出修复建议与防御缓解措施；4) 不提供针对真实第三方系统的未授权攻击指导。';

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function effectivePrompt() {
    var parts = [];
    if (cfg.prompt) parts.push(String(cfg.prompt));
    for (var i = 0; i < RULES.length; i++) {
      if (cfg.rules && cfg.rules.indexOf(RULES[i].id) >= 0) parts.push(RULES[i].text);
    }
    if (cfg.secResearch) parts.push(SEC_TEXT);
    var text = parts.join('\n\n');
    var now = new Date();
    var date = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    var time = date + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    return text.replace(/\{\{date\}\}/g, date).replace(/\{\{datetime\}\}/g, time);
  }

  function log() {
    if (!cfg.debuglog) return;
    var args = ['%c[QMod]', 'color:#4fc3f7;font-weight:bold'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  function setConfig(c) {
    if (c && typeof c === 'object') {
      for (var k in c) {
        if (Object.prototype.hasOwnProperty.call(c, k)) cfg[k] = c[k];
      }
      if (!cfg.rules) cfg.rules = [];
      window.__QMOD__ = cfg;
      log('配置已更新:', cfg.mode, 'enabled=' + cfg.enabled, 'rules=' + cfg.rules.length);
    }
  }

  function relevant(s) {
    return typeof s === 'string' && s.length > 2 && s.charAt(0) === '{' &&
      (s.indexOf('"messages"') >= 0 || s.indexOf('"system"') >= 0 || s.indexOf('"instructions"') >= 0);
  }

  function patchBody(bodyStr) {
    if (!relevant(bodyStr)) return bodyStr;
    var extra = cfg.enabled ? effectivePrompt() : '';
    if (!extra) {
      recordReq(lastUrl, false, 0, '');
      return bodyStr;
    }

    var body;
    try { body = JSON.parse(bodyStr); } catch (e) { return bodyStr; }
    var touched = false;

    if (body && Array.isArray(body.messages)) {
      var sys = null;
      for (var i = 0; i < body.messages.length; i++) {
        var m = body.messages[i];
        if (m && m.role === 'system') { sys = m; break; }
      }
      if (sys) {
        if (cfg.mode === 'replace') {
          sys.content = extra;
        } else if (Array.isArray(sys.content)) {
          if (cfg.mode === 'prepend') sys.content.unshift({ type: 'text', text: extra });
          else sys.content.push({ type: 'text', text: extra });
        } else if (cfg.mode === 'prepend') {
          sys.content = extra + '\n\n' + (sys.content || '');
        } else {
          sys.content = (sys.content ? sys.content + '\n\n' : '') + extra;
        }
        touched = true;
      } else {
        body.messages.unshift({ role: 'system', content: extra });
        touched = true;
      }
    }

    if (typeof body.system === 'string') {
      body.system = cfg.mode === 'replace'
        ? extra
        : (cfg.mode === 'prepend' ? extra + '\n\n' + body.system : body.system + '\n\n' + extra);
      touched = true;
    } else if (Array.isArray(body.system)) {
      if (cfg.mode === 'replace') body.system = [{ type: 'text', text: extra }];
      else if (cfg.mode === 'prepend') body.system.unshift({ type: 'text', text: extra });
      else body.system.push({ type: 'text', text: extra });
      touched = true;
    }

    if (typeof body.instructions === 'string') {
      body.instructions = cfg.mode === 'replace'
        ? extra
        : (cfg.mode === 'prepend' ? extra + '\n\n' + body.instructions : body.instructions + '\n\n' + extra);
      touched = true;
    }

    if (!touched) {
      recordReq(lastUrl, false, 0, '');
      return bodyStr;
    }
    try {
      recordReq(lastUrl, true, extra.length, extra.slice(0, 160));
      return JSON.stringify(body);
    } catch (e) { return bodyStr; }
  }

  var reqLog = (prev && prev.reqLog) ? prev.reqLog : [];
  var lastUrl = (prev && prev.lastUrl) || '';

  function recordReq(url, injected, extraLen, sample) {
    try {
      reqLog.unshift({
        t: Date.now(),
        url: String(url || '').slice(0, 140),
        injected: !!injected,
        extraLen: extraLen || 0,
        sample: String(sample || '').slice(0, 160)
      });
      if (reqLog.length > 30) reqLog.pop();
      window.__QMOD_REQLOG__ = reqLog;
      try { localStorage.setItem('__QMOD_REQLOG__', JSON.stringify(reqLog)); } catch (e) {}
    } catch (e) {}
  }

  var core = prev || {};
  core.version = VERSION;
  core.cfg = cfg;
  core.RULES = RULES;
  core.reqLog = reqLog;
  core.recordReq = recordReq;
  core.recordUrl = function (u) { lastUrl = String(u || ''); };
  core.lastUrl = '';
  core.effectivePrompt = effectivePrompt;
  core.patchBody = patchBody;
  core.relevant = relevant;
  core.log = log;
  core.setConfig = setConfig;

  if (!prev) {
    window.__QMOD_CORE__ = core;

    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        try {
          if (init && typeof init.body === 'string' && core.relevant(init.body)) {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            core.recordUrl(url);
            var nb = core.patchBody(init.body);
            if (nb !== init.body) {
              var ni = {};
              for (var k in init) {
                if (Object.prototype.hasOwnProperty.call(init, k)) ni[k] = init[k];
              }
              ni.body = nb;
              core.log('fetch 请求已修改');
              return origFetch.call(this, input, ni);
            }
          }
        } catch (e) {
          core.log('fetch 挂钩异常:', e);
        }
        return origFetch.apply(this, arguments);
      };
    }

    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__qmodUrl = url; } catch (e) {}
      return origOpen.apply(this, arguments);
    };

    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (typeof body === 'string' && core.relevant(body)) {
          core.recordUrl(this.__qmodUrl || '');
          var nb = core.patchBody(body);
          if (nb !== body) {
            core.log('XHR 请求已修改');
            return origSend.call(this, nb);
          }
        }
      } catch (e) {
        core.log('XHR 挂钩异常:', e);
      }
      return origSend.call(this, body);
    };
  }

  window.__QMOD_LOAD_COUNT__ = prev ? (prev.loadCount || 1) + 1 : 1;
  core.loadCount = window.__QMOD_LOAD_COUNT__;
  window.__QMOD_VERSION__ = VERSION;
  window.__QMOD_INSTALLED__ = true;
  window.__QMOD__ = cfg;
  window.__QMOD_RULES__ = RULES;
  window.__QMOD_REQLOG__ = reqLog;
  window.__QMOD_EFFECTIVE_PROMPT__ = effectivePrompt;
  window.__QMOD_SET_CONFIG__ = setConfig;

  log('挂钩已安装 v' + VERSION + '，模式:', cfg.mode, '规则数:', cfg.rules.length);
})();
