/**
 * LCDM / CCBⅡ interactive display
 *
 * A dependency-free controller for the hardware demo:
 * - draft configuration is previewed immediately and committed with F1
 * - soft-key definitions are rendered per screen context
 * - backlight and self-test controls update independently of the config draft
 */
(() => {
  "use strict";

  /* =========================================================
     State
     ========================================================= */

  const DEFAULT_CONFIG = Object.freeze({
    end: "lead",
    pipe: "in",
    mode: "freight",
    feed: "on",
  });

  const DEFAULT_LIGHT = Object.freeze({
    level: 82,
    auto: true,
    ambient: 400,
  });

  const saved = { ...DEFAULT_CONFIG };
  const draft = { ...DEFAULT_CONFIG };
  const light = { ...DEFAULT_LIGHT };

  const ui = {
    page: "main",
    diagTab: "fault",
    lastSelfTest: new Date(Date.now() - 7 * 60 * 1000),
  };

  const options = {
    end: ["lead", "helper"],
    pipe: ["in", "out"],
    mode: ["freight", "passenger"],
    feed: ["on", "off"],
  };

  const labels = {
    end: {
      lead: { short: "本务", long: "本务 · 操纵端", sub: "操纵端" },
      helper: { short: "补机", long: "补机 · 非操纵端", sub: "非操纵端" },
    },
    pipe: {
      in: { short: "投入", sub: "TRAIN PIPE" },
      out: { short: "切除", sub: "TRAIN PIPE" },
    },
    mode: {
      freight: { short: "货车", sub: "FREIGHT" },
      passenger: { short: "客车", sub: "PASSENGER" },
    },
    feed: {
      on: { short: "补风", sub: "FEED ON" },
      off: { short: "不补风", sub: "FEED OFF" },
    },
  };

  const fieldTitles = {
    end: "操纵端",
    pipe: "列车管",
    mode: "行车制式",
    feed: "补风模式",
  };

  const pageMeta = {
    main: { title: "主界面", en: "MAIN" },
    settings: { title: "电空制动", en: "EP BRAKE" },
    diagnostics: { title: "查询中心", en: "DIAG" },
  };

  const state = {
    logs: [],
    toastTimer: null,
    hudTimer: null,
    selfTestTimer: null,
  };

  /* =========================================================
     DOM
     ========================================================= */

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  const dom = {
    screen: $("#screen"),
    screenPageTitle: $("#screenPageTitle"),
    screenDate: $("#screenDate"),
    screenClock: $("#screenClock"),
    screenAuto: $("#screenAuto"),
    screenSoftkeys: $("#screenSoftkeys"),
    pages: $$("[data-screen-page]"),
    physicalKeys: $$(".softkey"),
    tickerEnd: $("#tickerEnd"),
    tickerMode: $("#tickerMode"),
    tickerFeed: $("#tickerFeed"),
    tickerPipe: $("#tickerPipe"),
    tickerPending: $("#tickerPending"),
    tickerPendingCount: $("#tickerPendingCount"),
    mainHint: $("#mainHint"),
    mainMessage: $("#mainMessage"),
    mainMessageTime: $("#mainMessageTime"),
    pendingCard: $("#pendingCard"),
    pendingCount: $("#pendingCount"),
    sideEnd: $("#sideEnd"),
    sidePipe: $("#sidePipe"),
    sideMode: $("#sideMode"),
    sideFeed: $("#sideFeed"),
    sideBright: $("#sideBright"),
    logList: $("#logList"),
    recordsList: $("#recordsList"),
    settingsSync: $("[data-settings-sync]"),
    settingStates: $$("[data-dirty-for]"),
    settingOptions: $$("[data-option]"),
    diagTabs: $$("[data-diag-tab]"),
    diagPanels: $$("[data-diag-panel]"),
    lastSelfTest: $("#lastSelfTest"),
    selftestSummary: $("#selftestSummary"),
    selftestScore: $("#selftestScore"),
    selftestScoreLabel: $("#selftestScoreLabel"),
    selftestCopyTitle: $("#selftestCopyTitle"),
    selftestCopyText: $("#selftestCopyText"),
    selftestBadge: $("#selftestBadge"),
    selftestNote: $("#selftestNote"),
    recordsTabMeta: $("#recordsTabMeta"),
    autoLed: $("#autoLed"),
    autoCardState: $("#autoCardState"),
    brightnessValue: $("#brightnessValue"),
    brightnessBar: $("#brightnessBar"),
    brightnessModeLabel: $("#brightnessModeLabel"),
    brightnessModeText: $("#brightnessModeText"),
    brightnessLamp: $("#brightnessLamp"),
    brightnessHud: $("#brightnessHud"),
    brightnessHudMode: $("#brightnessHudMode"),
    brightnessHudBar: $("#brightnessHudBar"),
    brightnessHudValue: $("#brightnessHudValue"),
    backlightKeys: $$("[data-backlight]"),
    toast: $("#toast"),
    toastTitle: $("#toastTitle"),
    toastText: $("#toastText"),
    resetButton: $("#resetButton"),
    saveChanges: $("[data-save-changes]"),
    functionCards: $$("[data-function-card]"),
  };

  /* =========================================================
     Utility
     ========================================================= */

  const pad = (value) => String(value).padStart(2, "0");

  const timeText = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function pendingKeys() {
    return Object.keys(DEFAULT_CONFIG).filter((key) => draft[key] !== saved[key]);
  }

  function isDirty(key) {
    return draft[key] !== saved[key];
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function shortValue(key, value = draft[key]) {
    return labels[key][value].short;
  }

  /* =========================================================
     Logging
     ========================================================= */

  function addLog(text, kind = "EVENT") {
    state.logs.unshift({
      time: new Date(),
      text,
      kind,
    });
    state.logs = state.logs.slice(0, 30);
    renderLogs();
  }

  function renderLogs() {
    const visibleLogs = state.logs.slice(0, 5);
    dom.logList.innerHTML = visibleLogs.length
      ? visibleLogs
          .map(
            (entry, index) => `
              <li class="${index === 0 ? "is-new" : ""} ${entry.kind === "WARN" ? "is-warn" : ""}">
                <time>${timeText(entry.time)}</time>
                <span>${escapeHTML(entry.text)}</span>
              </li>`
          )
          .join("")
      : `<li><time>--:--</time><span>暂无操作记录</span></li>`;

    const records = state.logs.slice(0, 5);
    dom.recordsList.innerHTML = records.length
      ? records
          .map(
            (entry) => `
              <div class="record-row">
                <time>${timeText(entry.time)}</time>
                <span>${escapeHTML(entry.text)}</span>
                <b>${escapeHTML(entry.kind)}</b>
              </div>`
          )
          .join("")
      : `<div class="record-row"><time>--:--</time><span>暂无记录</span><b>EMPTY</b></div>`;

    if (dom.recordsTabMeta) {
      dom.recordsTabMeta.textContent = `${String(state.logs.length).padStart(2, "0")} EVENTS`;
    }
  }

  /* =========================================================
     Render · config
     ========================================================= */

  function renderState() {
    const dirty = pendingKeys();
    const dirtyCount = dirty.length;
    const end = labels.end[draft.end];
    const mode = labels.mode[draft.mode];
    const feed = labels.feed[draft.feed];
    const pipe = labels.pipe[draft.pipe];

    dom.tickerEnd.textContent = end.long;
    dom.tickerMode.textContent = mode.short;
    dom.tickerFeed.textContent = feed.short;
    dom.tickerPipe.textContent = pipe.short;
    dom.tickerPending.hidden = dirtyCount === 0;
    dom.tickerPendingCount.textContent = String(dirtyCount);

    dom.mainHint.classList.toggle("is-pending", dirtyCount > 0);
    dom.mainHint.innerHTML = dirtyCount
      ? `<svg aria-hidden="true"><use href="#i-alert"></use></svg><span>${dirtyCount} 项修改待确认 · 按 F1 保存生效</span>`
      : `<svg aria-hidden="true"><use href="#i-info"></use></svg><span>F4–F7 修改配置，F1 保存生效</span>`;

    if (dom.mainMessage) {
      const now = new Date();
      dom.mainMessageTime.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (dirtyCount) {
        const first = dirty[0];
        dom.mainMessage.textContent = `${dirtyCount} 项修改待确认：${fieldTitles[first]}已选为 ${shortValue(first)}，按 F1 写入运行配置。`;
      } else if (draft.pipe === "out") {
        dom.mainMessage.textContent = "列车管已切除，压力通路隔离；请确认运行条件后按 F1 生效。";
      } else {
        dom.mainMessage.textContent = "列车管压力稳定，制动系统处于缓解状态。";
      }
    }

    dom.pendingCard.hidden = dirtyCount === 0;
    dom.pendingCount.textContent = `${dirtyCount} 项`;

    renderSideStatus(dom.sideEnd, end.short, dirty.includes("end"), end.sub);
    renderSideStatus(dom.sidePipe, pipe.short, dirty.includes("pipe"), pipe.sub);
    renderSideStatus(dom.sideMode, mode.short, dirty.includes("mode"), mode.sub);
    renderSideStatus(dom.sideFeed, feed.short, dirty.includes("feed"), feed.sub);

    renderGauges();
    renderSettings(dirty);
    renderPage();
    renderSoftkeys();
    renderPhysicalKeyStates();
  }

  function renderSideStatus(target, value, dirty, subtitle) {
    if (!target) return;
    target.classList.toggle("is-pending", Boolean(dirty));
    target.innerHTML = `<b>${escapeHTML(value)}</b><small>${escapeHTML(dirty ? "待确认" : subtitle)}</small>`;
  }

  function renderGauges() {
    const bp = draft.pipe === "in" ? 600 : 0;
    const bc = 0;
    const er = 600;

    setGauge("bp", bp, 1000, draft.pipe === "in" ? "正常" : "已切除", draft.pipe === "in");
    setGauge("bc", bc, 600, "缓解", true);
    setGauge("er", er, 1000, "正常", true);
  }

  function setGauge(name, value, max, status, good) {
    const gauge = document.querySelector(`[data-gauge="${name}"]`);
    if (!gauge) return;
    const valueNode = $("[data-gauge-value]", gauge);
    const stateNode = $("[data-gauge-state]", gauge);
    const needle = $("[data-needle]", gauge);
    const angle = -90 + (value / max) * 180;

    valueNode.textContent = String(value);
    stateNode.textContent = status;
    stateNode.classList.toggle("is-good", Boolean(good));
    stateNode.classList.toggle("is-warn", !good);
    needle.style.setProperty("--angle", `${angle}deg`);
  }

  function renderSettings(dirty) {
    Object.keys(options).forEach((key) => {
      const row = document.querySelector(`[data-setting="${key}"]`);
      if (row) row.classList.toggle("is-dirty", dirty.includes(key));
      dom.settingOptions
        .filter((button) => button.dataset.option === key)
        .forEach((button) => {
          button.classList.toggle("is-selected", button.dataset.value === draft[key]);
          button.setAttribute("aria-pressed", String(button.dataset.value === draft[key]));
        });
    });

    dom.settingStates.forEach((node) => {
      const key = node.dataset.dirtyFor;
      node.textContent = dirty.includes(key) ? "待确认" : "已同步";
    });

    const count = 4 - dirty.length;
    if (dirty.length) {
      dom.settingsSync.textContent = `${dirty.length} 项待保存`;
    } else {
      dom.settingsSync.textContent = `${count} / 4 已同步`;
    }
    dom.settingsSync.classList.toggle("is-pending", dirty.length > 0);
  }

  function renderPage() {
    dom.pages.forEach((page) => {
      page.classList.toggle("is-active", page.dataset.screenPage === ui.page);
    });
    const meta = pageMeta[ui.page];
    dom.screenPageTitle.innerHTML = `${meta.title} <span>${meta.en}</span>`;

    dom.diagTabs.forEach((tab) => {
      const active = tab.dataset.diagTab === ui.diagTab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    dom.diagPanels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.diagPanel === ui.diagTab);
    });
  }

  /* =========================================================
     Render · soft keys
     ========================================================= */

  function statusMeta(key) {
    return `${shortValue(key)}${isDirty(key) ? " · 待确认" : ""}`;
  }

  function buildSoftkeys() {
    const dirty = pendingKeys();
    const pending = dirty.length;

    if (ui.page === "settings") {
      return [
        { label: "保存生效", meta: pending ? `${pending} 项待保存` : "已全部同步", tone: pending ? "is-amber" : "is-green", active: pending > 0 },
        { label: "返回主界面", meta: pending ? "放弃修改" : "主界面", tone: "", active: false },
        { label: "电空设置", meta: "当前页面", tone: "is-blue", active: true },
        { label: "端位切换", meta: statusMeta("end"), tone: isDirty("end") ? "is-amber" : "" },
        { label: "列车管", meta: statusMeta("pipe"), tone: isDirty("pipe") ? "is-amber" : "" },
        { label: "货车 / 客车", meta: statusMeta("mode"), tone: isDirty("mode") ? "is-amber" : "" },
        { label: "补风 / 不补风", meta: statusMeta("feed"), tone: isDirty("feed") ? "is-amber" : "" },
        { label: "查询中心", meta: "故障·记录·标定·自检", tone: "is-amber", active: false },
      ];
    }

    if (ui.page === "diagnostics") {
      const faultActive = ui.diagTab === "fault";
      return [
        { label: "刷新自检", meta: "重新检测", tone: "is-green", active: false },
        { label: "返回主界面", meta: "退出查询", tone: "", active: false },
        { label: "故障记录", meta: "0 ACTIVE", tone: "is-amber", active: faultActive },
        { label: "运行记录", meta: `${String(state.logs.length).padStart(2, "0")} EVENTS`, tone: "", active: ui.diagTab === "records" },
        { label: "标定参数", meta: "4 SENSORS", tone: "", active: ui.diagTab === "calibration" },
        { label: "自检结果", meta: "5 CHECKS", tone: "", active: ui.diagTab === "selftest" },
        { label: "电空设置", meta: "运行配置", tone: "is-blue", active: false },
        { label: "查询中心", meta: "当前页面", tone: "is-amber", active: true },
      ];
    }

    return [
      { label: "确认 / 执行", meta: pending ? `${pending} 项待保存` : "执行并保存", tone: pending ? "is-amber" : "is-green", active: pending > 0 },
      { label: "退出 / 返回", meta: pending ? "放弃修改" : "主界面", tone: "", active: false },
      { label: "电空制动", meta: "设置菜单", tone: "is-blue", active: false },
      { label: "操纵端切换", meta: statusMeta("end"), tone: isDirty("end") ? "is-amber" : "" },
      { label: "列车管投切", meta: statusMeta("pipe"), tone: isDirty("pipe") ? "is-amber" : "" },
      { label: "货车 / 客车", meta: statusMeta("mode"), tone: isDirty("mode") ? "is-amber" : "" },
      { label: "补风 / 不补风", meta: statusMeta("feed"), tone: isDirty("feed") ? "is-amber" : "" },
      { label: "查询中心", meta: "故障·记录·标定·自检", tone: "is-amber", active: false },
    ];
  }

  function renderSoftkeys() {
    const keys = buildSoftkeys();
    dom.screenSoftkeys.innerHTML = keys
      .map(
        (key, index) => `
          <button type="button" class="screen-key ${key.tone || ""} ${key.active ? "is-active" : ""}" data-screen-key="${index + 1}" aria-label="F${index + 1} ${escapeHTML(key.label)}">
            <span class="screen-key__top"><b>F${index + 1}</b><i></i></span>
            <span class="screen-key__title">${escapeHTML(key.label)}</span>
            <span class="screen-key__meta">${escapeHTML(key.meta)}</span>
          </button>`
      )
      .join("");
    dom.screenSoftkeys.dataset.page = ui.page;
  }

  function renderPhysicalKeyStates() {
    const keys = buildSoftkeys();
    dom.physicalKeys.forEach((button, index) => {
      const key = keys[index];
      button.classList.toggle("is-contextual", Boolean(key && key.active));
      button.setAttribute("aria-label", `F${index + 1} ${key ? key.label : ""}`);
    });
  }

  /* =========================================================
     Brightness
     ========================================================= */

  function autoBrightness(ambient = light.ambient) {
    const level = 50 + Math.log2(Math.max(ambient, 1) / 25) * 8;
    return Math.round(clamp(level, 36, 96));
  }

  function renderBrightness(showHud = false) {
    const level = Math.round(light.level);
    dom.screen.style.setProperty("--brightness", String(level));
    dom.brightnessValue.innerHTML = `${level}<small>%</small>`;
    dom.brightnessBar.style.width = `${level}%`;
    dom.brightnessModeLabel.textContent = light.auto ? "AUTO MODE" : "MANUAL MODE";
    dom.brightnessModeText.textContent = light.auto
      ? `自动 · 环境光 ${light.ambient} lx`
      : "手动 · 按键调节";
    dom.brightnessLamp.style.setProperty("--lamp-level", String(level / 100));
    dom.autoLed.classList.toggle("is-on", light.auto);
    dom.screenAuto.classList.toggle("is-on", light.auto);
    dom.autoCardState.textContent = light.auto ? "ON" : "OFF";
    dom.sideBright.classList.remove("is-pending");
    dom.sideBright.innerHTML = `<b>${level}%</b><small>${light.auto ? "自动" : "手动"}</small>`;
    $$("[data-backlight='auto']").forEach((button) => button.classList.toggle("is-active", light.auto));
    dom.brightnessHudMode.textContent = light.auto ? "AUTO" : "MANUAL";
    dom.brightnessHudBar.style.width = `${level}%`;
    dom.brightnessHudValue.textContent = `${level}%`;
    if (showHud) showBrightnessHud();
  }

  function showBrightnessHud() {
    clearTimeout(state.hudTimer);
    dom.brightnessHud.classList.add("is-visible");
    dom.brightnessHud.setAttribute("aria-hidden", "false");
    state.hudTimer = setTimeout(() => {
      dom.brightnessHud.classList.remove("is-visible");
      dom.brightnessHud.setAttribute("aria-hidden", "true");
    }, 1600);
  }

  function handleBacklight(action) {
    const button = document.querySelector(`[data-backlight="${action}"]`);
    if (button) {
      button.classList.add("is-pressed");
      setTimeout(() => button.classList.remove("is-pressed"), 140);
    }

    if (action === "up" || action === "down") {
      const wasAuto = light.auto;
      light.auto = false;
      light.level = clamp(light.level + (action === "up" ? 10 : -10), 20, 100);
      renderBrightness(true);
      addLog(`屏幕背光${action === "up" ? "增亮" : "减亮"}至 ${light.level}%`, "DIM");
      if (wasAuto) {
        showToast("已切换为手动背光", `当前亮度 ${light.level}% · 自动亮度已退出`);
      }
      return;
    }

    if (action === "auto") {
      light.auto = !light.auto;
      if (light.auto) {
        light.level = autoBrightness();
        addLog(`自动背光开启 · ${light.level}%`, "DIM");
        showToast("自动亮度已开启", `按环境光 ${light.ambient} lx 匹配 · 当前 ${light.level}%`);
      } else {
        addLog(`自动背光关闭 · 保持 ${light.level}%`, "DIM");
        showToast("自动亮度已关闭", `保持当前 ${light.level}% · 可使用增亮 / 减亮键调节`);
      }
      renderBrightness(true);
    }
  }

  /* =========================================================
     Toast
     ========================================================= */

  function showToast(title, message) {
    clearTimeout(state.toastTimer);
    dom.toast.classList.remove("is-visible");
    dom.toastTitle.textContent = title;
    dom.toastText.textContent = message;
    // Restart the progress animation even when a toast is already visible.
    void dom.toast.offsetWidth;
    dom.toast.classList.add("is-visible");
    state.toastTimer = setTimeout(() => {
      dom.toast.classList.remove("is-visible");
    }, 3200);
  }

  /* =========================================================
     Configuration actions
     ========================================================= */

  function setOption(key, value) {
    if (!options[key] || !options[key].includes(value) || draft[key] === value) return;
    draft[key] = value;
    renderState();
    addLog(`调整待确认：${fieldTitles[key]} → ${labels[key][value].short}`, "CFG");
    showToast(`${fieldTitles[key]}已选择 ${labels[key][value].short}`, "尚未生效 · 按 F1 保存，或按 F2 放弃");
  }

  function toggleOption(key) {
    const values = options[key];
    const index = values.indexOf(draft[key]);
    setOption(key, values[(index + 1) % values.length]);
  }

  function applyChanges() {
    const pending = pendingKeys();
    if (!pending.length) {
      addLog("执行状态确认 · 当前配置无需保存", "CFG");
      showToast("系统已确认", "当前运行配置已同步，没有待保存项");
      return;
    }

    const summary = pending
      .map((key) => `${fieldTitles[key]} ${labels[key][draft[key]].short}`)
      .join(" · ");

    pending.forEach((key) => {
      saved[key] = draft[key];
    });
    renderState();
    addLog(`参数已保存：${summary}`, "SAVE");
    showToast("参数已保存并生效", summary);
  }

  function discardChanges(reason = "未保存修改已撤销") {
    const hadChanges = pendingKeys().length > 0;
    Object.assign(draft, saved);
    renderState();
    if (hadChanges) {
      addLog(`放弃修改 · ${reason}`, "WARN");
    }
    return hadChanges;
  }

  function goMain({ discard = false, notify = true } = {}) {
    const hadChanges = pendingKeys().length > 0;
    if (discard && hadChanges) {
      discardChanges("返回主界面时放弃");
    }
    ui.page = "main";
    renderState();
    if (notify) {
      if (discard && hadChanges) {
        showToast("已返回主界面", "未保存的修改已撤销");
      } else if (!discard) {
        showToast("已返回主界面", hadChanges ? "待确认修改仍保留 · 可按 F1 保存" : "可继续使用 F1–F8 操作");
      } else {
        showToast("已在主界面", "当前配置已同步");
      }
    }
  }

  function openSettings() {
    if (ui.page === "settings") {
      showToast("当前已在电空制动设置", "使用 F4–F7 调整，F1 保存生效");
      return;
    }
    ui.page = "settings";
    renderState();
    addLog("进入电空制动设置菜单", "NAV");
    showToast("电空制动设置", "F4–F7 选择参数，F1 保存，F2 返回");
  }

  function openDiagnostics(activeTab) {
    if (ui.page === "diagnostics" && (!activeTab || activeTab === ui.diagTab)) {
      showToast("当前已在查询中心", "F3–F6 切换故障、记录、标定与自检");
      return;
    }
    if (activeTab) ui.diagTab = activeTab;
    ui.page = "diagnostics";
    renderState();
    addLog(`进入查询中心 · ${diagTabName(ui.diagTab)}`, "NAV");
    showToast("查询中心", "故障 · 运行记录 · 标定参数 · 自检结果");
  }

  function diagTabName(tab) {
    return {
      fault: "故障记录",
      records: "运行记录",
      calibration: "标定参数",
      selftest: "自检结果",
    }[tab] || "查询";
  }

  function setDiagTab(tab) {
    if (!tab) return;
    ui.diagTab = tab;
    renderState();
    addLog(`查询切换：${diagTabName(tab)}`, "NAV");
  }

  function renderSelfTestSummary(testing) {
    if (!dom.selftestSummary) return;

    dom.selftestSummary.classList.toggle("is-testing", testing);
    dom.selftestScore.innerHTML = testing ? "—<small>/5</small>" : "5<small>/5</small>";
    dom.selftestScoreLabel.textContent = testing ? "检查中" : "检查通过";
    dom.selftestCopyTitle.textContent = testing ? "正在执行系统自检" : "系统自检全部通过";
    dom.selftestCopyText.textContent = testing
      ? "正在逐项检测主控制器、通信总线、压力传感器、显示单元与电源模块，请保持系统静止。"
      : "主控制器、通信总线、压力传感器、显示单元与电源模块状态正常。";
    dom.selftestBadge.textContent = testing ? "TESTING" : "ALL PASS";
    dom.selftestNote.textContent = testing
      ? "自检进行中 · 完成后自动更新结果"
      : "5 项检查全部通过 · 按 F1 可重新执行自检";
  }

  function refreshSelfTest() {
    if (state.selfTestTimer) {
      clearTimeout(state.selfTestTimer);
    }

    // F1 remains the "refresh self-test" key on every diagnostics tab, so
    // bring the check list forward instead of running it out of sight.
    if (ui.diagTab !== "selftest") {
      ui.diagTab = "selftest";
      renderState();
    }

    renderSelfTestSummary(true);
    const checks = $$(".check");
    checks.forEach((check) => {
      check.classList.remove("is-pass");
      check.classList.add("is-checking");
      $("em", check).textContent = "CHECK";
    });
    showToast("正在执行自检", "主控制器 · 通信 · 传感器 · 显示 · 电源");

    state.selfTestTimer = setTimeout(() => {
      checks.forEach((check) => {
        check.classList.remove("is-checking");
        check.classList.add("is-pass");
        $("em", check).textContent = "PASS";
      });
      renderSelfTestSummary(false);
      ui.lastSelfTest = new Date();
      renderSelfTestTime();
      addLog("系统自检完成 · 5 项全部通过", "TEST");
      showToast("自检完成", "5 项检查全部通过 · 系统状态正常");
      state.selfTestTimer = null;
    }, 1200);
  }

  function renderSelfTestTime() {
    dom.lastSelfTest.textContent = timeText(ui.lastSelfTest);
  }

  /* =========================================================
     Soft key dispatch
     ========================================================= */

  function handleSoftKey(number) {
    animateKey(number);

    if (ui.page === "diagnostics") {
      if (number === 1) return refreshSelfTest();
      if (number === 2) return goMain({ discard: false });
      if (number === 3) return setDiagTab("fault");
      if (number === 4) return setDiagTab("records");
      if (number === 5) return setDiagTab("calibration");
      if (number === 6) return setDiagTab("selftest");
      if (number === 7) return openSettings();
      if (number === 8) return showToast("当前已在查询中心", "按 F2 返回主界面");
      return;
    }

    if (ui.page === "settings") {
      if (number === 1) return applyChanges();
      if (number === 2) return goMain({ discard: true });
      if (number === 3) return showToast("当前已在电空制动设置", "使用 F4–F7 调整，F1 保存生效");
      if (number === 4) return toggleOption("end");
      if (number === 5) return toggleOption("pipe");
      if (number === 6) return toggleOption("mode");
      if (number === 7) return toggleOption("feed");
      if (number === 8) return openDiagnostics();
      return;
    }

    switch (number) {
      case 1:
        return applyChanges();
      case 2:
        if (pendingKeys().length) return goMain({ discard: true });
        return showToast("已在主界面", "屏幕底栏可查看当前按键功能");
      case 3:
        return openSettings();
      case 4:
        return toggleOption("end");
      case 5:
        return toggleOption("pipe");
      case 6:
        return toggleOption("mode");
      case 7:
        return toggleOption("feed");
      case 8:
        return openDiagnostics();
      default:
        return undefined;
    }
  }

  function animateKey(number) {
    const button = dom.physicalKeys[number - 1];
    if (!button) return;
    button.classList.add("is-pressed");
    setTimeout(() => button.classList.remove("is-pressed"), 150);
  }

  function runFunctionFromCard(number) {
    // Cards always describe the main-screen definition. Quick switches on the
    // settings page bring the user back to the main screen for visual feedback.
    switch (number) {
      case 1:
        applyChanges();
        break;
      case 2:
        goMain({ discard: true });
        break;
      case 3:
        openSettings();
        break;
      case 4:
        toggleOption("end");
        break;
      case 5:
        toggleOption("pipe");
        break;
      case 6:
        toggleOption("mode");
        break;
      case 7:
        toggleOption("feed");
        break;
      case 8:
        openDiagnostics();
        break;
      default:
        break;
    }

    if ([4, 5, 6, 7].includes(number) && ui.page !== "main") {
      ui.page = "main";
      renderState();
    }

    animateKey(number);
    scrollConsoleIntoView();
  }

  function scrollConsoleIntoView() {
    const consoleElement = $("#console");
    if (!consoleElement) return;
    const rect = consoleElement.getBoundingClientRect();
    const visible = rect.top < window.innerHeight * 0.82 && rect.bottom > window.innerHeight * 0.18;
    if (!visible) {
      consoleElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /* =========================================================
     Clock
     ========================================================= */

  function updateClock() {
    const now = new Date();
    dom.screenDate.textContent = `${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
    dom.screenClock.textContent = timeText(now);
    dom.screenClock.setAttribute("datetime", now.toISOString());
  }

  /* =========================================================
     Initial logs
     ========================================================= */

  function seedLogs() {
    const now = new Date();
    state.logs = [
      { time: new Date(now.getTime() - 60 * 1000), text: "已进入 CCBⅡ 主界面 · 系统待命", kind: "SYSTEM" },
      { time: new Date(now.getTime() - 7 * 60 * 1000), text: "系统自检完成 · 5 项全部通过", kind: "TEST" },
    ];
    ui.lastSelfTest = new Date(now.getTime() - 7 * 60 * 1000);
    renderLogs();
    renderSelfTestTime();
  }

  /* =========================================================
     Reset
     ========================================================= */

  function resetDemo() {
    Object.assign(saved, DEFAULT_CONFIG);
    Object.assign(draft, DEFAULT_CONFIG);
    Object.assign(light, DEFAULT_LIGHT);
    ui.page = "main";
    ui.diagTab = "fault";
    if (state.selfTestTimer) {
      clearTimeout(state.selfTestTimer);
      state.selfTestTimer = null;
    }
    $$(".check").forEach((check) => {
      check.classList.remove("is-checking");
      check.classList.add("is-pass");
      const status = $("em", check);
      if (status) status.textContent = "PASS";
    });
    renderSelfTestSummary(false);
    seedLogs();
    renderState();
    renderBrightness();
    updateClock();
    addLog("演示状态已重置", "SYSTEM");
    showToast("演示已重置", "已恢复 CCBⅡ 主界面与默认运行配置");
  }

  /* =========================================================
     Events
     ========================================================= */

  // Physical function keys F1–F8
  dom.physicalKeys.forEach((button) => {
    button.addEventListener("click", () => handleSoftKey(Number(button.dataset.key)));
  });

  // On-screen legend keys
  dom.screenSoftkeys.addEventListener("click", (event) => {
    const key = event.target.closest("[data-screen-key]");
    if (!key) return;
    handleSoftKey(Number(key.dataset.screenKey));
  });

  // Backlight keys
  dom.backlightKeys.forEach((button) => {
    button.addEventListener("click", () => handleBacklight(button.dataset.backlight));
  });

  // Settings segmented controls
  dom.settingOptions.forEach((button) => {
    button.addEventListener("click", () => setOption(button.dataset.option, button.dataset.value));
  });

  // Diagnostic tabs
  dom.diagTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.diagTab === ui.diagTab) return;
      setDiagTab(tab.dataset.diagTab);
    });
  });

  // Function cards
  dom.functionCards.forEach((card) => {
    card.addEventListener("click", () => runFunctionFromCard(Number(card.dataset.functionCard)));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      runFunctionFromCard(Number(card.dataset.functionCard));
    });
  });

  // Side save button
  if (dom.saveChanges) {
    dom.saveChanges.addEventListener("click", () => applyChanges());
  }

  // Reset
  dom.resetButton.addEventListener("click", resetDemo);

  // Keyboard F1–F8 + Escape
  window.addEventListener(
    "keydown",
    (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || event.target?.isContentEditable) return;

      if (event.key === "Escape") {
        event.preventDefault();
        handleSoftKey(2);
        return;
      }

      const match = /^F([1-8])$/.exec(event.key);
      if (!match) return;
      event.preventDefault();
      handleSoftKey(Number(match[1]));
    },
    { passive: false }
  );

  // Nav scroll spy
  const navLinks = $$(".topnav a");
  const navSections = navLinks
    .map((link) => {
      const id = link.getAttribute("href");
      return { link, section: id && id.startsWith("#") ? document.querySelector(id) : null };
    })
    .filter((item) => item.section);

  if ("IntersectionObserver" in window && navSections.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        navLinks.forEach((link) => {
          link.classList.toggle("is-current", link.getAttribute("href") === `#${visible.target.id}`);
        });
      },
      { rootMargin: "-25% 0px -55%", threshold: [0.05, 0.2, 0.5] }
    );
    navSections.forEach(({ section }) => observer.observe(section));
  }

  /* =========================================================
     Boot
     ========================================================= */

  function init() {
    seedLogs();
    renderState();
    renderBrightness();
    updateClock();
    setInterval(updateClock, 1000);
  }

  init();
})();
