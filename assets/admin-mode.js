/* ЇМО ВІРНО — режим адміна на вітрині.
   Підвантажується лише якщо /api/admin/me відповів «ok», тобто ви увійшли в адмінку.
   Використовує глобальні P, byId, IMG, esc, $, renderAll, renderSheet, renderGrid з app.js. */
(function () {
  const TAG_LIST = [["vegan", "Веган"], ["nolact", "Без лактози"], ["nogluten", "Без глютену"],
                    ["nosugar", "Без цукру"], ["hemp", "Конопляне"], ["farm", "Фермерське"]];
  let CATS = [];                  // 26 категорій з сервера
  let editing = null;             // код картки, що редагується; "new" — нова
  let photoNote = "";             // повідомлення про фото, яке показуємо після перемальовування

  async function api(path, opts = {}) {
    const r = await fetch("/api/admin" + path, { credentials: "same-origin", ...opts });
    let d = {};
    try { d = await r.json(); } catch (e) {}
    if (r.status === 413) throw new Error("Файл завеликий для сервера. Оновіть налаштування nginx (client_max_body_size).");
    if (r.status === 401) { alert("Сесія адміна завершилась. Увійдіть знову на /admin/"); location.reload(); throw new Error("401"); }
    if (!r.ok || d.ok === false) throw new Error(d.error || "Помилка " + r.status);
    return d;
  }
  const jsonPost = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  /* ─── стилі ─── */
  const css = document.createElement("style");
  css.textContent = `
  body{padding-top:36px}
  .adminbar{position:fixed;top:0;left:0;right:0;height:36px;z-index:60;background:#111;color:#f5e9e4;font:600 13px/1 var(--sans);
    display:flex;align-items:center;gap:14px;padding:9px 20px;flex-wrap:wrap}
  .adminbar b{letter-spacing:.06em;text-transform:uppercase;font-size:11px;background:var(--clay);color:#fff;border-radius:999px;padding:5px 10px}
  .adminbar a,.adminbar button{color:#f5e9e4;background:none;border:1px solid rgba(245,233,228,.3);border-radius:999px;padding:6px 12px;font:inherit;text-decoration:none;cursor:pointer}
  .adminbar button.primary{background:var(--clay);border-color:var(--clay);color:#fff}
  .adminbar .sp{flex:1}
  header.top{top:36px}
  .overlay{padding-top:52px}
  .card{position:relative}
  .aedit{position:absolute;right:10px;top:10px;z-index:3;border:0;border-radius:999px;background:#111;color:#fff;
    font:700 12px/1 var(--sans);padding:7px 11px;cursor:pointer;box-shadow:0 6px 14px -6px rgba(0,0,0,.6)}
  .aedit:hover{background:var(--clay-deep)}
  .noimg-flag{position:absolute;left:10px;bottom:10px;z-index:3;background:#b3402a;color:#fff;font:700 10px/1 var(--sans);border-radius:999px;padding:4px 8px}
  .aform{display:grid;gap:12px;font-size:14px;min-width:0}
  .aform>*,.aform .row2>*,.aphoto>*{min-width:0}
  .aform input[type=text],.aform input[type=number],.aform select,.aform textarea{width:100%;box-sizing:border-box}
  .aform label{display:grid;gap:5px;font-weight:600;font-size:12.5px}
  .aform input[type=text],.aform input[type=number],.aform select,.aform textarea{
    border:1px solid var(--line);border-radius:12px;padding:9px 12px;background:#fff;font:400 14px var(--sans);color:#111}
  .aform textarea{min-height:70px;resize:vertical}
  .aform .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .aform .checks{display:flex;flex-wrap:wrap;gap:6px 14px;font-weight:500}
  .aform .checks label{display:flex;align-items:center;gap:6px;font-weight:500;font-size:13px}
  .aform .hint{font-weight:400;color:var(--muted);font-size:12px}
  .aphoto{display:grid;grid-template-columns:120px 1fr;gap:14px;align-items:center;background:var(--blush);border-radius:16px;padding:12px}
  .aphoto .pv{width:120px;height:120px;border-radius:14px;background:#fff;overflow:hidden;display:grid;place-items:center;font-size:11px;color:var(--muted);text-align:center}
  .aphoto .pv img{width:100%;height:100%;object-fit:contain}
  .aphoto.drag{outline:2px dashed var(--clay);outline-offset:3px}
  .aphoto code{font-size:11px;word-break:break-all;color:var(--ink-2)}
  .abtns{display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;margin-top:6px}
  .abtns .btn{font-size:16px;padding:10px 24px}
  .adel{border:1px solid rgba(179,64,42,.45);color:#b3402a;background:transparent;border-radius:999px;padding:9px 16px;font:600 13px var(--sans);cursor:pointer}
  .aerr{color:#b3402a;font-size:13px;min-height:18px}
  .aok{color:#2e7d55;font-size:13px}
  @media(max-width:600px){.aform .row2{grid-template-columns:1fr}.aphoto{grid-template-columns:1fr}}
  `;
  document.head.append(css);

  /* ─── верхня панель ─── */
  const bar = document.createElement("div");
  bar.className = "adminbar";
  bar.innerHTML = `<b>Режим адміна</b><span>Редагуйте картки прямо на сайті</span><span class="sp"></span>
    <button class="primary" type="button" data-anew>+ Додати товар</button>
    <a href="/admin/">Адмінка</a>
    <button type="button" data-aout>Вийти</button>`;
  document.body.prepend(bar);
  bar.addEventListener("click", async e => {
    if (e.target.closest("[data-anew]")) startEdit("new");
    if (e.target.closest("[data-aout]")) {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
      location.reload();
    }
  });

  /* ─── кнопки на плитках каталогу ─── */
  const origGrid = renderGrid;
  renderGrid = function () {
    origGrid.apply(this, arguments);
    document.querySelectorAll("#grid .card").forEach(card => {
      const btn = card.querySelector("[data-open]");
      if (!btn || card.querySelector(".aedit")) return;
      const id = btn.dataset.open;
      const e = document.createElement("button");
      e.className = "aedit"; e.type = "button"; e.textContent = "✎ Редагувати"; e.dataset.aedit = id;
      card.append(e);
      if (byId[id] && !byId[id].img) {
        const f = document.createElement("span"); f.className = "noimg-flag"; f.textContent = "без фото";
        card.querySelector(".ph")?.append(f);
      }
    });
  };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-aedit]");
    if (b) { e.stopPropagation(); startEdit(b.dataset.aedit); }
  }, true);

  /* ─── картка товару: кнопка «Редагувати» або форма ─── */
  const origSheet = renderSheet;
  renderSheet = function () {
    if (editing) return renderEditor();
    origSheet.apply(this, arguments);
    if (!sheetId) return;
    const pc = document.querySelector("#sheet .pcard");
    if (pc && !pc.querySelector("[data-aedit]")) {
      const b = document.createElement("button");
      b.className = "aedit"; b.type = "button"; b.textContent = "✎ Редагувати картку"; b.dataset.aedit = sheetId;
      b.style.cssText = "position:absolute;right:18px;top:-14px";
      pc.style.position = "relative"; pc.append(b);
    }
  };

  async function startEdit(id) {
    if (!CATS.length) {
      try { CATS = (await api("/categories")).categories.map(c => c.name); } catch (e) { alert(e.message); return; }
    }
    editing = id;
    if (id !== "new") sheetId = id;
    if (!document.getElementById("overlay").classList.contains("open")) {
      if (id === "new") { sheetId = null; }
      document.getElementById("overlay").classList.add("open");
      document.body.style.overflow = "hidden";
    }
    renderEditor();
    document.getElementById("overlay").scrollTop = 0;
  }

  function stopEdit() {
    editing = null;
    if (!sheetId) { document.getElementById("overlay").classList.remove("open"); document.body.style.overflow = ""; }
    else renderSheet();
  }

  function renderEditor() {
    const isNew = editing === "new";
    const p = isNew ? { id: "", name: "", sub: "", brand: "", cat_name: "", price: "", tag: "", desc: "", sostav: "",
                        comp: [], ean: "", weighted: false, tags: [], sizes: [], colors: [], size_chart: "" }
                    : byId[editing];
    if (!p) { editing = null; return; }
    const imgSrc = !isNew && p.img ? IMG[p.img] : null;
    document.getElementById("sheet").innerHTML = `
    <button class="x" type="button" data-aclose aria-label="Закрити">✕</button>
    <div class="bc"><span class="brand">${isNew ? "НОВИЙ ТОВАР" : "РЕДАГУВАННЯ"}</span>${isNew ? "" : `<span class="cat">код ${esc(p.id)}</span>`}</div>
    <div class="pcard">
     <form class="aform" id="aform" novalidate>
      ${isNew ? `<label>Внутрішній код *<input type="text" name="id" inputmode="numeric" placeholder="Напр. 15420" required></label>` : ""}
      <div class="aphoto" id="aphoto">
        <div class="pv">${imgSrc ? `<img src="${imgSrc}" alt="">` : "немає фото"}</div>
        <div>
          <b style="font-size:13px">${imgSrc ? "Замінити фото" : "Додати фото"}</b>
          <p class="hint">Перетягніть файл сюди або <button type="button" class="linkadd" data-apick style="display:inline">виберіть на комп'ютері</button>.
          ${isNew ? "Фото можна додати після першого збереження." : ""}</p>
          ${!isNew ? `<p class="hint">Файл отримає назву:<br><code id="afname">${esc(fname(p))}</code></p>` : ""}
          <input type="file" accept="image/*" hidden id="afile">
          <div class="${photoNote ? "aok" : "aerr"}" id="aphotoMsg">${esc(photoNote)}</div>
        </div>
      </div>
      <label>Назва * <span class="hint">Enter — перенос рядка в картці</span>
        <textarea name="name" rows="2" required>${esc(p.name)}</textarea></label>
      <div class="row2">
        <label>Бренд<input type="text" name="brand" value="${esc(p.brand)}"></label>
        <label>Категорія<select name="cat_name">${CATS.map(c => `<option${c === p.cat_name ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      </div>
      <label>Підзаголовок <span class="hint">бренд · фасування · країна</span><input type="text" name="sub" value="${esc(p.sub)}"></label>
      <div class="row2">
        <label>Ціна, грн *<input type="number" name="price" min="0" step="1" value="${esc(p.price)}"></label>
        <label>Штрихкод<input type="text" name="ean" inputmode="numeric" value="${esc(p.ean || "")}"></label>
      </div>
      <div class="checks"><label><input type="checkbox" name="weighted"${p.weighted ? " checked" : ""}> ціна за 1 кг (ваговий)</label></div>
      <label>Підпис біля ціни <span class="hint">напр. «Ідеально до вина»</span><input type="text" name="tag" value="${esc(p.tag || "")}"></label>
      <label>Опис<textarea name="desc" rows="4">${esc(p.desc || "")}</textarea></label>
      <label>Склад<textarea name="sostav" rows="3">${esc(p.sostav || "")}</textarea></label>
      <label>Факти з «+» <span class="hint">кожен з нового рядка: харчова цінність, зберігання, країна</span>
        <textarea name="comp" rows="4">${esc((p.comp || []).join("\n"))}</textarea></label>
      <div><b style="font-size:12.5px">Позначки</b>
        <div class="checks" style="margin-top:6px">${TAG_LIST.map(([k, l]) =>
          `<label><input type="checkbox" name="tags" value="${k}"${(p.tags || []).includes(k) ? " checked" : ""}> ${l}</label>`).join("")}</div></div>
      <div class="row2">
        <label>Розміри <span class="hint">через кому</span><input type="text" name="sizes" value="${esc((p.sizes || []).join(", "))}"></label>
        <label>Кольори <span class="hint">через кому</span><input type="text" name="colors" value="${esc((p.colors || []).join(", "))}"></label>
      </div>
      <label>Таблиця розмірів <span class="hint">посилання, необов'язково</span><input type="text" name="size_chart" value="${esc(p.size_chart || "")}"></label>
      <div class="aerr" id="aerr"></div>
      <div class="abtns">
        <span style="display:flex;gap:10px">
          <button class="btn" type="submit">${isNew ? "Створити картку" : "Зберегти"}</button>
          <button class="linkadd" type="button" data-acancel>Скасувати</button>
        </span>
        ${isNew ? "" : `<button class="adel" type="button" data-adel>Видалити товар</button>`}
      </div>
     </form>
    </div>`;
    photoNote = "";
    wireEditor(p, isNew);
  }

  function fname(p) {   // та сама схема, що й на сервері — щоб ви бачили назву заздалегідь
    const tr = { а:"a",б:"b",в:"v",г:"h",ґ:"g",д:"d",е:"e",є:"ie",ж:"zh",з:"z",и:"y",і:"i",ї:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ь:"",ю:"iu",я:"ia",ы:"y",э:"e",ъ:"",ё:"e","'":"","’":"","ʼ":"" };
    const s = (t, n) => ([...String(t || "").toLowerCase()].map(c => tr[c] ?? c).join("")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n).replace(/-+$/, "")) || "bez-nazvy";
    return [s(p.brand || "bez-tm", 30), s(p.cat_name || "kategoriia", 40), s(String(p.name || "").replace(/\n/g, " "), 70),
            String(p.ean || "").replace(/\D/g, "") || "bez-shtrykhkodu", p.id].join("_").slice(0, 200) + ".webp";
  }

  function readForm(form) {
    const d = new FormData(form);
    return {
      ...(d.get("id") !== null ? { id: d.get("id") } : {}),
      name: d.get("name"), brand: d.get("brand"), cat_name: d.get("cat_name"), sub: d.get("sub"),
      price: d.get("price"), ean: d.get("ean"), weighted: !!d.get("weighted"), tag: d.get("tag"),
      desc: d.get("desc"), sostav: d.get("sostav"), comp: d.get("comp"),
      tags: d.getAll("tags"), sizes: d.get("sizes"), colors: d.get("colors"), size_chart: d.get("size_chart")
    };
  }

  function wireEditor(p, isNew) {
    const form = document.getElementById("aform");
    const err = document.getElementById("aerr");

    // жива підказка назви файлу
    const fn = document.getElementById("afname");
    if (fn) form.addEventListener("input", () => {
      const v = readForm(form); fn.textContent = fname({ ...v, id: p.id });
    });

    form.addEventListener("submit", async e => {
      e.preventDefault();
      err.textContent = "";
      const btn = form.querySelector("[type=submit]"); btn.disabled = true;
      try {
        const body = readForm(form);
        const r = isNew ? await jsonPost("/product", body) : await jsonPost("/product/" + p.id, body);
        const np = r.product;
        if (isNew) { P.push(np); } else { Object.assign(byId[np.id], np); }
        byId[np.id] = isNew ? np : byId[np.id];
        if (np.img) IMG[np.img] = "assets/img/" + np.img + ".webp" + (np.img_v ? "?v=" + np.img_v : "");
        toast(isNew ? "Картку створено" : "Збережено");
        if (isNew) { editing = np.id; sheetId = np.id; renderAll(); renderEditor(); }
        else { editing = null; renderAll(); renderSheet(); }
      } catch (ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; }
    });

    form.querySelector("[data-acancel]").onclick = () => stopEdit();
    form.querySelector("[data-adel]")?.addEventListener("click", async () => {
      if (!confirm(`Видалити «${String(p.name).replace(/\n/g, " ")}» з каталогу? Це не можна скасувати.`)) return;
      try {
        await api("/product/" + p.id, { method: "DELETE" });
        const i = P.findIndex(x => x.id === p.id); if (i > -1) P.splice(i, 1); delete byId[p.id];
        editing = null; sheetId = null;
        document.getElementById("overlay").classList.remove("open"); document.body.style.overflow = "";
        renderCats(); renderAll(); toast("Товар видалено");
      } catch (ex) { err.textContent = ex.message; }
    });

    // фото: вибір або перетягування
    const box = document.getElementById("aphoto"), input = document.getElementById("afile"), msg = document.getElementById("aphotoMsg");
    const upload = async file => {
      if (isNew) { msg.textContent = "Спершу збережіть картку, потім додайте фото."; return; }
      if (!file || !file.type.startsWith("image/")) { msg.textContent = "Це не зображення"; return; }
      msg.className = "aok"; msg.textContent = "Завантажуємо…";
      const fd = new FormData(); fd.append("file", file);
      try {
        const r = await api("/photo/" + p.id, { method: "POST", body: fd });
        byId[p.id].img = r.img; byId[p.id].img_v = r.img_v; byId[p.id].full = true;
        IMG[r.img] = "assets/img/" + r.img + ".webp?v=" + r.img_v;
        photoNote = "Фото збережено як " + r.file;
        renderAll();
      } catch (ex) { msg.className = "aerr"; msg.textContent = ex.message; }
    };
    form.querySelector("[data-apick]").onclick = () => input.click();
    input.onchange = () => upload(input.files[0]);
    ["dragenter", "dragover"].forEach(t => box.addEventListener(t, e => { e.preventDefault(); box.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(t => box.addEventListener(t, e => { e.preventDefault(); box.classList.remove("drag"); }));
    box.addEventListener("drop", e => upload(e.dataTransfer.files[0]));
  }

  // закриття хрестиком у режимі редагування
  document.addEventListener("click", e => {
    if (e.target.closest("[data-aclose]")) { editing = null; closeSheet(); }
  });

  renderGrid();
})();
