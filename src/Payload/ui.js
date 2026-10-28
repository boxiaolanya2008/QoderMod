// ui.js - QoderMod 设置中心 v2.6
// 布局: 左侧导航 + 右侧内容卡片（参考 Qoder 设置页），支持 侧边栏/折叠/标签 三种视图
// 特性: i18n(中/英, 跟随系统)、主题跟随系统、配置保存到 %USERPROFILE%\.qoder-cn\qcmod.json（经 bridge）
// 样式全部通过 JS 与 CSS 变量设置，规避页面 CSP 对内联样式表的限制
(function () {
  if (window.__QMOD_UI_TEARDOWN__) {
    try { window.__QMOD_UI_TEARDOWN__(); } catch (e) {}
  } else if (window.__QMOD_UI__) {
    try {
      var legacySheet = new CSSStyleSheet();
      legacySheet.replaceSync('[data-qmod-legacy]{display:none!important;pointer-events:none!important}');
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat(legacySheet);
    } catch (e) {}
    Array.prototype.forEach.call(
      document.querySelectorAll('#qmod-panel,#qmod-entry,.qmod-appmenu-item,.qmod-menubar-item,#qmod-status-item'),
      function (e) {
        if (!e.hasAttribute('data-qmod-legacy')) {
          e.setAttribute('data-qmod-legacy', '1');
          if (e.id) e.removeAttribute('id');
          Array.prototype.forEach.call(e.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
          if (e.parentNode) e.parentNode.removeChild(e);
        }
      }
    );
  }
  window.__QMOD_UI__ = true;

  var intervals = [];
  var listeners = [];
  var buildListeners = [];

  function on(target, type, fn) {
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  }

  function onBuild(target, type, fn) {
    target.addEventListener(type, fn);
    buildListeners.push([target, type, fn]);
  }

  function clearBuildListeners() {
    for (var i = 0; i < buildListeners.length; i++) {
      try { buildListeners[i][0].removeEventListener(buildListeners[i][1], buildListeners[i][2]); } catch (e) {}
    }
    buildListeners = [];
  }

  var mql = window.matchMedia('(prefers-color-scheme: dark)');

  var THEMES = {
    dark: {
      '--qm-bg': '#1b1c21',
      '--qm-nav': '#16171b',
      '--qm-bg-soft': '#24262d',
      '--qm-bg-hover': '#2e313a',
      '--qm-border': '#3b3f4a',
      '--qm-text': '#e7e8ec',
      '--qm-text-dim': '#9aa0ad',
      '--qm-accent': '#5eb0ff',
      '--qm-accent-soft': 'rgba(94,176,255,.14)',
      '--qm-ok': '#59d99a',
      '--qm-danger': '#ff8080',
      '--qm-shadow': '0 14px 44px rgba(0,0,0,.55)'
    },
    light: {
      '--qm-bg': '#ffffff',
      '--qm-nav': '#f4f5f7',
      '--qm-bg-soft': '#f3f4f7',
      '--qm-bg-hover': '#e9ebf1',
      '--qm-border': '#d9dce4',
      '--qm-text': '#23262d',
      '--qm-text-dim': '#6d7280',
      '--qm-accent': '#2f7fe0',
      '--qm-accent-soft': 'rgba(47,127,224,.12)',
      '--qm-ok': '#1f9d63',
      '--qm-danger': '#d05050',
      '--qm-shadow': '0 14px 44px rgba(30,40,70,.18)'
    }
  };

  var I18N = {
    zh: {
      title: 'QoderMod 设置中心',
      subtitle: '系统提示词 · Agent 增强',
      'group.general': '通用',
      'group.ext': '扩展',
      'group.other': '其他',
      'nav.prompt': '基础提示词',
      'nav.rules': '规则库',
      'nav.sec': '安全研究',
      'nav.tool': '自定义工具',
      'nav.presets': '方案库',
      'nav.monitor': '请求监视',
      'nav.settings': '设置',
      'prompt.mode': '注入方式',
      'mode.append': '追加到系统提示',
      'mode.prepend': '前置到系统提示',
      'mode.replace': '替换系统提示',
      'prompt.placeholder': '在这里填写基础系统提示词，例如角色设定、工作流要求、输出约束...',
      'prompt.vars': '支持变量：{{date}} 当前日期 · {{datetime}} 当前日期时间（发送请求时替换）',
      'rules.tip': '选中规则会自动拼接在基础提示词之后',
      'rules.selected': '已选 {n} 条',
      'sec.label': '启用安全研究提示框架',
      'sec.hint': '适合授权测试、CTF、CVE 分析 / 复现等场景',
      'sec.desc': '开启后会在提示词末尾追加：授权前提与影响范围说明、PoC 限定本地靶场或授权目标、优先给出修复与缓解建议、不提供针对真实第三方系统的未授权攻击指导。',
      'tool.inject': '向模型注入文件工具',
      'tool.injectHint': 'qmod_batch_patch（一次读 + 多次替换 + 一次写）/ qmod_read_range（按行读取）',
      'tool.force': '强制接管 write / edit 调用',
      'tool.forceHint': '检测到模型调用 write/edit 时替换为本机批量工具（需主进程拦截通道）',
      'tool.desc': '工具由本机 bridge.dll 提供（localStorage 信箱 + 9334 HTTP，令牌鉴权），不经过 MCP。一次调用完成全部替换、只写回一次。',
      'tool.check': '重新检测',
      'tool.checking': '工具服务: 检测中...',
      'tool.ok': '工具服务: 正常 · 本机 bridge',
      'tool.down': '工具服务: 不可用（bridge 未响应）',
      'tool.capture': '调试捕获: {n} 轮',
      'tool.copy': '复制捕获数据',
      'presets.placeholder': '方案名称，例如：严格评审模式',
      'presets.save': '保存当前',
      'presets.export': '导出配置到剪贴板',
      'presets.import': '从剪贴板导入',
      'presets.empty': '还没有保存的方案。填写名称后点"保存当前"，可一键切换不同工作模式。',
      'presets.apply': '应用',
      'presets.delete': '删除',
      'presets.loaded': '已载入方案「{name}」，保存后生效',
      'presets.saved': '方案「{name}」已保存',
      'monitor.info': '挂钩已安装 · 最近 {n} 条拦截记录',
      'monitor.clear': '清空',
      'monitor.empty': '暂无记录：在 Qoder 里发一条消息试试，命中后这里会出现请求条目。',
      'monitor.emptyNoMain': '暂无记录。原因：聊天与工具调用运行在 Qoder 主进程，渲染层监视不到；且主进程钩子尚未安装。运行启动器 [7] 一键部署并重启后，请求会出现在这里。',
      'monitor.emptyMain': '主进程钩子已安装，等待下一次聊天请求...',
      'monitor.unsupported': '当前挂钩版本不支持监视（重启 Qoder 后生效）',
      'monitor.patched': '已注入 +{n}字',
      'monitor.pass': '放行',
      'monitor.src.main': '主进程',
      'monitor.src.renderer': '渲染层',
      'tool.mainHook': '主进程钩子',
      'tool.mainHookOk': '已安装（生效中）',
      'tool.mainHookPending': '补丁已应用，等待重启 Qoder 生效',
      'tool.mainHookOff': '未安装：运行启动器 [7] 一键部署后重启',
      'tool.mainHookWait': '检测中...',
      'settings.theme': '主题',
      'theme.auto': '跟随系统',
      'theme.dark': '深色',
      'theme.light': '浅色',
      'settings.lang': '语言',
      'lang.auto': '跟随系统',
      'lang.zh': '中文',
      'lang.en': 'English',
      'settings.view': '界面模式',
      'view.sidebar': '侧边栏（设置页）',
      'view.accordion': '折叠模式',
      'view.tabs': '标签模式',
      'settings.version': '版本',
      'settings.hotkey': '快捷键',
      'settings.hotkeyVal': 'Ctrl+Shift+M 呼出 / 收起面板',
      'settings.file': '配置文件',
      'settings.fileVal': '~/.qoder-cn/qcmod.json（保存后自动写入）',
      'settings.reset': '重置本机配置',
      'settings.resetDone': '本机配置已重置，重新打开面板后生效',
      'save': '保存并应用',
      'saving': '保存中...',
      'saved': '已保存并应用',
      'savedToast': '已保存并写入 ~/.qoder-cn/qcmod.json',
      'theme.changed': '主题已切换，保存后持久生效',
      'lang.changed': '语言已切换',
      'copy.ok': '配置已复制到剪贴板',
      'copy.fail': '复制失败',
      'capture.none': '暂无捕获数据，先在 Qoder 里发一条消息',
      'capture.copied': '捕获数据已复制（{n} 字符）',
      'capture.info': '调试捕获: {n} 轮',
      'tool.on': '工具注入已开启，保存后对后续请求生效',
      'tool.off': '工具注入已关闭，保存后生效',
      'status.injecting': '保存中...',
      'enable.title': '启用 / 停用提示词注入',
      'entries': 'QoderMod',
      'entries.back': '返回应用'
    },
    en: {
      title: 'QoderMod Settings',
      subtitle: 'System prompt · Agent boost',
      'group.general': 'General',
      'group.ext': 'Extensions',
      'group.other': 'Other',
      'nav.prompt': 'Base prompt',
      'nav.rules': 'Rules',
      'nav.sec': 'Security research',
      'nav.tool': 'Custom tools',
      'nav.presets': 'Presets',
      'nav.monitor': 'Monitor',
      'nav.settings': 'Settings',
      'prompt.mode': 'Injection mode',
      'mode.append': 'Append to system prompt',
      'mode.prepend': 'Prepend to system prompt',
      'mode.replace': 'Replace system prompt',
      'prompt.placeholder': 'Base system prompt: role, workflow, output constraints...',
      'prompt.vars': 'Variables: {{date}} today · {{datetime}} now (resolved when the request is sent)',
      'rules.tip': 'Selected rules are appended after the base prompt',
      'rules.selected': '{n} selected',
      'sec.label': 'Enable security-research prompt',
      'sec.hint': 'For authorized testing, CTF, CVE analysis / reproduction',
      'sec.desc': 'Appends: authorization scope note, PoC restricted to local labs or authorized targets, remediation first, no unauthorized attack guidance against real third parties.',
      'tool.inject': 'Inject file tools to the model',
      'tool.injectHint': 'qmod_batch_patch (read once + N replaces + one write) / qmod_read_range (line range)',
      'tool.force': 'Force take over write / edit calls',
      'tool.forceHint': 'Replace native write/edit calls with the local batch tool (needs the main-process channel)',
      'tool.desc': 'Tools run inside bridge.dll (localStorage mailbox + HTTP 9334, token auth), no MCP. One call applies all replacements and writes once.',
      'tool.check': 'Recheck',
      'tool.checking': 'Tool service: checking...',
      'tool.ok': 'Tool service: OK · local bridge',
      'tool.down': 'Tool service: unavailable (bridge not responding)',
      'tool.capture': 'Debug capture: {n} rounds',
      'tool.copy': 'Copy capture data',
      'presets.placeholder': 'Preset name, e.g. strict-review',
      'presets.save': 'Save current',
      'presets.export': 'Export to clipboard',
      'presets.import': 'Import from clipboard',
      'presets.empty': 'No presets yet. Name it and click "Save current" to switch modes quickly.',
      'presets.apply': 'Apply',
      'presets.delete': 'Delete',
      'presets.loaded': 'Loaded "{name}", save to apply',
      'presets.saved': 'Preset "{name}" saved',
      'monitor.info': 'Hook installed · last {n} intercepted requests',
      'monitor.clear': 'Clear',
      'monitor.empty': 'No records yet: send a message in Qoder and hits will show up here.',
      'monitor.emptyNoMain': 'No records. Chat and tool calls run in the Qoder main process, invisible to the renderer; the main-process hook is not installed yet. Run launcher [7] one-click deploy and restart Qoder.',
      'monitor.emptyMain': 'Main-process hook installed, waiting for the next chat request...',
      'monitor.unsupported': 'Monitor unsupported by current hook (restart Qoder)',
      'monitor.patched': 'injected +{n} chars',
      'monitor.pass': 'pass',
      'monitor.src.main': 'main',
      'monitor.src.renderer': 'renderer',
      'tool.mainHook': 'Main-process hook',
      'tool.mainHookOk': 'installed (active)',
      'tool.mainHookPending': 'patch applied, restart Qoder to activate',
      'tool.mainHookOff': 'not installed: run launcher [7] one-click deploy',
      'tool.mainHookWait': 'checking...',
      'settings.theme': 'Theme',
      'theme.auto': 'Follow system',
      'theme.dark': 'Dark',
      'theme.light': 'Light',
      'settings.lang': 'Language',
      'lang.auto': 'Follow system',
      'lang.zh': '中文',
      'lang.en': 'English',
      'settings.view': 'Layout',
      'view.sidebar': 'Sidebar (settings page)',
      'view.accordion': 'Accordion',
      'view.tabs': 'Tabs',
      'settings.version': 'Version',
      'settings.hotkey': 'Hotkey',
      'settings.hotkeyVal': 'Ctrl+Shift+M toggle panel',
      'settings.file': 'Config file',
      'settings.fileVal': '~/.qoder-cn/qcmod.json (written on save)',
      'settings.reset': 'Reset local config',
      'settings.resetDone': 'Local config reset, reopen the panel to apply',
      'save': 'Save & apply',
      'saving': 'Saving...',
      'saved': 'Saved & applied',
      'savedToast': 'Saved to ~/.qoder-cn/qcmod.json',
      'theme.changed': 'Theme switched, save to persist',
      'lang.changed': 'Language switched',
      'copy.ok': 'Config copied to clipboard',
      'copy.fail': 'Copy failed',
      'capture.none': 'No capture yet, send a message in Qoder first',
      'capture.copied': 'Capture copied ({n} chars)',
      'capture.info': 'Debug capture: {n} rounds',
      'tool.on': 'Tool injection ON, applies after save',
      'tool.off': 'Tool injection OFF, applies after save',
      'status.injecting': 'Saving...',
      'enable.title': 'Enable / disable prompt injection',
      'entries': 'QoderMod',
      'entries.back': 'Back to app'
    }
  };

  function fmt(s, map) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m;
    });
  }

  var draft = {
    enabled: true, mode: 'append', prompt: '', rules: [], theme: 'auto',
    secResearch: false, lang: 'auto'
  };
  var viewState = { mode: 'sidebar', tab: 'prompt' };
  try {
    var savedView = JSON.parse(localStorage.getItem('__QMOD_VIEW__') || 'null');
    if (savedView && (savedView.mode === 'tabs' || savedView.mode === 'accordion' || savedView.mode === 'sidebar')) {
      viewState.mode = savedView.mode;
      viewState.tab = savedView.tab || 'prompt';
    }
  } catch (e) {}
  function saveView() {
    try { localStorage.setItem('__QMOD_VIEW__', JSON.stringify(viewState)); } catch (e) {}
  }

  var panel = null;
  var btn = null;
  var dot = null;
  var sectionRefs = {};
  var navRefs = {};

  function langNow() {
    if (draft.lang === 'zh' || draft.lang === 'en') return draft.lang;
    var n = (navigator.language || '').toLowerCase();
    return n.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  function T(key, map) {
    var d = I18N[langNow()] || I18N.zh;
    var s = d[key] || I18N.zh[key] || key;
    return map ? fmt(s, map) : s;
  }

  function mk(tag, css, txt) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function currentCfg() {
    return window.__QMOD__ || {};
  }

  function loadDraft() {
    var c = currentCfg();
    draft.enabled = !!c.enabled;
    draft.mode = c.mode || 'append';
    draft.prompt = c.prompt || '';
    draft.rules = Array.isArray(c.rules) ? c.rules.slice() : [];
    draft.theme = c.theme || 'auto';
    draft.secResearch = !!c.secResearch;
    draft.lang = c.lang || 'auto';
  }

  function isDarkNow() {
    if (draft.theme === 'dark') return true;
    if (draft.theme === 'light') return false;
    return mql.matches;
  }

  function applyTheme() {
    var t = THEMES[isDarkNow() ? 'dark' : 'light'];
    if (panel) {
      for (var k in t) panel.style.setProperty(k, t[k]);
    }
    if (btn) {
      for (var k2 in t) btn.style.setProperty(k2, t[k2]);
    }
  }

  on(mql, 'change', function () {
    applyTheme();
  });

  function isOpen() {
    return panel && panel.style.display === 'flex';
  }

  function status(msg) {
    if (!panel) return;
    var el = panel.querySelector('#qm-status');
    if (el) el.textContent = msg || '';
  }

  function findRule(id) {
    var list = window.__QMOD_RULES__ || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function renderCounter() {
    if (!panel) return;
    var len = (draft.prompt || '').length;
    var ruleLen = 0;
    for (var i = 0; i < draft.rules.length; i++) {
      var r = findRule(draft.rules[i]);
      if (r) ruleLen += r.text.length + 2;
    }
    var el = panel.querySelector('#qm-count');
    if (el) {
      el.textContent = langNow() === 'zh'
        ? ('基础 ' + len + ' 字 · 规则 ' + draft.rules.length + ' 条 · 安全研究 ' + (draft.secResearch ? '开' : '关') + ' · 命中时约发送 ' + (len + ruleLen) + ' 字')
        : (len + ' chars · ' + draft.rules.length + ' rules · security ' + (draft.secResearch ? 'on' : 'off') + ' · ~' + (len + ruleLen) + ' chars sent');
    }
    var badge = sectionRefs.rules ? sectionRefs.rules.badge : null;
    if (badge) badge.textContent = fmt(T('rules.selected'), { n: draft.rules.length });
    var secBadge = sectionRefs.sec ? sectionRefs.sec.badge : null;
    if (secBadge) secBadge.textContent = draft.secResearch ? 'ON' : '';
  }

  function buildSwitch(on, onChange) {
    var track = mk('div', 'width:34px;height:20px;border-radius:10px;position:relative;cursor:pointer;flex:none;transition:background .15s;background:' + (on ? 'var(--qm-accent)' : 'var(--qm-bg-hover)') + ';');
    var knob = mk('div', 'position:absolute;top:2px;left:' + (on ? '16px' : '2px') + ';width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.35);');
    track.appendChild(knob);
    track.onclick = function () {
      on = !on;
      track.style.background = on ? 'var(--qm-accent)' : 'var(--qm-bg-hover)';
      knob.style.left = on ? '16px' : '2px';
      onChange(on);
    };
    return track;
  }

  function selectStyle() {
    return 'flex:1;min-width:0;background:var(--qm-bg-soft);color:var(--qm-text);border:1px solid var(--qm-border);border-radius:7px;padding:6px 8px;outline:none;font:12px "Segoe UI",sans-serif;';
  }

  function fillSelect(sel, defs) {
    for (var i = 0; i < defs.length; i++) {
      var op = document.createElement('option');
      op.value = defs[i][0];
      op.textContent = defs[i][1];
      sel.appendChild(op);
    }
  }

  var SECTIONS = [
    ['prompt', 'nav.prompt'],
    ['rules', 'nav.rules'],
    ['sec', 'nav.sec'],
        ['presets', 'nav.presets'],
        ['settings', 'nav.settings']
  ];
  var NAV_GROUPS = [
    ['group.general', ['prompt', 'rules', 'sec']],
    ['group.ext', ['presets']],
    ['group.other', ['settings']]
  ];

  function buildSection(parent, id, open) {
    var card = mk('div', 'border:1px solid var(--qm-border);border-radius:10px;margin-bottom:12px;background:var(--qm-bg);box-sizing:border-box;transition:opacity .16s ease;');
    var head = mk('div', 'display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;user-select:none;border-bottom:1px solid transparent;');
    var arrow = mk('span', 'font-size:9px;color:var(--qm-text-dim);width:12px;flex:none;', open ? '▼' : '▶');
    var titleEl = mk('div', 'flex:1;font-size:13px;font-weight:600;', T('nav.' + id));
    var badge = mk('span', 'font-size:10px;color:var(--qm-text-dim);flex:none;', '');
    head.appendChild(arrow);
    head.appendChild(titleEl);
    head.appendChild(badge);
    var content = mk('div', 'display:' + (open ? 'block' : 'none') + ';padding:2px 14px 14px;');
    card.appendChild(head);
    card.appendChild(content);
    parent.appendChild(card);
    sectionRefs[id] = { open: open, arrow: arrow, badge: badge, content: content, head: head, card: card, titleEl: titleEl };
    head.onclick = function () {
      var s = sectionRefs[id];
      s.open = !s.open;
      s.arrow.textContent = s.open ? '▼' : '▶';
      s.content.style.display = s.open ? 'block' : 'none';
      if (id === 'monitor' && s.open) renderMonitor();
    };
    return content;
  }

  function buildPanel() {
    if (panel || !document.body) return;
    clearBuildListeners();
    sectionRefs = {};
    navRefs = {};

    var savedSize = null;
    try { savedSize = JSON.parse(localStorage.getItem('__QMOD_SIZE__') || 'null'); } catch (e) {}
    var pw = savedSize && savedSize.w ? savedSize.w : 880;
    var px = Math.max(16, Math.round((window.innerWidth - pw) / 2));
    var py = 80;
    var ph = savedSize && savedSize.h ? ('height:' + savedSize.h + 'px;') : 'height:640px;max-height:88vh;';

    panel = mk('div', 'position:fixed;left:' + px + 'px;top:' + py + 'px;z-index:2147483647;width:' + pw + 'px;' + ph + 'display:none;flex-direction:column;background:var(--qm-bg);border:1px solid var(--qm-border);border-radius:12px;box-shadow:var(--qm-shadow);color:var(--qm-text);font:12px/1.5 "Segoe UI",-apple-system,sans-serif;overflow:hidden;box-sizing:border-box;transition:opacity .18s ease, transform .18s ease;will-change:opacity,transform;');
    panel.id = 'qmod-panel';

    // 头部
    var header = mk('div', 'display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--qm-border);cursor:move;user-select:none;');
    dot = mk('span', 'width:8px;height:8px;border-radius:50%;background:var(--qm-text-dim);flex:none;');
    var titleBox = mk('div', 'flex:1;min-width:0;');
    var t1 = mk('div', 'font-size:13px;font-weight:700;letter-spacing:.3px;', T('title'));
    var t2 = mk('div', 'font-size:10px;color:var(--qm-text-dim);margin-top:1px;', T('subtitle') + ' · v' + (window.__QMOD_VERSION__ || '2.7'));
    titleBox.appendChild(t1);
    titleBox.appendChild(t2);
    var sw = buildSwitch(draft.enabled, function (on) {
      draft.enabled = on;
      refreshDot();
    });
    sw.setAttribute('data-no-drag', '1');
    sw.title = T('enable.title');
    var closeBtn = mk('span', 'cursor:pointer;color:var(--qm-text-dim);font-size:16px;padding:0 4px;flex:none;', '×');
    closeBtn.setAttribute('data-no-drag', '1');
    closeBtn.onclick = closePanel;
    closeBtn.onmouseenter = function () { closeBtn.style.color = 'var(--qm-text)'; };
    closeBtn.onmouseleave = function () { closeBtn.style.color = 'var(--qm-text-dim)'; };
    header.appendChild(dot);
    header.appendChild(titleBox);
    header.appendChild(sw);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 标签栏（标签模式）
    var tabbar = mk('div', 'display:none;gap:2px;padding:8px 12px 0;border-bottom:1px solid var(--qm-border);flex-wrap:wrap;');
    tabbar.id = 'qm-tabbar';
    for (var tb = 0; tb < SECTIONS.length; tb++) {
      (function (def) {
        var b2 = mk('button', 'padding:6px 10px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--qm-text-dim);font-size:12px;cursor:pointer;border-radius:6px 6px 0 0;');
        b2.textContent = T(def[1]);
        b2.setAttribute('data-viewtab', def[0]);
        b2.onclick = function () {
          viewState.tab = def[0];
          saveView();
          applyView();
        };
        tabbar.appendChild(b2);
      })(SECTIONS[tb]);
    }
    panel.appendChild(tabbar);

    // 主体：左侧导航 + 右侧内容
    var main = mk('div', 'flex:1;display:flex;min-height:0;');
    var nav = mk('div', 'width:184px;flex:none;background:var(--qm-nav);border-right:1px solid var(--qm-border);padding:10px 8px;overflow:auto;box-sizing:border-box;');
    nav.id = 'qm-nav';
    for (var g = 0; g < NAV_GROUPS.length; g++) {
      nav.appendChild(mk('div', 'padding:8px 10px 4px;font-size:10px;color:var(--qm-text-dim);letter-spacing:.5px;', T(NAV_GROUPS[g][0])));
      for (var i2 = 0; i2 < NAV_GROUPS[g][1].length; i2++) {
        (function (sid) {
          var item = mk('div', 'display:flex;align-items:center;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:12px;color:var(--qm-text-dim);user-select:none;transition:background .15s ease, color .15s ease;');
          item.textContent = T('nav.' + sid);
          item.setAttribute('data-nav', sid);
          item.onclick = function () {
            viewState.tab = sid;
            saveView();
            applyView();
          };
          item.onmouseenter = function () {
            if (viewState.tab !== sid) item.style.background = 'var(--qm-bg-hover)';
          };
          item.onmouseleave = function () {
            if (viewState.tab !== sid) item.style.background = 'transparent';
          };
          nav.appendChild(item);
          navRefs[sid] = item;
        })(NAV_GROUPS[g][1][i2]);
      }
    }
    main.appendChild(nav);

    var content = mk('div', 'flex:1;min-width:0;overflow-y:auto;overflow-x:hidden;padding:16px;box-sizing:border-box;background:var(--qm-bg);');
    content.id = 'qm-content';

    // 基础提示词
    var pgPrompt = buildSection(content, 'prompt', true);
    var modeRow = mk('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;');
    modeRow.appendChild(mk('span', 'color:var(--qm-text-dim);flex:none;', T('prompt.mode')));
    var modeSel = mk('select', selectStyle());
    modeSel.id = 'qm-mode';
    fillSelect(modeSel, [['append', T('mode.append')], ['prepend', T('mode.prepend')], ['replace', T('mode.replace')]]);
    modeRow.appendChild(modeSel);
    pgPrompt.appendChild(modeRow);

    var ta = mk('textarea', 'display:block;width:100%;min-height:190px;max-height:420px;padding:10px;box-sizing:border-box;resize:vertical;background:var(--qm-bg-soft);color:var(--qm-text);border:1px solid var(--qm-border);border-radius:8px;outline:none;font:12px/1.6 "Segoe UI",sans-serif;');
    ta.id = 'qm-prompt';
    ta.placeholder = T('prompt.placeholder');
    pgPrompt.appendChild(ta);
    var count = mk('div', 'color:var(--qm-text-dim);font-size:11px;margin-top:8px;line-height:1.5;');
    count.id = 'qm-count';
    pgPrompt.appendChild(count);
    pgPrompt.appendChild(mk('div', 'color:var(--qm-text-dim);font-size:11px;opacity:.8;margin-top:4px;', T('prompt.vars')));

    // 规则库
    var pgRules = buildSection(content, 'rules', true);
    var rulesTip = mk('div', 'color:var(--qm-text-dim);font-size:11px;margin-bottom:8px;', T('rules.tip'));
    rulesTip.id = 'qm-rules-tip';
    pgRules.appendChild(rulesTip);
    var ruleList = mk('div', 'display:flex;flex-direction:column;');
    ruleList.id = 'qm-rule-list';
    pgRules.appendChild(ruleList);

    // 安全研究
    var pgSec = buildSection(content, 'sec', false);
    var secRow = mk('div', 'display:flex;align-items:center;gap:10px;margin-bottom:8px;');
    var secLbBox = mk('div', 'flex:1;min-width:0;');
    secLbBox.appendChild(mk('div', 'font-size:12px;font-weight:600;', T('sec.label')));
    secLbBox.appendChild(mk('div', 'font-size:10px;color:var(--qm-text-dim);margin-top:2px;', T('sec.hint')));
    var secSw = buildSwitch(draft.secResearch, function (on) {
      draft.secResearch = on;
      renderCounter();
    });
    secSw.id = 'qm-sec-sw';
    secRow.appendChild(secLbBox);
    secRow.appendChild(secSw);
    pgSec.appendChild(secRow);
    pgSec.appendChild(mk('div', 'font-size:10.5px;color:var(--qm-text-dim);line-height:1.6;background:var(--qm-bg-soft);border:1px solid var(--qm-border);border-radius:8px;padding:8px 10px;', T('sec.desc')));

    // 方案库
    var pgPresets = buildSection(content, 'presets', false);
    var pRow = mk('div', 'display:flex;gap:8px;margin-bottom:10px;');
    var pName = mk('input', 'flex:1;min-width:0;background:var(--qm-bg-soft);color:var(--qm-text);border:1px solid var(--qm-border);border-radius:7px;padding:6px 8px;outline:none;font:12px "Segoe UI",sans-serif;');
    pName.id = 'qm-preset-name';
    pName.placeholder = T('presets.placeholder');
    var pAdd = mk('button', 'padding:6px 12px;border:none;border-radius:7px;background:var(--qm-accent-soft);color:var(--qm-accent);cursor:pointer;font-size:12px;flex:none;', T('presets.save'));
    pAdd.onclick = function () {
      var n = pName.value.trim() || ('Preset ' + (loadPresets().length + 1));
      var list = loadPresets();
      list.push({ name: n, prompt: draft.prompt, rules: draft.rules.slice(), mode: draft.mode, secResearch: draft.secResearch });
      savePresets(list);
      pName.value = '';
      renderPresets();
      status(fmt(T('presets.saved'), { name: n }));
    };
    pRow.appendChild(pName);
    pRow.appendChild(pAdd);
    pgPresets.appendChild(pRow);
    var pList = mk('div', 'display:flex;flex-direction:column;gap:6px;');
    pList.id = 'qm-preset-list';
    pgPresets.appendChild(pList);
    var ioRow = mk('div', 'display:flex;gap:8px;margin-top:12px;');
    var expBtn = mk('button', 'flex:1;padding:6px 0;border:1px solid var(--qm-border);border-radius:7px;background:transparent;color:var(--qm-text-dim);cursor:pointer;font-size:11px;', T('presets.export'));
    expBtn.onclick = exportConfig;
    var impBtn = mk('button', 'flex:1;padding:6px 0;border:1px solid var(--qm-border);border-radius:7px;background:transparent;color:var(--qm-text-dim);cursor:pointer;font-size:11px;', T('presets.import'));
    impBtn.onclick = importConfig;
    ioRow.appendChild(expBtn);
    ioRow.appendChild(impBtn);
    pgPresets.appendChild(ioRow);

    // 设置
    var pgSettings = buildSection(content, 'settings', false);
    var themeRow = mk('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;');
    themeRow.appendChild(mk('span', 'color:var(--qm-text-dim);flex:none;', T('settings.theme')));
    var themeSel = mk('select', selectStyle());
    themeSel.id = 'qm-theme';
    fillSelect(themeSel, [['auto', T('theme.auto')], ['dark', T('theme.dark')], ['light', T('theme.light')]]);
    themeSel.onchange = function () {
      draft.theme = themeSel.value;
      applyTheme();
      status(T('theme.changed'));
    };
    themeRow.appendChild(themeSel);
    pgSettings.appendChild(themeRow);

    var langRow = mk('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;');
    langRow.appendChild(mk('span', 'color:var(--qm-text-dim);flex:none;', T('settings.lang')));
    var langSel = mk('select', selectStyle());
    langSel.id = 'qm-lang';
    fillSelect(langSel, [['auto', T('lang.auto')], ['zh', T('lang.zh')], ['en', T('lang.en')]]);
    langSel.onchange = function () {
      draft.lang = langSel.value;
      rebuildPanel();
    };
    langRow.appendChild(langSel);
    pgSettings.appendChild(langRow);

    var viewRow = mk('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;');
    viewRow.appendChild(mk('span', 'color:var(--qm-text-dim);flex:none;', T('settings.view')));
    var viewSel = mk('select', selectStyle());
    viewSel.id = 'qm-view';
    fillSelect(viewSel, [['sidebar', T('view.sidebar')], ['accordion', T('view.accordion')], ['tabs', T('view.tabs')]]);
    viewSel.onchange = function () {
      viewState.mode = viewSel.value;
      saveView();
      applyView();
    };
    viewRow.appendChild(viewSel);
    pgSettings.appendChild(viewRow);

    var verRow = mk('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:var(--qm-text-dim);');
    verRow.appendChild(mk('span', 'flex:none;', T('settings.version')));
    verRow.appendChild(mk('span', 'font-variant-numeric:tabular-nums;', 'v' + (window.__QMOD_VERSION__ || '2.6') + ' · hot-update on'));
    pgSettings.appendChild(verRow);

    var keyRow = mk('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:var(--qm-text-dim);');
    keyRow.appendChild(mk('span', 'flex:none;', T('settings.hotkey')));
    keyRow.appendChild(mk('span', '', T('settings.hotkeyVal')));
    pgSettings.appendChild(keyRow);

    var fileRow = mk('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:var(--qm-text-dim);');
    fileRow.appendChild(mk('span', 'flex:none;', T('settings.file')));
    fileRow.appendChild(mk('span', 'word-break:break-all;', T('settings.fileVal')));
    pgSettings.appendChild(fileRow);

    var resetBtn = mk('button', 'padding:5px 12px;border:1px solid var(--qm-danger);border-radius:7px;background:transparent;color:var(--qm-danger);cursor:pointer;font-size:11px;', T('settings.reset'));
    resetBtn.onclick = function () {
      try {
        localStorage.removeItem('__QMOD_CONFIG__');
        localStorage.removeItem('__QMOD_PRESETS__');
      } catch (e) {}
      status(T('settings.resetDone'));
    };
    pgSettings.appendChild(resetBtn);

    main.appendChild(content);
    panel.appendChild(main);

    // 底部
    var footer = mk('div', 'display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--qm-border);');
    var statusEl = mk('span', 'flex:1;min-width:0;color:var(--qm-ok);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
    statusEl.id = 'qm-status';
    var saveBtn = mk('button', 'padding:7px 18px;border:none;border-radius:8px;background:var(--qm-accent);color:#fff;font-weight:600;font-size:12px;cursor:pointer;flex:none;transition:background .18s ease, opacity .18s ease, transform .1s ease;', T('save'));
    saveBtn.id = 'qm-save';
    saveBtn.onclick = saveAll;
    footer.appendChild(statusEl);
    footer.appendChild(saveBtn);
    panel.appendChild(footer);

    // 拖拽与缩放
    var dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-no-drag]')) return;
      dragging = true;
      ox = e.clientX - panel.offsetLeft;
      oy = e.clientY - panel.offsetTop;
      e.preventDefault();
    });
    onBuild(document, 'mousemove', function (e) {
      if (!dragging) return;
      var nx = Math.min(Math.max(0, e.clientX - ox), window.innerWidth - 120);
      var ny = Math.min(Math.max(0, e.clientY - oy), window.innerHeight - 60);
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
    });
    onBuild(document, 'mouseup', function () {
      if (!dragging) return;
      dragging = false;
      try { localStorage.setItem('__QMOD_POS__', JSON.stringify({ x: panel.offsetLeft, y: panel.offsetTop })); } catch (e) {}
    });

    var handle = mk('div', 'position:absolute;right:3px;bottom:3px;width:16px;height:16px;cursor:nwse-resize;z-index:6;opacity:.7;');
    handle.id = 'qm-resize';
    handle.style.background = 'linear-gradient(135deg, transparent 38%, var(--qm-border) 38%, var(--qm-border) 48%, transparent 48%, transparent 62%, var(--qm-border) 62%, var(--qm-border) 72%, transparent 72%)';
    panel.appendChild(handle);
    var resizing = false, rw = 0, rh = 0, rx = 0, ry = 0;
    handle.addEventListener('mousedown', function (e) {
      resizing = true;
      rw = panel.offsetWidth;
      rh = panel.offsetHeight;
      rx = e.clientX;
      ry = e.clientY;
      e.preventDefault();
      e.stopPropagation();
    });
    onBuild(document, 'mousemove', function (e) {
      if (!resizing) return;
      var nw2 = Math.min(Math.max(720, rw + (e.clientX - rx)), window.innerWidth - 40);
      var nh = Math.min(Math.max(480, rh + (e.clientY - ry)), window.innerHeight - 40);
      panel.style.width = nw2 + 'px';
      panel.style.height = nh + 'px';
      panel.style.maxHeight = 'none';
    });
    onBuild(document, 'mouseup', function () {
      if (!resizing) return;
      resizing = false;
      try { localStorage.setItem('__QMOD_SIZE__', JSON.stringify({ w: panel.offsetWidth, h: panel.offsetHeight })); } catch (e) {}
    });

    modeSel.onchange = function () { draft.mode = modeSel.value; };
    ta.oninput = function () { draft.prompt = ta.value; renderCounter(); };
    ta.onchange = function () { draft.prompt = ta.value; renderCounter(); };

    document.body.appendChild(panel);

    applyTheme();
    loadDraft();
    syncFields();
    applyView();
    refreshDot();
  }

  function rebuildPanel() {
    closePanel();
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    dot = null;
    sectionRefs = {};
    navRefs = {};
    toastEl = null;
    closing = false;
    clearBuildListeners();
    buildPanel();
    openPanel();
    status(T('lang.changed'));
  }

  function syncFields() {
    if (!panel) return;
    panel.querySelector('#qm-mode').value = draft.mode;
    panel.querySelector('#qm-prompt').value = draft.prompt;
    panel.querySelector('#qm-theme').value = draft.theme;
    panel.querySelector('#qm-lang').value = draft.lang;
    panel.querySelector('#qm-view').value = viewState.mode;
    renderRules();
    renderPresets();
    renderCounter();
  }

  function applyView() {
    if (!panel) return;
    var tabbar = panel.querySelector('#qm-tabbar');
    var nav = panel.querySelector('#qm-nav');
    var ids = [];
    for (var s = 0; s < SECTIONS.length; s++) ids.push(SECTIONS[s][0]);
    var knownTab = false;
    for (var kk = 0; kk < ids.length; kk++) if (ids[kk] === viewState.tab) knownTab = true;
    if (!knownTab) viewState.tab = 'prompt';

    for (var n = 0; n < ids.length; n++) {
      var ref = sectionRefs[ids[n]];
      var item = navRefs[ids[n]];
      if (!ref) continue;
      var active = ids[n] === viewState.tab;
      var wasHidden = ref.card.style.display === 'none';
      if (viewState.mode === 'sidebar' || viewState.mode === 'tabs') {
        ref.head.style.display = 'none';
        ref.card.style.display = active ? 'block' : 'none';
        ref.content.style.display = 'block';
      } else {
        ref.head.style.display = 'flex';
        ref.card.style.display = 'block';
        ref.content.style.display = ref.open ? 'block' : 'none';
      }
      if (active && wasHidden) {
        ref.card.style.opacity = '0';
        (function (c) { requestAnimationFrame(function () { c.style.opacity = '1'; }); })(ref.card);
      }
      if (item) {
        item.style.background = active ? 'var(--qm-accent-soft)' : 'transparent';
        item.style.color = active ? 'var(--qm-accent)' : 'var(--qm-text-dim)';
        item.style.fontWeight = active ? '600' : '400';
      }
    }

    if (nav) nav.style.display = (viewState.mode === 'sidebar') ? 'block' : 'none';
    if (tabbar) tabbar.style.display = (viewState.mode === 'tabs') ? 'flex' : 'none';
    var tabs = panel.querySelectorAll('[data-viewtab]');
    for (var t = 0; t < tabs.length; t++) {
      var act = tabs[t].getAttribute('data-viewtab') === viewState.tab;
      tabs[t].style.color = act ? 'var(--qm-text)' : 'var(--qm-text-dim)';
      tabs[t].style.borderBottomColor = act ? 'var(--qm-accent)' : 'transparent';
    }
    if (viewState.tab === 'monitor') renderMonitor();
  }

  function renderRules() {
    if (!panel) return;
    var box = panel.querySelector('#qm-rule-list');
    if (!box) return;
    box.innerHTML = '';
    var list = window.__QMOD_RULES__ || [];
    for (var i = 0; i < list.length; i++) {
      (function (r) {
        var on = draft.rules.indexOf(r.id) >= 0;
        var row = mk('div', 'display:flex;align-items:flex-start;gap:10px;padding:8px 10px;margin-bottom:6px;border:1px solid ' +
          (on ? 'var(--qm-accent)' : 'var(--qm-border)') + ';border-radius:8px;background:' +
          (on ? 'var(--qm-accent-soft)' : 'var(--qm-bg-soft)') + ';cursor:pointer;box-sizing:border-box;');
        var mark = mk('div', 'flex:none;width:14px;height:14px;margin-top:2px;border-radius:4px;border:1px solid ' +
          (on ? 'var(--qm-accent)' : 'var(--qm-border)') + ';background:' +
          (on ? 'var(--qm-accent)' : 'transparent') + ';color:#fff;font-size:10px;line-height:14px;text-align:center;', on ? '✓' : '');
        var txt = mk('div', 'flex:1;min-width:0;');
        txt.appendChild(mk('div', 'font-size:12px;font-weight:600;color:' + (on ? 'var(--qm-accent)' : 'var(--qm-text)') + ';', r.name));
        txt.appendChild(mk('div', 'font-size:10.5px;color:var(--qm-text-dim);line-height:1.5;margin-top:2px;word-break:break-word;', r.text));
        row.appendChild(mark);
        row.appendChild(txt);
        row.onclick = function () {
          var idx = draft.rules.indexOf(r.id);
          if (idx >= 0) draft.rules.splice(idx, 1);
          else draft.rules.push(r.id);
          renderRules();
          renderCounter();
        };
        box.appendChild(row);
      })(list[i]);
    }
    var tip = panel.querySelector('#qm-rules-tip');
    if (tip) tip.textContent = T('rules.tip');
  }

  function loadPresets() {
    try {
      var list = JSON.parse(localStorage.getItem('__QMOD_PRESETS__') || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function savePresets(list) {
    try { localStorage.setItem('__QMOD_PRESETS__', JSON.stringify(list)); } catch (e) {}
  }

  function renderPresets() {
    if (!panel) return;
    var box = panel.querySelector('#qm-preset-list');
    if (!box) return;
    box.innerHTML = '';
    var list = loadPresets();
    if (!list.length) {
      box.appendChild(mk('div', 'color:var(--qm-text-dim);font-size:11px;padding:8px 0;', T('presets.empty')));
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function (p, idx) {
        var row = mk('div', 'display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--qm-border);border-radius:8px;background:var(--qm-bg-soft);box-sizing:border-box;');
        var nm = mk('div', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;', p.name + ' · ' + (p.rules ? p.rules.length : 0) + T('nav.rules'));
        var applyBtn = mk('button', 'padding:3px 10px;border:none;border-radius:6px;background:var(--qm-accent-soft);color:var(--qm-accent);cursor:pointer;font-size:11px;flex:none;', T('presets.apply'));
        applyBtn.onclick = function () {
          draft.prompt = p.prompt || '';
          draft.rules = (p.rules || []).slice();
          draft.mode = p.mode || 'append';
          draft.secResearch = !!p.secResearch;
          syncFields();
          status(fmt(T('presets.loaded'), { name: p.name }));
        };
        var delBtn = mk('button', 'padding:3px 10px;border:1px solid var(--qm-border);border-radius:6px;background:transparent;color:var(--qm-text-dim);cursor:pointer;font-size:11px;flex:none;', T('presets.delete'));
        delBtn.onclick = function () {
          var l2 = loadPresets();
          l2.splice(idx, 1);
          savePresets(l2);
          renderPresets();
        };
        row.appendChild(nm);
        row.appendChild(applyBtn);
        row.appendChild(delBtn);
        box.appendChild(row);
      })(list[i], i);
    }
  }

  function renderMonitor() {
    if (!panel) return;
    var info = panel.querySelector('#qm-monitor-info');
    var list = panel.querySelector('#qm-monitor-list');
    if (!info || !list) return;
    var stats = window.__QMOD_STATS__;
    if (!Array.isArray(stats)) {
      info.textContent = T('monitor.unsupported');
      list.innerHTML = '';
      return;
    }
    info.textContent = fmt(T('monitor.info'), { n: stats.length });
    list.innerHTML = '';
    if (!stats.length) {
      var mainState = window.__QMOD_MAIN_HOOK__;
      var msg = T('monitor.empty');
      if (mainState === 'ok') msg = T('monitor.emptyMain');
      else if (mainState === 'unavailable') msg = T('monitor.emptyNoMain');
      list.appendChild(mk('div', 'color:var(--qm-text-dim);padding:8px 0;line-height:1.7;', msg));
      return;
    }
    for (var i = 0; i < stats.length; i++) {
      (function (s) {
        var d = new Date(s.t);
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        var tm = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        var row = mk('div', 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:' + (s.patched ? 'var(--qm-accent-soft)' : 'var(--qm-bg-soft)') + ';box-sizing:border-box;');
        row.appendChild(mk('span', 'color:var(--qm-text-dim);flex:none;font-variant-numeric:tabular-nums;', tm));
        row.appendChild(mk('span', 'flex:none;font-size:10px;padding:1px 5px;border-radius:4px;border:1px solid var(--qm-border);color:var(--qm-text-dim);', s.source === 'main' ? T('monitor.src.main') : T('monitor.src.renderer')));
        row.appendChild(mk('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--qm-text);', s.url || '(unknown)'));
        row.appendChild(mk('span', 'flex:none;font-size:10px;color:' + (s.patched ? 'var(--qm-ok)' : 'var(--qm-text-dim)') + ';', s.patched ? fmt(T('monitor.patched'), { n: s.len }) : T('monitor.pass')));
        list.appendChild(row);
      })(stats[i]);
    }
  }

  function renderMainHookStatus() {
    if (!panel) return;
    var el = panel.querySelector('#qm-mainhook-status');
    if (!el) return;
    var s = window.__QMOD_MAIN_HOOK__;
    if (s === 'ok') {
      el.textContent = T('tool.mainHookOk');
      el.style.color = 'var(--qm-ok)';
    } else if (s === 'pending') {
      el.textContent = T('tool.mainHookPending');
      el.style.color = 'var(--qm-accent)';
    } else if (s === 'unavailable') {
      el.textContent = T('tool.mainHookOff');
      el.style.color = 'var(--qm-danger)';
    } else {
      el.textContent = T('tool.mainHookWait');
      el.style.color = 'var(--qm-text-dim)';
    }
  }

  function probeTool() {
    if (!panel) return;
    var st = panel.querySelector('#qm-tool-status');
    if (!st) return;
    if (typeof window.__QMOD_TOOL_CALL__ !== 'function') {
      st.textContent = T('tool.down');
      return;
    }
    st.textContent = T('tool.checking');
    window.__QMOD_TOOL_CALL__('__ping__', {}).then(function () {
      st.textContent = T('tool.ok');
    }, function () {
      st.textContent = T('tool.down');
    });
  }

  function renderCaptureInfo() {
    if (!panel) return;
    var el = panel.querySelector('#qm-capture-info');
    if (!el) return;
    var caps = window.__QMOD_CAPTURE__;
    el.textContent = fmt(T('tool.capture'), { n: Array.isArray(caps) ? caps.length : 0 });
  }

  function copyCapture() {
    var caps = window.__QMOD_CAPTURE__;
    if (!Array.isArray(caps) || !caps.length) {
      status(T('capture.none'));
      return;
    }
    var c = caps[0];
    var payload = {
      url: c.url,
      requestBody: String(c.req || '').slice(0, 40000),
      responseBody: String(c.resp || '').slice(0, 60000)
    };
    var text = JSON.stringify(payload, null, 2);
    try { console.log('[QMod] capture', payload); } catch (e) {}
    var done = function () { status(fmt(T('capture.copied'), { n: text.length })); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
    } catch (e) {
      fallbackCopy(text, done);
    }
  }

  var toastEl = null;
  var toastTimer = null;

  function toast(msg, kind) {
    if (!panel) return;
    if (!toastEl || !panel.contains(toastEl)) {
      toastEl = mk('div', 'position:absolute;left:50%;bottom:64px;transform:translate(-50%,8px);z-index:9;padding:8px 14px;border-radius:8px;font-size:12px;opacity:0;transition:opacity .18s ease, transform .18s ease;pointer-events:none;max-width:80%;text-align:center;box-shadow:0 6px 18px rgba(0,0,0,.25);');
      toastEl.id = 'qm-toast';
      panel.appendChild(toastEl);
    }
    toastEl.style.background = kind === 'error' ? 'var(--qm-danger)' : (kind === 'ok' ? 'var(--qm-ok)' : 'var(--qm-accent)');
    toastEl.style.color = '#fff';
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translate(-50%,0)';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) {
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translate(-50%,8px)';
      }
    }, 1800);
  }

  function saveAll() {
    var ncfg = {
      enabled: draft.enabled,
      mode: draft.mode,
      prompt: draft.prompt,
      rules: draft.rules.slice(),
      theme: draft.theme,
      secResearch: draft.secResearch,
      lang: draft.lang,
      debuglog: currentCfg().debuglog
    };
    var btn = panel ? panel.querySelector('#qm-save') : null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = T('saving');
      btn.style.opacity = '0.75';
    }
    toast(T('saving'), 'info');
    setTimeout(function () {
      if (window.__QMOD_SET_CONFIG__) window.__QMOD_SET_CONFIG__(ncfg);
      else window.__QMOD__ = ncfg;
      try { localStorage.setItem('__QMOD_CONFIG__', JSON.stringify(ncfg)); } catch (e) {}
      try { localStorage.setItem('__QMOD_SAVE__', JSON.stringify(ncfg)); } catch (e) {}
      refreshDot();
      renderCounter();
      status(T('saved'));
      if (btn) {
        btn.disabled = false;
        btn.textContent = '\u2713 ' + T('saved');
        btn.style.background = 'var(--qm-ok)';
        btn.style.opacity = '1';
      }
      toast(T('savedToast'), 'ok');
      try { console.log('%c[QMod]', 'color:#4fc3f7;font-weight:bold', 'config saved', ncfg); } catch (e) {}
      setTimeout(function () {
        closePanel();
        setTimeout(function () {
          if (btn) { btn.textContent = T('save'); btn.style.background = 'var(--qm-accent)'; btn.disabled = false; }
        }, 300);
      }, 750);
    }, 250);
  }

  function exportConfig() {
    var payload = {
      config: {
        prompt: draft.prompt, rules: draft.rules.slice(), mode: draft.mode, theme: draft.theme,
        secResearch: draft.secResearch, injectTool: draft.injectTool, forceTool: draft.forceTool, lang: draft.lang
      },
      presets: loadPresets()
    };
    var text = JSON.stringify(payload, null, 2);
    var done = function () { status(T('copy.ok')); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
    } catch (e) {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) {
      status(T('copy.fail'));
    }
  }

  function importConfig() {
    try {
      var text = window.prompt('Paste config JSON / 粘贴配置 JSON：');
      if (!text) return;
      var obj = JSON.parse(text);
      var cfg = obj.config || obj;
      if (cfg && typeof cfg === 'object') {
        if (typeof cfg.prompt === 'string') draft.prompt = cfg.prompt;
        if (Array.isArray(cfg.rules)) draft.rules = cfg.rules.slice();
        if (cfg.mode) draft.mode = cfg.mode;
        if (cfg.theme) draft.theme = cfg.theme;
        if (typeof cfg.secResearch === 'boolean') draft.secResearch = cfg.secResearch;
        if (typeof cfg.injectTool === 'boolean') draft.injectTool = cfg.injectTool;
        if (typeof cfg.forceTool === 'boolean') draft.forceTool = cfg.forceTool;
        if (cfg.lang) draft.lang = cfg.lang;
      }
      if (Array.isArray(obj.presets)) savePresets(obj.presets);
      syncFields();
      applyTheme();
      status(T('saved'));
    } catch (e) {
      status(T('copy.fail'));
    }
  }

  function refreshDot() {
    if (!dot) return;
    dot.style.background = draft.enabled ? 'var(--qm-ok)' : 'var(--qm-text-dim)';
  }

  var closing = false;

  function openPanel() {
    if (!panel) buildPanel();
    if (!panel) return;
    loadDraft();
    syncFields();
    applyTheme();
    applyView();
    closing = false;
    panel.style.display = 'flex';
    panel.style.left = Math.max(8, Math.round((window.innerWidth - panel.offsetWidth) / 2)) + 'px';
    panel.style.top = Math.max(8, Math.round((window.innerHeight - panel.offsetHeight) / 2)) + 'px';
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(6px) scale(.995)';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (panel) {
          panel.style.opacity = '1';
          panel.style.transform = 'translateY(0) scale(1)';
        }
      });
    });
  }

  function closePanel() {
    if (!panel || panel.style.display === 'none' || closing) return;
    closing = true;
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(6px) scale(.995)';
    setTimeout(function () {
      if (panel) {
        panel.style.display = 'none';
        panel.style.opacity = '1';
        panel.style.transform = 'none';
      }
      closing = false;
    }, 190);
  }

  function togglePanel() {
    if (isOpen()) closePanel();
    else openPanel();
  }

  function buildAppMenuEntry() {
    var menu = document.querySelector('nav[aria-label="应用菜单"]');
    if (!menu) return false;
    if (menu.querySelector('.qmod-appmenu-item')) return true;
    var btns = menu.querySelectorAll('button');
    var last = btns.length ? btns[btns.length - 1] : null;
    var el = document.createElement('button');
    if (last) {
      el.className = last.className + ' qmod-appmenu-item';
    } else {
      el.className = 'qmod-appmenu-item';
      el.style.cssText = 'background:transparent;border:none;cursor:pointer;padding:0 12px;height:28px;font-size:13px;';
    }
    el.textContent = 'QoderMod';
    el.title = T('title') + ' (Ctrl+Shift+M)';
    el.onclick = function (e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      togglePanel();
    };
    menu.appendChild(el);
    return true;
  }

  function buildStatusbarItem() {
    if (!document.body) return false;
    if (document.getElementById('qmod-status-item')) return true;
    var sb = document.querySelector('.statusbar');
    if (!sb) return false;
    var item = mk('div', 'display:flex;align-items:center;gap:5px;height:100%;padding:0 8px;cursor:pointer;background:transparent;');
    item.id = 'qmod-status-item';
    item.title = 'QoderMod (Ctrl+Shift+M)';
    var d = mk('span', 'font-size:9px;line-height:1;color:var(--qm-ok);', '●');
    var label = mk('span', 'font-size:11px;', 'QMod');
    item.appendChild(d);
    item.appendChild(label);
    item.onclick = togglePanel;
    (sb.querySelector('.right-items') || sb).appendChild(item);
    return true;
  }

  function buildMenubarItem() {
    if (!document.body) return false;
    if (document.querySelector('.qmod-menubar-item')) return true;
    var mb = document.querySelector('.menubar');
    if (!mb) return false;
    var mi = mk('div', 'display:flex;align-items:center;padding:0 8px;height:100%;cursor:pointer;font-size:12px;');
    mi.className = 'qmod-menubar-item';
    mi.textContent = 'QoderMod';
    mi.title = T('title') + ' (Ctrl+Shift+M)';
    mi.onclick = togglePanel;
    mb.appendChild(mi);
    return true;
  }

  function buildFallbackButton() {
    if (!document.body || btn) return;
    btn = mk('div', 'position:fixed;right:18px;bottom:18px;z-index:2147483646;display:none;align-items:center;gap:6px;padding:8px 12px;border-radius:18px;background:var(--qm-bg);color:var(--qm-text);border:1px solid var(--qm-border);cursor:pointer;font:12px/1 "Segoe UI",sans-serif;box-shadow:var(--qm-shadow);user-select:none;');
    btn.id = 'qmod-entry';
    btn.title = T('title') + ' (Ctrl+Shift+M)';
    var t1 = mk('span', 'font-weight:700;color:var(--qm-accent);', 'QMod');
    var t2 = mk('span', 'color:var(--qm-text-dim);', 'Settings');
    btn.appendChild(t1);
    btn.appendChild(t2);
    btn.onclick = togglePanel;
    document.body.appendChild(btn);
  }

  function ensureEntries() {
    var integrated = false;
    if (buildAppMenuEntry()) integrated = true;
    if (buildMenubarItem()) integrated = true;
    if (buildStatusbarItem()) integrated = true;
    if (btn) btn.style.display = integrated ? 'none' : 'flex';
  }

  function init() {
    if (!document.body) return false;
    loadDraft();
    buildPanel();
    buildFallbackButton();
    ensureEntries();
    applyTheme();
    return true;
  }

  on(document, 'keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
      e.preventDefault();
      togglePanel();
    } else if (e.key === 'Escape' && isOpen()) {
      closePanel();
    }
  });

  if (!init()) {
    var timer = setInterval(function () {
      if (init()) clearInterval(timer);
    }, 500);
    intervals.push(timer);
  }

  intervals.push(setInterval(function () {
    if (!document.body) return;
    if (!panel) buildPanel();
    else if (!document.body.contains(panel)) document.body.appendChild(panel);
    if (!btn) buildFallbackButton();
    else if (!document.body.contains(btn)) document.body.appendChild(btn);
    ensureEntries();
  }, 1500));

  window.__QMOD_UI_TEARDOWN__ = function () {
    try {
      for (var i = 0; i < intervals.length; i++) clearInterval(intervals[i]);
      intervals.length = 0;
      for (var j = 0; j < listeners.length; j++) {
        try { listeners[j][0].removeEventListener(listeners[j][1], listeners[j][2]); } catch (e) {}
      }
      listeners.length = 0;
      clearBuildListeners();
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
      var si = document.getElementById('qmod-status-item');
      if (si && si.parentNode) si.parentNode.removeChild(si);
      var items = document.querySelectorAll('.qmod-appmenu-item,.qmod-menubar-item');
      for (var k = 0; k < items.length; k++) {
        if (items[k].parentNode) items[k].parentNode.removeChild(items[k]);
      }
    } catch (e) {}
    panel = null;
    btn = null;
    dot = null;
    sectionRefs = {};
    navRefs = {};
    window.__QMOD_UI__ = false;
  };
})();
