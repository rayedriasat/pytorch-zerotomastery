/* ==========================================================================
   Immersive — progress tracking, annotations (highlight / underline / draw),
   gamification and bookmarks for the Zero to Mastery PyTorch course.

   Everything is client-side and persisted to localStorage. Data can be
   exported / imported as a JSON file.

   Built to cooperate with Material for MkDocs "navigation.instant" (SPA-style
   page swaps) by re-initialising on every `document$` emission.
   ========================================================================== */
(function () {
  "use strict";

  const LS_KEY = "ztm-pytorch-immersive-v1";
  const COLORS = {
    yellow: "rgba(255, 214, 71, 0.45)",
    green:  "rgba(95, 220, 140, 0.40)",
    blue:   "rgba(96, 175, 255, 0.40)",
    pink:   "rgba(255, 122, 190, 0.40)",
    purple: "rgba(180, 130, 255, 0.42)",
  };
  const COLOR_KEYS = Object.keys(COLORS);

  /* ----------------------------------------------------------------------
     Store: load / save / export / import
     Schema:
     {
       version: 1,
       defaultColor: "yellow",
       pages: {
         "<pathname>": {
           title: "...",
           completed: bool,
           annotations: [
             { id, type:"highlight"|"underline", color, start, end, text, ts }
           ],
           drawing: [ { color, width, eraser, points:[[x,y],...] } ]
         }
       }
     }
  ---------------------------------------------------------------------- */
  const Store = {
    data: { version: 1, defaultColor: "yellow", pages: {} },

    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) this.data = Object.assign(this.data, JSON.parse(raw));
      } catch (e) { console.warn("[immersive] load failed", e); }
      if (!this.data.pages) this.data.pages = {};
      if (!this.data.defaultColor) this.data.defaultColor = "yellow";
    },
    save() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); }
      catch (e) { console.warn("[immersive] save failed", e); }
    },
    page(key, title) {
      if (!this.data.pages[key]) {
        this.data.pages[key] = { title: title || key, completed: false, annotations: [], drawing: [] };
      }
      if (title) this.data.pages[key].title = title;
      const p = this.data.pages[key];
      if (!p.annotations) p.annotations = [];
      if (!p.drawing) p.drawing = [];
      return p;
    },
    export() {
      const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `pytorch-progress-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    import(file, done) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const incoming = JSON.parse(reader.result);
          if (!incoming || typeof incoming !== "object" || !incoming.pages)
            throw new Error("Unrecognised file format");
          // Merge: union pages, OR completion, concat unique annotations.
          for (const [k, pg] of Object.entries(incoming.pages)) {
            const cur = this.page(k, pg.title);
            cur.completed = cur.completed || !!pg.completed;
            const seen = new Set(cur.annotations.map(a => a.id));
            (pg.annotations || []).forEach(a => { if (!seen.has(a.id)) cur.annotations.push(a); });
            if ((pg.drawing || []).length) cur.drawing = cur.drawing.concat(pg.drawing);
          }
          if (incoming.defaultColor) this.data.defaultColor = incoming.defaultColor;
          this.save();
          done(true);
        } catch (e) { console.warn(e); done(false, e.message); }
      };
      reader.readAsText(file);
    },
    reset() {
      this.data = { version: 1, defaultColor: "yellow", pages: {} };
      this.save();
    },
  };

  /* ----------------------------------------------------------------------
     Helpers
  ---------------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const pageKey = () => location.pathname;
  const contentRoot = () => $(".md-content article") || $(".md-content__inner") || $("article");

  let toastTimer;
  function toast(msg) {
    let t = $(".imm-toast");
    if (!t) { t = document.createElement("div"); t.className = "imm-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 1800);
  }

  // Walk text nodes under root (skips none — article has no script/style).
  function textNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // Character offset of (container, offset) relative to root, consistent with
  // the concatenation of text-node values used during restore.
  function offsetOf(root, container, offset) {
    const r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(container, offset);
    return r.toString().length;
  }

  /* ----------------------------------------------------------------------
     Annotation engine: apply / remove highlights & underlines by offset
  ---------------------------------------------------------------------- */
  function applyAnnotation(root, ann) {
    const cls = ann.type === "underline" ? "imm-ul" : "imm-hl";
    const segs = [];
    let pos = 0;
    for (const node of textNodes(root)) {
      const len = node.nodeValue.length;
      const ns = pos, ne = pos + len;
      pos = ne;
      if (ne <= ann.start || ns >= ann.end) continue;
      const s = Math.max(ann.start, ns) - ns;
      const e = Math.min(ann.end, ne) - ns;
      if (e > s) segs.push({ node, s, e });
    }
    // Wrap from last to first so earlier offsets stay valid after DOM splits.
    for (let i = segs.length - 1; i >= 0; i--) {
      const { node, s, e } = segs[i];
      const range = document.createRange();
      range.setStart(node, s);
      range.setEnd(node, e);
      const span = document.createElement("span");
      span.className = cls;
      span.dataset.annId = ann.id;
      if (ann.color && COLORS[ann.color]) span.style.setProperty("--ann-color", COLORS[ann.color]);
      try { range.surroundContents(span); } catch (err) { /* skip awkward spans */ }
    }
  }

  function removeAnnotationFromDom(id) {
    document.querySelectorAll(`[data-ann-id="${id}"]`).forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
  }

  function restoreAnnotations(root, page) {
    page.annotations.forEach(a => applyAnnotation(root, a));
  }

  let uid = 0;
  function newId() {
    uid += 1;
    return "a" + Date.now().toString(36) + (uid).toString(36);
  }

  function createAnnotation(type) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const root = contentRoot();
    if (!root) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const text = sel.toString().trim();
    if (!text) return;

    const start = offsetOf(root, range.startContainer, range.startOffset);
    const end = offsetOf(root, range.endContainer, range.endOffset);
    if (end <= start) return;

    const ann = {
      id: newId(),
      type,
      color: Store.data.defaultColor,
      start, end,
      text: text.length > 160 ? text.slice(0, 157) + "…" : text,
      ts: Date.now(),
    };
    const page = Store.page(pageKey(), document.title);
    page.annotations.push(ann);
    Store.save();
    applyAnnotation(root, ann);
    sel.removeAllRanges();
    toast(type === "underline" ? "Underlined · saved to bookmarks" : "Highlighted · saved to bookmarks");
    UI.refreshPanel();
  }

  function deleteAnnotation(id) {
    const page = Store.page(pageKey(), document.title);
    page.annotations = page.annotations.filter(a => a.id !== id);
    Store.save();
    removeAnnotationFromDom(id);
    UI.refreshPanel();
  }

  /* ----------------------------------------------------------------------
     Drawing engine: freehand strokes on a canvas overlaying the article
  ---------------------------------------------------------------------- */
  const Draw = {
    canvas: null, ctx: null, root: null,
    active: false, drawing: false,
    color: "#ee4c2c", width: 3, eraser: false,
    current: null,

    mount(root, page) {
      this.root = root;
      const layer = document.createElement("canvas");
      layer.className = "imm-canvas-layer";
      root.style.position = root.style.position || "relative";
      root.appendChild(layer);
      this.canvas = layer;
      this.ctx = layer.getContext("2d");
      this.resize();
      this.redraw(page);

      layer.addEventListener("pointerdown", e => this.start(e));
      layer.addEventListener("pointermove", e => this.move(e));
      window.addEventListener("pointerup", () => this.end());
      window.addEventListener("resize", () => { this.resize(); this.redraw(Store.page(pageKey())); });
    },
    resize() {
      if (!this.canvas || !this.root) return;
      const w = this.root.scrollWidth, h = this.root.scrollHeight;
      this.canvas.width = w; this.canvas.height = h;
      this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
    },
    pos(e) {
      const rect = this.canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    },
    start(e) {
      if (!this.active) return;
      this.drawing = true;
      this.current = { color: this.color, width: this.eraser ? this.width * 6 : this.width, eraser: this.eraser, points: [this.pos(e)] };
    },
    move(e) {
      if (!this.active || !this.drawing) return;
      this.current.points.push(this.pos(e));
      this.strokeLive();
    },
    end() {
      if (!this.drawing) return;
      this.drawing = false;
      if (this.current && this.current.points.length > 1) {
        const page = Store.page(pageKey(), document.title);
        page.drawing.push(this.current);
        Store.save();
      }
      this.current = null;
    },
    strokeLive() {
      const s = this.current;
      const ctx = this.ctx;
      ctx.save();
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.globalCompositeOperation = s.eraser ? "destination-out" : "source-over";
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      const p = s.points;
      ctx.beginPath();
      ctx.moveTo(p[p.length - 2][0], p[p.length - 2][1]);
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      ctx.stroke();
      ctx.restore();
    },
    redraw(page) {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      (page.drawing || []).forEach(s => {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineJoin = ctx.lineCap = "round";
        ctx.globalCompositeOperation = s.eraser ? "destination-out" : "source-over";
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        s.points.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
        ctx.stroke();
        ctx.restore();
      });
    },
    clear() {
      const page = Store.page(pageKey(), document.title);
      page.drawing = [];
      Store.save();
      this.redraw(page);
      toast("Drawing cleared");
    },
    toggle(on) {
      this.active = on;
      document.body.classList.toggle("imm-draw-mode", on);
    },
  };

  /* ----------------------------------------------------------------------
     UI: progress, toolbar, palette, panel, complete toggle
  ---------------------------------------------------------------------- */
  const UI = {
    coursePages() {
      const map = new Map();
      document.querySelectorAll(".md-nav--primary a.md-nav__link[href]").forEach(a => {
        try {
          const u = new URL(a.href);
          if (u.origin === location.origin && !a.hash) {
            if (!map.has(u.pathname)) map.set(u.pathname, a.textContent.trim());
          }
        } catch (e) {}
      });
      // Always include the current page.
      if (!map.has(pageKey())) map.set(pageKey(), document.title);
      return map;
    },

    percent() {
      const pages = this.coursePages();
      const total = pages.size || 1;
      let done = 0;
      pages.forEach((_t, k) => { if (Store.data.pages[k] && Store.data.pages[k].completed) done++; });
      return { pct: Math.round((done / total) * 100), done, total };
    },

    updateProgress() {
      const { pct, done, total } = this.percent();
      const pill = $(".imm-progress-pill");
      if (pill) pill.innerHTML = `<span class="imm-trophy">${pct === 100 ? "🏆" : "🎯"}</span> ${pct}% · ${done}/${total}`;
      const bar = $(".imm-progress-bar");
      if (bar) bar.style.width = pct + "%";
    },

    mountChrome() {
      // Progress bar (top edge) + pill (header)
      if (!$(".imm-progress-bar")) {
        const bar = document.createElement("div");
        bar.className = "imm-progress-bar";
        document.body.appendChild(bar);
      }
      const header = $(".md-header__inner");
      if (header && !$(".imm-progress-pill")) {
        const pill = document.createElement("div");
        pill.className = "imm-progress-pill";
        pill.title = "Course progress";
        const opt = header.querySelector(".md-header__option");
        header.insertBefore(pill, opt || null);
      }

      if ($(".imm-toolbar")) return; // chrome persists across instant nav

      // Floating toolbar
      const bar = document.createElement("div");
      bar.className = "imm-toolbar";
      bar.innerHTML = `
        <button class="imm-fab imm-fab--toggle" data-act="toggle" title="Hide tools">▾</button>
        <div class="imm-toolbar__group">
          <button class="imm-fab" data-act="panel" title="Bookmarks & annotations">🔖</button>
          <button class="imm-fab imm-fab--secondary" data-act="palette" title="Highlight colour">🎨</button>
          <button class="imm-fab imm-fab--secondary" data-act="draw" title="Draw (freehand)">✏️</button>
          <button class="imm-fab imm-fab--secondary" data-act="data" title="Export / import / reset">⚙️</button>
        </div>`;
      document.body.appendChild(bar);
      bar.addEventListener("click", e => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "toggle") this.toggleToolbar();
        else if (act === "panel") this.togglePanel();
        else if (act === "palette") this.togglePalette();
        else if (act === "draw") this.toggleDraw();
        else if (act === "data") this.dataMenu();
      });
      this.toggleToolbar(!!Store.data.toolbarCollapsed);

      // Colour palette
      const pal = document.createElement("div");
      pal.className = "imm-palette";
      pal.innerHTML = COLOR_KEYS.map(k =>
        `<span class="imm-swatch" data-color="${k}" style="background:${COLORS[k]}" title="${k}"></span>`).join("");
      document.body.appendChild(pal);
      pal.addEventListener("click", e => {
        const c = e.target.closest("[data-color]")?.dataset.color;
        if (!c) return;
        Store.data.defaultColor = c; Store.save();
        this.syncSwatches();
        toast(`Default colour: ${c}`);
      });

      // Drawing toolbar
      const db = document.createElement("div");
      db.className = "imm-draw-bar";
      db.innerHTML = `
        <input type="color" class="imm-pen-color" value="#ee4c2c" title="Pen colour">
        <input type="range" min="1" max="12" value="3" title="Pen size">
        <button class="imm-btn" data-d="eraser">Eraser</button>
        <button class="imm-btn" data-d="clear">Clear</button>
        <button class="imm-btn" data-d="done">Done</button>`;
      document.body.appendChild(db);
      db.querySelector(".imm-pen-color").addEventListener("input", e => { Draw.color = e.target.value; Draw.eraser = false; this.syncEraser(); });
      db.querySelector('input[type="range"]').addEventListener("input", e => { Draw.width = +e.target.value; });
      db.addEventListener("click", e => {
        const d = e.target.closest("[data-d]")?.dataset.d;
        if (d === "eraser") { Draw.eraser = !Draw.eraser; this.syncEraser(); }
        else if (d === "clear") Draw.clear();
        else if (d === "done") this.toggleDraw(false);
      });

      // Side panel
      const panel = document.createElement("div");
      panel.className = "imm-panel";
      panel.innerHTML = `
        <div class="imm-panel__head">
          <span class="imm-panel__title">🔖 Bookmarks & Annotations</span>
          <button class="imm-panel__close" title="Close">×</button>
        </div>
        <div class="imm-panel__tools">
          <button class="imm-btn" data-p="export">⬇ Export</button>
          <button class="imm-btn" data-p="import">⬆ Import</button>
          <button class="imm-btn imm-btn--danger" data-p="reset">Reset all</button>
          <input type="file" accept="application/json" hidden>
        </div>
        <div class="imm-panel__body"></div>`;
      document.body.appendChild(panel);
      panel.querySelector(".imm-panel__close").addEventListener("click", () => this.togglePanel(false));
      const fileInput = panel.querySelector('input[type="file"]');
      panel.querySelector(".imm-panel__tools").addEventListener("click", e => {
        const p = e.target.closest("[data-p]")?.dataset.p;
        if (p === "export") Store.export();
        else if (p === "import") fileInput.click();
        else if (p === "reset") {
          if (confirm("Erase ALL progress, highlights and drawings? This cannot be undone.")) {
            Store.reset(); location.reload();
          }
        }
      });
      fileInput.addEventListener("change", () => {
        if (!fileInput.files[0]) return;
        Store.import(fileInput.files[0], (ok, msg) => {
          if (ok) { toast("Progress imported"); location.reload(); }
          else toast("Import failed: " + msg);
        });
        fileInput.value = "";
      });

      this.syncSwatches();
    },

    syncSwatches() {
      document.querySelectorAll(".imm-swatch").forEach(s =>
        s.classList.toggle("is-selected", s.dataset.color === Store.data.defaultColor));
    },
    syncEraser() {
      const btn = document.querySelector('.imm-draw-bar [data-d="eraser"]');
      if (btn) btn.classList.toggle("imm-btn--danger", Draw.eraser);
    },

    toggleToolbar(force) {
      const bar = $(".imm-toolbar");
      if (!bar) return;
      const collapsed = force ?? !bar.classList.contains("is-collapsed");
      bar.classList.toggle("is-collapsed", collapsed);
      Store.data.toolbarCollapsed = collapsed;
      Store.save();
      const t = bar.querySelector(".imm-fab--toggle");
      if (t) {
        t.textContent = collapsed ? "▴" : "▾";
        t.title = collapsed ? "Show tools" : "Hide tools";
      }
    },

    // Inline "mark complete" toggles next to every chapter in the left nav.
    mountNavCompletion() {
      document.querySelectorAll(".md-nav--primary a.md-nav__link[href]").forEach(a => {
        let key;
        try {
          const u = new URL(a.href);
          if (u.origin !== location.origin || a.hash) return;
          key = u.pathname;
        } catch (e) { return; }
        if (a.querySelector(".imm-nav-check")) return;
        const title = a.textContent.trim();
        const cb = document.createElement("span");
        cb.className = "imm-nav-check";
        cb.setAttribute("role", "checkbox");
        cb.title = "Mark section complete";
        a.appendChild(cb);
        cb.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const pg = Store.page(key, title);
          pg.completed = !pg.completed;
          Store.save();
          this.syncNavCompletion();
          this.updateProgress();
          if (key === pageKey()) this.syncCompleteBox(pg);
          toast(pg.completed ? "Section complete! 🎉" : "Marked as not complete");
        });
      });
      this.syncNavCompletion();
    },

    syncNavCompletion() {
      document.querySelectorAll(".md-nav--primary a.md-nav__link[href] .imm-nav-check").forEach(cb => {
        const a = cb.closest("a.md-nav__link");
        let key;
        try { key = new URL(a.href).pathname; } catch (e) { return; }
        const done = !!(Store.data.pages[key] && Store.data.pages[key].completed);
        cb.classList.toggle("is-done", done);
        cb.setAttribute("aria-checked", done ? "true" : "false");
        a.classList.toggle("imm-nav-done", done);
      });
    },

    syncCompleteBox(page) {
      const box = $(".imm-complete-box");
      if (!box) return;
      box.classList.toggle("is-done", page.completed);
      box.querySelector("span").textContent = page.completed
        ? "✅ You’ve completed this section."
        : "Finished reading? Mark this section complete to track your progress.";
      box.querySelector("button").textContent = page.completed ? "Completed ✓" : "Mark complete";
    },

    togglePalette(force) {
      const pal = $(".imm-palette");
      if (pal) pal.classList.toggle("is-open", force ?? !pal.classList.contains("is-open"));
    },
    togglePanel(force) {
      const panel = $(".imm-panel");
      if (!panel) return;
      const open = force ?? !panel.classList.contains("is-open");
      panel.classList.toggle("is-open", open);
      if (open) this.refreshPanel();
    },
    toggleDraw(force) {
      const on = force ?? !Draw.active;
      Draw.toggle(on);
      $(".imm-draw-bar")?.classList.toggle("is-open", on);
      document.querySelector('.imm-toolbar [data-act="draw"]')?.classList.toggle("is-active", on);
      if (on) toast("Draw mode on — sketch over the page");
    },

    dataMenu() { this.togglePanel(true); },

    // Bookmarks panel content — grouped by page, current page first.
    refreshPanel() {
      const body = $(".imm-panel__body");
      if (!body) return;
      const pages = Store.data.pages;
      const entries = Object.entries(pages).filter(([, p]) => (p.annotations || []).length);
      if (!entries.length) {
        body.innerHTML = `<div class="imm-empty">No bookmarks yet.<br>Select text and press <b>A</b> to highlight or <b>U</b> to underline — each one is saved here.</div>`;
        return;
      }
      const here = pageKey();
      entries.sort((a) => (a[0] === here ? -1 : 1));
      body.innerHTML = entries.map(([key, p]) => {
        const items = p.annotations.map(a => {
          const dot = a.type === "underline"
            ? `border-bottom:3px solid ${COLORS[a.color] || "#ee4c2c"};border-radius:0;height:8px`
            : `background:${COLORS[a.color] || COLORS.yellow}`;
          return `<div class="imm-bm" data-key="${key}" data-id="${a.id}">
              <span class="imm-bm__dot" style="${dot}"></span>
              <span class="imm-bm__text">${escapeHtml(a.text)}</span>
              <button class="imm-bm__del" data-del="${a.id}" data-pkey="${key}" title="Delete">🗑</button>
            </div>`;
        }).join("");
        return `<div class="imm-bm-group">
            <div class="imm-bm-group__title">${escapeHtml(p.title || key)}${key === here ? " · this page" : ""}</div>
            ${items}</div>`;
      }).join("");

      body.querySelectorAll(".imm-bm").forEach(el => {
        el.addEventListener("click", e => {
          if (e.target.closest("[data-del]")) return;
          this.jumpTo(el.dataset.key, el.dataset.id);
        });
      });
      body.querySelectorAll("[data-del]").forEach(b => {
        b.addEventListener("click", e => {
          e.stopPropagation();
          const id = b.dataset.del, k = b.dataset.pkey;
          if (k === pageKey()) deleteAnnotation(id);
          else {
            const pg = Store.data.pages[k];
            if (pg) pg.annotations = pg.annotations.filter(a => a.id !== id);
            Store.save(); this.refreshPanel();
          }
        });
      });
    },

    jumpTo(key, id) {
      if (key !== pageKey()) { location.href = key + "#imm-" + id; return; }
      const el = document.querySelector(`[data-ann-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("imm-ann-flash");
        setTimeout(() => el.classList.remove("imm-ann-flash"), 1500);
        this.togglePanel(false);
      }
    },

    mountCompleteBox(root, page) {
      if ($(".imm-complete-box")) return;
      const box = document.createElement("div");
      box.className = "imm-complete-box" + (page.completed ? " is-done" : "");
      box.innerHTML = `
        <span>${page.completed ? "✅ You’ve completed this section." : "Finished reading? Mark this section complete to track your progress."}</span>
        <button class="imm-complete-btn">${page.completed ? "Completed ✓" : "Mark complete"}</button>`;
      root.appendChild(box);
      box.querySelector("button").addEventListener("click", () => {
        page.completed = !page.completed;
        Store.save();
        box.classList.toggle("is-done", page.completed);
        box.querySelector("span").textContent = page.completed
          ? "✅ You’ve completed this section."
          : "Finished reading? Mark this section complete to track your progress.";
        box.querySelector("button").textContent = page.completed ? "Completed ✓" : "Mark complete";
        this.updateProgress();
        this.syncNavCompletion();
        if (page.completed) toast("Section complete! 🎉");
      });
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ----------------------------------------------------------------------
     Global keyboard: A = highlight, U = underline (when text selected)
  ---------------------------------------------------------------------- */
  function onKey(e) {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const sel = window.getSelection();
    const hasSel = sel && !sel.isCollapsed && sel.toString().trim();
    const k = e.key.toLowerCase();
    if (k === "a" && hasSel) { e.preventDefault(); createAnnotation("highlight"); }
    else if (k === "u" && hasSel) { e.preventDefault(); createAnnotation("underline"); }
    else if (k === "escape" && Draw.active) UI.toggleDraw(false);
  }

  /* ----------------------------------------------------------------------
     Per-page init (runs on every instant-navigation swap)
  ---------------------------------------------------------------------- */
  function initPage() {
    Draw.canvas = null; Draw.ctx = null; // article was swapped out
    UI.mountChrome();
    UI.mountNavCompletion();
    UI.updateProgress();

    const root = contentRoot();
    if (!root) return;
    const page = Store.page(pageKey(), document.title);

    // Re-apply annotations after MathJax has had a chance to typeset, so the
    // text offsets match what was captured.
    const apply = () => {
      restoreAnnotations(root, page);
      Draw.mount(root, page);
      UI.mountCompleteBox(root, page);
      // Deep-link to a specific annotation (#imm-<id>)
      if (location.hash.startsWith("#imm-")) {
        const id = location.hash.slice(5);
        setTimeout(() => UI.jumpTo(pageKey(), id), 300);
      }
    };
    if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
      MathJax.startup.promise.then(apply).catch(apply);
      setTimeout(() => { if (!$(".imm-canvas-layer")) apply(); }, 1200); // fallback
    } else {
      setTimeout(apply, 200);
    }
  }

  /* ----------------------------------------------------------------------
     Boot
  ---------------------------------------------------------------------- */
  Store.load();
  document.addEventListener("keydown", onKey, true);

  if (window.document$ && typeof document$.subscribe === "function") {
    document$.subscribe(() => initPage());   // Material instant navigation
  } else if (document.readyState !== "loading") {
    initPage();
  } else {
    document.addEventListener("DOMContentLoaded", initPage);
  }
})();
