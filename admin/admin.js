/* Адмінка ЇМО ВІРНО. Усі запити йдуть на /api/admin/*, доступ — за cookie після входу. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uah = n => Number(n).toLocaleString("uk-UA") + " грн";

async function api(path, opts = {}) {
  const r = await fetch("/api/admin" + path, { credentials: "same-origin", ...opts });
  let data = {};
  try { data = await r.json(); } catch (e) { /* порожня відповідь */ }
  if (r.status === 401) { showLogin(); throw new Error("Потрібен вхід"); }
  if (r.status === 413) throw new Error("Сервер не прийняв файли: завеликий розмір. Оновіть налаштування nginx (client_max_body_size).");
  if (!r.ok || data.ok === false) throw new Error(data.error || `Помилка ${r.status}`);
  return data;
}

function showLogin() { $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp() { $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); refreshStats(); }

function say(el, text, good) {
  el.textContent = text;
  el.className = "msg show " + (good ? "ok" : "bad");
}

/* ─── вхід ─── */
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/login", { method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ password: $("#pwd").value }) });
    $("#pwd").value = "";
    $("#loginErr").className = "msg bad";
    showApp();
  } catch (err) { say($("#loginErr"), err.message, false); }
});

$("#logout").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
  showLogin();
});

/* ─── вкладки ─── */
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t === tab)));
    ["import", "goods", "orders"].forEach(name => {
      $("#tab-" + name).classList.toggle("hidden", name !== tab.dataset.tab);
    });
    if (tab.dataset.tab === "goods") loadGoods();
    if (tab.dataset.tab === "orders") loadOrders();
  });
});

/* ─── статистика ─── */
async function refreshStats() {
  const s = await api("/stats");
  $("#stats").innerHTML = `
    <div class="stat"><b>${s.total}</b><span>товарів у каталозі</span></div>
    <div class="stat"><b>${s.no_photo}</b><span>без фото</span></div>
    <div class="stat"><b>${s.groups.length}</b><span>категорій</span></div>
    <div class="stat"><b>${s.orders}</b><span>замовлень усього</span></div>
    <div class="stat"><b>${s.telegram ? "так" : "ні"}</b><span>Telegram підключено</span></div>`;
  await fillCategories();
  const sel = $("#groupSel");
  if (sel.options.length <= 1) {
    s.groups.sort((a, b) => b.count - a.count).forEach(g => {
      const o = document.createElement("option");
      o.value = g.key; o.textContent = `${g.label} (${g.count})`;
      sel.append(o);
    });
  }
}

async function fillCategories() {
  const sel = $("#catSel");
  if (sel.options.length) return;
  const r = await api("/categories");
  const labels = Object.fromEntries(r.groups.map(g => [g.key, g.label]));
  const byGroup = {};
  r.categories.forEach(c => (byGroup[c.group] ||= []).push(c.name));
  sel.innerHTML = `<option value="">— оберіть категорію —</option>` +
    Object.entries(byGroup).map(([g, names]) =>
      `<optgroup label="${esc(labels[g] || g)}">` +
      names.map(n => `<option>${esc(n)}</option>`).join("") + `</optgroup>`).join("");
}

/* ─── імпорт таблиці ─── */
$("#importForm").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target, btn = form.querySelector("button"), msg = $("#importMsg");
  const data = new FormData(form);
  data.set("dry_run", $("#dry").checked ? "1" : "0");
  if (!data.get("category")) { say($("#importMsg"), "Оберіть категорію зі списку.", false); return; }
  btn.disabled = true; btn.textContent = "Обробляємо…";
  say(msg, "Читаємо таблицю й тягнемо фото — це може зайняти до хвилини.", true);
  try {
    const r = await api("/import", { method: "POST", body: data });
    const lines = [r.dry_run ? "Перевірка без запису." : "Готово.",
                   `Додано: ${r.added}, оновлено: ${r.updated}.`];
    if (r.missing_photo.length) {
      lines.push(`Без фото залишилось ${r.missing_photo.length}: ` +
                 r.missing_photo.slice(0, 6).map(p => p.name).join("; ") +
                 (r.missing_photo.length > 6 ? "…" : ""));
      lines.push("Їх можна додати вручну на вкладці «Товари» → фільтр «лише без фото».");
    }
    say(msg, lines.join(" "), true);
    if (!r.dry_run) { form.reset(); refreshStats(); }
  } catch (err) {
    say(msg, err.message, false);
  } finally {
    btn.disabled = false; btn.textContent = "Залити";
  }
});

/* ─── товари ─── */
let timer;
["#q", "#groupSel", "#nophoto"].forEach(sel => {
  $(sel).addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadGoods, 250); });
});

async function loadGoods() {
  const box = $("#goods");
  const params = new URLSearchParams({ q: $("#q").value, group: $("#groupSel").value,
                                       nophoto: $("#nophoto").checked ? "1" : "0" });
  box.innerHTML = `<p class="muted">Завантаження…</p>`;
  try {
    const r = await api("/products?" + params);
    if (!r.items.length) { box.innerHTML = `<p class="muted">Нічого не знайдено.</p>`; return; }
    box.innerHTML = `<p class="muted">Показано ${r.items.length} із ${r.count}</p>
      <table><thead><tr><th></th><th>Товар</th><th>Ціна</th><th></th></tr></thead><tbody>
      ${r.items.map(p => `<tr data-id="${esc(p.id)}">
        <td class="pic">${p.img ? `<img src="../assets/img/${esc(p.img)}.webp" alt="" loading="lazy">`
                                : `<span class="noimg">нема фото</span>`}</td>
        <td class="name"><b>${esc(p.name)}</b><small>${esc(p.sub)} · код ${esc(p.id)}</small></td>
        <td><input type="number" min="0" value="${p.price}" data-price>${p.weighted ? " /кг" : ""}</td>
        <td class="act">
          <button class="mini" data-save>Зберегти</button>
          <button class="mini" data-photo>Фото</button>
          <button class="mini danger" data-del>Видалити</button>
        </td></tr>`).join("")}
      </tbody></table>`;
  } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
}

$("#goods").addEventListener("click", async e => {
  const row = e.target.closest("tr");
  if (!row) return;
  const id = row.dataset.id, btn = e.target;

  if (btn.matches("[data-save]")) {
    btn.disabled = true;
    try {
      await api("/product/" + id, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: row.querySelector("[data-price]").value }) });
      btn.textContent = "Збережено";
      setTimeout(() => { btn.textContent = "Зберегти"; btn.disabled = false; }, 1200);
    } catch (err) { alert(err.message); btn.disabled = false; }
  }

  if (btn.matches("[data-del]")) {
    if (!confirm("Видалити товар із каталогу? Дію не можна скасувати.")) return;
    try { await api("/product/" + id, { method: "DELETE" }); row.remove(); refreshStats(); }
    catch (err) { alert(err.message); }
  }

  if (btn.matches("[data-photo]")) {
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = "image/*";
    picker.onchange = async () => {
      if (!picker.files[0]) return;
      btn.disabled = true; btn.textContent = "Вантажимо…";
      const fd = new FormData(); fd.append("file", picker.files[0]);
      try {
        const r = await api("/photo/" + id, { method: "POST", body: fd });
        row.querySelector(".pic").innerHTML =
          `<img src="../assets/img/${esc(r.img)}.webp?t=${Date.now()}" alt="">`;
        btn.textContent = "Готово"; refreshStats();
      } catch (err) { alert(err.message); btn.textContent = "Фото"; }
      finally { btn.disabled = false; setTimeout(() => btn.textContent = "Фото", 1500); }
    };
    picker.click();
  }
});

/* ─── масове фото ─── */
$("#bulkPhotos").addEventListener("change", async e => {
  const files = [...e.target.files];
  if (!files.length) return;
  const msg = $("#bulkMsg");
  const done = [], skipped = [];
  for (let i = 0; i < files.length; i += 8) {
    const part = files.slice(i, i + 8);
    say(msg, `Завантажуємо ${Math.min(i + 8, files.length)} з ${files.length}…`, true);
    const fd = new FormData();
    part.forEach(f => fd.append("files", f));
    try {
      const r = await api("/photos", { method: "POST", body: fd });
      done.push(...r.done); skipped.push(...r.skipped);
    } catch (err) {
      part.forEach(f => skipped.push({ file: f.name, reason: err.message }));
    }
  }
  const lines = [`Поставлено: ${done.length} з ${files.length}.`];
  if (skipped.length) lines.push("Пропущено: " + skipped.map(s => `${s.file} (${s.reason})`).join("; ") + ".");
  say(msg, lines.join(" "), done.length > 0 && !skipped.length);
  refreshStats(); loadGoods();
  e.target.value = "";
});

/* ─── замовлення ─── */
async function loadOrders() {
  const box = $("#orders");
  box.innerHTML = `<p class="muted">Завантаження…</p>`;
  try {
    const r = await api("/orders?n=30");
    if (!r.items.length) { box.innerHTML = `<p class="muted">Замовлень поки немає.</p>`; return; }
    box.innerHTML = r.items.map(o => `<div class="order">
      <span class="pill">${esc(o.number)}</span> <b>${esc(o.name)}</b> · ${esc(o.phone)}
      <div class="meta">${esc(o.created)} · ${esc(o.how)} · ${esc(o.addr)} · ${esc(o.slot || "—")}</div>
      <ul>${o.items.map(i => `<li>${esc(i.name)} — ${i.qty} × ${uah(i.price)}</li>`).join("")}</ul>
      <div class="meta">Разом: <b>${uah(o.total)}</b>${o.note ? " · " + esc(o.note) : ""}</div>
    </div>`).join("");
  } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
}

/* ─── старт ─── */
(async () => {
  try { await api("/stats"); showApp(); }
  catch { showLogin(); }
})();
