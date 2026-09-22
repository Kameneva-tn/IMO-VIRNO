/* ЇМО ВІРНО — помічник «Допоможи обрати».
   Спілкується з /api/assistant (Claude на сервері), показує підбірку з можливістю
   додавати в кошик, повертатися до діалогу, оформлювати замовлення й повертатися до покупок.
   Користується глобальними P, byId, IMG, cart, control, prodOf, openSheet, openDrawer,
   renderDrawer, renderAll, esc, uah, money, flat з app.js. */
(function () {
  const START = [
    "Солоденького", "Солодке й низькокалорійне", "Солоне, але легке", "Дуже голодний(-а)",
    "Приготувати вдома", "Перекус на ходу", "Освіжитись", "Дієтичні добавки",
    "Хелсі-фуд", "Щось веганське", "Замінити каву", "Замінити чай"
  ];
  const GREETING = "Привіт! Допоможу обрати 🙂 Чого вам зараз хочеться? Оберіть варіант або напишіть своїми словами.";

  const store = {
    get() { try { return JSON.parse(sessionStorage.getItem("imo-assistant") || "null"); } catch (e) { return null; } },
    set(v) { try { sessionStorage.setItem("imo-assistant", JSON.stringify(v)); } catch (e) {} }
  };
  let state = store.get() || { msgs: [{ role: "assistant", text: GREETING, choices: START }], selection: null };
  let view = "chat";          // chat | selection
  let busy = false;

  /* ─── стилі ─── */
  const css = document.createElement("style");
  css.textContent = `
  .asst-launch{position:fixed;right:24px;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:47;
    display:flex;align-items:center;gap:10px;border:0;border-radius:999px;padding:14px 22px 14px 18px;
    background:var(--clay);color:#fff;font:700 15px/1 var(--sans);cursor:pointer;
    box-shadow:0 18px 34px -14px rgba(var(--shadow),.9);transition:transform .2s,background .2s}
  .asst-launch:hover{background:var(--clay-deep);transform:translateY(-2px)}
  .asst-launch .spark{font-size:18px;line-height:1}
  .asst-launch.hide{opacity:0;pointer-events:none}
  .totop{bottom:calc(92px + env(safe-area-inset-bottom,0px)) !important}

  .asst{position:fixed;right:24px;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:48;
    width:min(430px,calc(100vw - 32px));height:min(700px,calc(100vh - 48px));
    background:var(--paper);border-radius:28px;box-shadow:0 40px 80px -30px rgba(0,0,0,.45);
    display:flex;flex-direction:column;overflow:hidden;
    transform:translateY(20px) scale(.98);opacity:0;pointer-events:none;transition:all .22s ease}
  .asst.open{transform:none;opacity:1;pointer-events:auto}
  .asst-head{display:flex;align-items:center;gap:10px;padding:16px 18px;background:var(--blush);border-bottom:1px solid var(--line)}
  .asst-head .av{width:36px;height:36px;border-radius:50%;background:var(--clay);color:#fff;display:grid;place-items:center;font-size:17px;flex:none}
  .asst-head b{font-family:var(--slab);font-weight:400;font-size:19px;display:block;line-height:1.1}
  .asst-head small{color:var(--muted);font-size:12px}
  .asst-head .x{margin-left:auto;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:var(--paper);cursor:pointer;font-size:15px}
  .asst-body{flex:1;overflow-y:auto;padding:16px 16px 8px;display:flex;flex-direction:column;gap:10px}
  .bub{max-width:86%;padding:10px 14px;border-radius:18px;font-size:14.5px;line-height:1.45;white-space:pre-line}
  .bub.a{background:var(--blush);color:var(--ink);border-bottom-left-radius:6px;align-self:flex-start}
  .bub.u{background:var(--ink);color:var(--paper);border-bottom-right-radius:6px;align-self:flex-end}
  .chips{display:flex;flex-wrap:wrap;gap:7px;align-self:flex-start;max-width:100%}
  .chips button{border:1.5px solid var(--clay);background:var(--paper);color:var(--clay-deep);border-radius:999px;
    padding:7px 13px;font:600 13px var(--sans);cursor:pointer}
  .chips button:hover{background:var(--clay);color:#fff}
  .selbtn{align-self:flex-start;border:0;border-radius:18px;background:var(--ink);color:var(--paper);cursor:pointer;
    padding:12px 16px;font:700 14px var(--sans);display:flex;align-items:center;gap:10px}
  .selbtn span{background:var(--clay);border-radius:999px;padding:3px 9px;font-size:12px}
  .typing{align-self:flex-start;background:var(--blush);border-radius:18px;padding:12px 16px;display:flex;gap:5px}
  .typing i{width:7px;height:7px;border-radius:50%;background:var(--clay);animation:tp 1s infinite ease-in-out}
  .typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
  @keyframes tp{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
  .asst-foot{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--line);background:var(--paper)}
  .asst-foot input{flex:1;min-width:0;height:44px;border-radius:999px;border:1px solid var(--line);padding:0 16px;font:15px var(--sans);background:var(--field)}
  .asst-foot .send{width:44px;height:44px;border-radius:50%;border:0;background:var(--clay);color:#fff;cursor:pointer;display:grid;place-items:center}
  .asst-foot .send[disabled]{opacity:.5}
  .asst-reset{border:0;background:none;color:var(--muted);font:12px var(--sans);text-decoration:underline;cursor:pointer;align-self:center;margin-top:4px}

  /* підбірка */
  .sel-top{padding:14px 16px 6px}
  .sel-back{border:0;background:none;padding:0;color:var(--clay-deep);font:700 13px var(--sans);cursor:pointer;margin-bottom:8px}
  .sel-top h3{font-family:var(--slab);font-weight:400;font-size:22px;margin:0 0 4px;line-height:1.15}
  .sel-top p{margin:0;color:var(--ink-2);font-size:13.5px}
  .sel-list{flex:1;overflow-y:auto;padding:8px 16px 12px;display:flex;flex-direction:column;gap:10px}
  .sel-it{display:grid;grid-template-columns:74px 1fr;gap:12px;padding:10px;border-radius:18px;background:var(--blush)}
  .sel-it .th{width:74px;height:74px;border-radius:14px;background:#fff;overflow:hidden;border:0;padding:0;cursor:pointer;position:relative}
  .sel-it .th img{width:100%;height:100%;object-fit:contain}
  .sel-it .th .noph b{font-size:10px}.sel-it .th .noph i{display:none}
  .sel-it .nm{border:0;background:none;padding:0;text-align:left;font:600 14px/1.25 var(--sans);color:var(--ink);cursor:pointer}
  .sel-it .why{font-size:12.5px;color:var(--muted);margin:3px 0 7px;font-style:italic}
  .sel-it .row{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .sel-it .pr{font-weight:800;color:var(--clay);font-size:15px}
  .sel-it .btn{font-size:14px;padding:6px 16px}
  .sel-foot{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 14px;border-top:1px solid var(--line)}
  .sel-foot button{height:46px;border-radius:999px;font:700 14px var(--sans);cursor:pointer}
  .sel-foot .a-shop{border:1.5px solid var(--ink);background:transparent;color:var(--ink)}
  .sel-foot .a-pay{border:0;background:var(--clay);color:#fff}
  .sel-foot .a-pay[disabled]{background:var(--blush-2);color:var(--muted);cursor:default}
  @media(max-width:600px){
    .asst{right:0;bottom:0;width:100vw;height:100%;border-radius:0}
    .asst-launch{right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));padding:12px 18px 12px 14px;font-size:14px}
    .totop{bottom:calc(76px + env(safe-area-inset-bottom,0px)) !important;right:16px}
  }`;
  document.head.append(css);

  /* ─── розмітка ─── */
  const launch = document.createElement("button");
  launch.className = "asst-launch"; launch.type = "button";
  launch.innerHTML = `<span class="spark" aria-hidden="true">✦</span>Допоможи обрати`;
  const box = document.createElement("section");
  box.className = "asst"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Допоможи обрати");
  document.body.append(launch, box);

  const open = () => { box.classList.add("open"); launch.classList.add("hide"); render(); setTimeout(() => box.querySelector("input")?.focus(), 250); };
  const close = () => { box.classList.remove("open"); launch.classList.remove("hide"); };
  launch.onclick = open;

  /* ─── відмальовування ─── */
  function head() {
    return `<div class="asst-head"><span class="av" aria-hidden="true">✦</span>
      <div><b>Допоможи обрати</b><small>Помічник ЇМО ВІРНО</small></div>
      <button class="x" type="button" data-aclose aria-label="Закрити">✕</button></div>`;
  }

  function render() {
    if (view === "selection" && state.selection) return renderSelection();
    const last = state.msgs.length - 1;
    box.innerHTML = head() + `<div class="asst-body" id="asstBody">` +
      state.msgs.map((m, i) => {
        let h = `<div class="bub ${m.role === "user" ? "u" : "a"}">${esc(m.text)}</div>`;
        if (m.role === "assistant" && m.choices && i === last && !busy)
          h += `<div class="chips">${m.choices.map(c => `<button type="button" data-choice="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
        if (m.role === "assistant" && m.selection)
          h += `<button class="selbtn" type="button" data-showsel="${i}">Подивитись підбірку <span>${m.selection.items.length}</span></button>`;
        return h;
      }).join("") +
      (busy ? `<div class="typing" aria-label="Помічник пише"><i></i><i></i><i></i></div>` : "") +
      (state.msgs.length > 1 && !busy ? `<button class="asst-reset" type="button" data-areset>Почати спочатку</button>` : "") +
      `</div>
      <form class="asst-foot" id="asstForm">
        <input type="text" placeholder="Напишіть, чого хочеться…" maxlength="500" ${busy ? "disabled" : ""} aria-label="Повідомлення">
        <button class="send" type="submit" ${busy ? "disabled" : ""} aria-label="Надіслати">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </form>`;
    const b = document.getElementById("asstBody"); b.scrollTop = b.scrollHeight;
    document.getElementById("asstForm").onsubmit = e => {
      e.preventDefault();
      const inp = e.target.querySelector("input");
      const t = inp.value.trim(); if (t) send(t);
    };
  }

  function cartSum() { let s = 0; for (const k in cart) { const p = prodOf(k); if (p) s += p.price * cart[k]; } return s; }

  function renderSelection() {
    const s = state.selection;
    const items = s.items.map(it => ({ ...it, p: byId[it.id] })).filter(it => it.p);
    const sum = cartSum();
    box.innerHTML = head() + `
      <div class="sel-top">
        <button class="sel-back" type="button" data-back>← Повернутись до діалогу</button>
        <h3>${esc(s.title)}</h3>
        ${s.intro ? `<p>${esc(s.intro)}</p>` : ""}
      </div>
      <div class="sel-list">
        ${items.map(({ p, why }) => `<div class="sel-it">
          <button class="th" type="button" data-open="${esc(p.id)}" aria-label="${esc(flat(p.name))}">${
            p.img ? `<img src="${IMG[p.img]}" alt="" loading="lazy">` : `<span class="noph"><b>${esc(p.brand)}</b></span>`}</button>
          <div>
            <button class="nm" type="button" data-open="${esc(p.id)}">${esc(flat(p.name))}</button>
            <div class="why">${esc(why)}</div>
            <div class="row"><span class="pr">${money(p)}</span>${
              needsChoice(p) ? `<button class="btn" type="button" data-open="${esc(p.id)}">Обрати</button>` : control(p.id, "sm")}</div>
          </div></div>`).join("")}
      </div>
      <div class="sel-foot">
        <button class="a-shop" type="button" data-toshop>До покупок</button>
        <button class="a-pay" type="button" data-pay ${sum ? "" : "disabled"}>${sum ? "Оформити · " + uah(sum) : "Оформити"}</button>
      </div>`;
  }

  /* ─── діалог ─── */
  async function send(text) {
    if (busy) return;
    state.msgs.push({ role: "user", text });
    busy = true; view = "chat"; save(); render();
    try {
      const r = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: state.msgs.slice(1).map(m => ({
          role: m.role, choices: m.choices || null, selection: m.selection ? true : null,
          text: m.selection ? (m.text + "\n[Показано підбірку: " + m.selection.items.map(i => i.id).join(", ") + "]") : m.text })) })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Помічник зараз недоступний");
      const msg = { role: "assistant", text: d.reply || "…" };
      if (d.choices?.length) msg.choices = d.choices;
      if (d.selection?.items?.length) { msg.selection = d.selection; state.selection = d.selection; }
      state.msgs.push(msg);
    } catch (e) {
      state.msgs.push({ role: "assistant", text: e.message + ". Спробуйте ще раз." });
    }
    busy = false; save(); render();
  }
  function save() { store.set({ msgs: state.msgs.slice(-30), selection: state.selection }); }

  /* ─── кліки всередині віконця ─── */
  box.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.aclose !== undefined) return close();
    if (t.dataset.choice) return send(t.dataset.choice);
    if (t.dataset.showsel !== undefined) { state.selection = state.msgs[+t.dataset.showsel].selection; view = "selection"; save(); return render(); }
    if (t.dataset.back !== undefined) { view = "chat"; return render(); }
    if (t.dataset.areset !== undefined) {
      state = { msgs: [{ role: "assistant", text: GREETING, choices: START }], selection: null }; view = "chat"; save(); return render();
    }
    if (t.dataset.toshop !== undefined) { close(); document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); return; }
    if (t.dataset.pay !== undefined) {
      close(); openDrawer(); drawerView = "checkout"; renderDrawer(); return;
    }
    // data-open, data-add, data-inc, data-dec обробляє app.js; тут лише не закриваємо віконце
  });

  // коли змінюється кошик — оновлюємо кнопки в підбірці
  const origAll = renderAll;
  renderAll = function () { origAll.apply(this, arguments); if (box.classList.contains("open") && view === "selection") renderSelection(); };

  document.addEventListener("keydown", e => {   // capture: перевіряємо до того, як app.js закриє картку товару
    if (e.key !== "Escape" || !box.classList.contains("open")) return;
    if (document.getElementById("overlay").classList.contains("open") || document.getElementById("drawer").classList.contains("open")) return;
    close();
  }, true);
})();
