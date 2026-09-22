/* ЇМО ВІРНО — вітрина магазину. Дані тягнемо з assets/data/products.json */
let P=[];
const IMG={};
const TAGS=[["vegan","Веган"],["nolact","Без лактози"],["nogluten","Без глютену"],["nosugar","Без цукру"],["hemp","Конопляне"],["farm","Фермерське"]];
const TAGLABEL=Object.fromEntries(TAGS);
/* Розділи на головній: назва, що саме відкривають, який товар узяти для фото */
const SECTIONS=[
 {id:"sale",   title:"Акції",                sale:true},
 {id:"ready",  title:"Готові страви",        cats:["Готові страви та кулінарія"], cover:"assets/img/sec-ready.webp"},
 {id:"meat",   title:"М'ясне",               cats:["М'ясні продукти та ковбаси"]},
 {id:"dairy",  title:"Молочне і сири",       cats:["Молочні продукти та сири"]},
 {id:"fish",   title:"Риба і морепродукти",  cats:["Риба та морепродукти"]},
 {id:"supp",   title:"Добавки і суперфуди",  cats:["Дієтичні добавки, вітаміни та суперфуди"]},
 {id:"grocery",title:"Бакалія",              cats:["Бакалія, крупи, макарони","Спеції, приправи та трави","Олії, соуси, оцти та цукор","Консервація, оливки та овочі","Насіння, горіхи та сухофрукти","Джеми, пюре, мед, горіхові пасти","Яйця","Овочі, фрукти та зелень"]},
 {id:"sweets", title:"Солодощі і снеки",     cats:["Кондитерські вироби та солодощі","Хліб, хлібці, снеки та безглютенова випічка","Морозиво"], cover:"assets/img/sec-sweets.webp?v=2", coverFull:true},
 {id:"drinks", title:"Напої",                group:"drinks", cover:"assets/img/sec-drinks.webp"},
 {id:"home",   title:"Дім і побут",          cats:["Засоби побутового призначення"]},
 {id:"wear",   title:"Одяг і подарунки",     cats:["Одяг, взуття та аксесуари","Подарунки, декор та посуд"]},
];
const GROUPS=[["all","Усі товари"],["food","Їжа"],["drinks","Напої"],["care","Краса та здоров'я"],["home","Дім і побут"],["vegan","Веган"]];
const API="";   // той самий домен; для окремого API впишіть, напр. "https://shop.example.com"
const FEAT="15131", PAIRS=["3664","11788"];
const FREE=999, SHIP=49;
const byId={};
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const flat=s=>s.replace(/\n/g," ");
const photo=(p,cls)=>p.img?`<img class="${cls||""}${p.full?" full":""}" src="${IMG[p.img]}" alt="" loading="lazy">`
 :`<span class="noph"><b>${esc(p.brand)}</b><i>фото від постачальника</i></span>`;
const money=p=>uah(p.price)+(p.weighted?"/кг":"");
const baseId=key=>String(key).split("::")[0];
const variantOf=key=>{const [,s,c]=String(key).split("::");return [s,c].filter(Boolean).join(" · ")};
const keyFor=(id,size,color)=>size||color?`${id}::${size||""}::${color||""}`:String(id);
const prodOf=key=>byId[baseId(key)];
const needsChoice=p=>!!(p.needs_choice&&((p.sizes||[]).length||(p.colors||[]).length));
let pick={size:"",color:""};   // вибір у відкритій картці
const badges=(p,limit)=>{const list=(p.tags||[]).filter(k=>TAGLABEL[k]);if(!list.length)return "";
 const show=limit?list.slice(0,limit):list;
 return `<span class="tags">${show.map(k=>`<i class="tag t-${k}">${esc(TAGLABEL[k])}</i>`).join("")}${
   limit&&list.length>limit?`<i class="tag more">+${list.length-limit}</i>`:""}</span>`};
const uah=n=>n.toLocaleString("uk-UA")+" грн";

/* ---- state ---- */
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
let cart=store.get("polytsia-cart",{});
for(const k in cart){if(!(cart[k]>0))delete cart[k]}
let group="all", cats=new Set(), brands=new Set(), tags=new Set(), brandQ="", query="", sort="pop", drawerView="cart", lastFocus=null, sheetId=null;
let addr=store.get("polytsia-addr","");
const saveCart=()=>store.set("polytsia-cart",cart);

function setQty(id,q){q=Math.max(0,Math.min(99,q));if(q)cart[id]=q;else delete cart[id];saveCart();renderAll()}
function add(id,n=1){const was=cart[id]||0;setQty(id,was+n);const p=prodOf(id);if(!was&&p)toast("Додано: "+flat(p.name)+(variantOf(id)?", "+variantOf(id):""))}

/* ---- EAN-13 ---- */
const L=["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"],
G=["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"],
R=["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"],
PAR=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
function ean(code){const d=code.split("").map(Number),par=PAR[d[0]];let b="101";for(let i=1;i<7;i++)b+=(par[i-1]==="L"?L:G)[d[i]];b+="01010";for(let i=7;i<13;i++)b+=R[d[i]];b+="101";
 let r="";for(let i=0;i<b.length;i++)if(b[i]==="1"){const guard=i<3||(i>=45&&i<50)||i>=92;r+=`<rect x="${i}" y="0" width="1" height="${guard?40:36}"/>`}
 return `<svg class="ean" viewBox="0 0 95 40" fill="currentColor" aria-hidden="true" preserveAspectRatio="none">${r}</svg>`}
const eanTxt=c=>`${c[0]} ${c.slice(1,7)} ${c.slice(7)}`;

/* ---- stepper / add control ---- */
function control(id,size){const q=cart[id]||0,pr=prodOf(id);if(!pr)return "";const nm=esc(flat(pr.name));
 if(!q)return `<button class="btn" type="button" data-add="${id}" aria-label="Додати в кошик: ${nm}">В кошик</button>`;
 return `<span class="step ${size||""}" role="group" aria-label="Кількість: ${nm}"><button type="button" data-dec="${id}" aria-label="Менше">−</button><output>${q}</output><button type="button" data-inc="${id}" aria-label="Більше">+</button></span>`}

/* ---- render ---- */
function countIn(k){return k==="all"?P.length:k==="vegan"?P.filter(p=>p.vegan).length:P.filter(p=>p.g===k).length}
function renderCats(){
 $("#cats").innerHTML=GROUPS.map(([k,l])=>{const c=countIn(k);
  return `<button class="chip${c?"":" dim"}" type="button" data-g="${k}" aria-pressed="${group===k}">${l}<span class="c">${c}</span></button>`}).join("")}

/* товари поточної великої групи — основа для лівих фільтрів */
function pool(){return group==="all"?P:group==="vegan"?P.filter(p=>p.vegan):P.filter(p=>p.g===group)}

function renderSide(){
 const base=pool();
 const ql=query.trim().toLowerCase();
 const matchQ=p=>!ql||(p.name+" "+p.sub+" "+p.brand+" "+p.cat+" "+p.desc).toLowerCase().includes(ql);

 const catNames=[...new Set(base.map(p=>p.cat_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"uk"));
 $("#catList").innerHTML=catNames.length?catNames.map(n=>{
   const c=base.filter(p=>p.cat_name===n&&matchQ(p)&&(!brands.size||brands.has(p.brand))).length;
   return `<label class="fopt ${c?"":"off"}"><input type="checkbox" data-cat="${esc(n)}"${cats.has(n)?" checked":""}><span>${esc(n)}</span><span class="c">${c}</span></label>`;
 }).join(""):`<p class="fnone">Тут поки порожньо</p>`;

 const bq=brandQ.trim().toLowerCase();
 const names=[...new Set(base.map(p=>p.brand).filter(Boolean))]
   .filter(b=>!bq||b.toLowerCase().includes(bq))
   .map(b=>[b,base.filter(p=>p.brand===b&&matchQ(p)&&(!cats.size||cats.has(p.cat_name))).length])
   .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"uk"));
 $("#brandList").innerHTML=names.length?names.map(([b,c])=>
   `<label class="fopt ${c?"":"off"}"><input type="checkbox" data-brand="${esc(b)}"${brands.has(b)?" checked":""}><span>${esc(b)}</span><span class="c">${c}</span></label>`).join("")
   :`<p class="fnone">Нічого не знайшли</p>`;

 const tagNames=TAGS.filter(([k])=>base.some(p=>(p.tags||[]).includes(k)));
 const tagBox=$("#tagList");
 if(!tagNames.length){tagBox.innerHTML=`<p class="fnone">Немає позначок</p>`}
 else tagBox.innerHTML=tagNames.map(([k,l])=>{
   const c=base.filter(p=>(p.tags||[]).includes(k)&&matchQ(p)&&(!cats.size||cats.has(p.cat_name))&&(!brands.size||brands.has(p.brand))).length;
   return `<label class="fopt ${c?"":"off"}"><input type="checkbox" data-tag="${k}"${tags.has(k)?" checked":""}><span>${esc(l)}</span><span class="c">${c}</span></label>`}).join("");

 const active=cats.size+brands.size+tags.size;
 $("#resetF").hidden=!active;
 const badge=$("#filterN");
 badge.hidden=!active; badge.textContent=active;
}

function renderHero(){
 const p=byId[FEAT],q=cart[FEAT]||0;
 $("#feat").innerHTML=`<span class="pill">Хіт тижня</span>
  <h2>${esc(p.name)}</h2><p class="sub">${esc(p.sub)} · <span style="color:var(--clay);font-weight:400">${money(p)}</span></p>
  <p class="d">${esc(p.desc)}</p>
  <ul class="plus">${p.comp.slice(0,3).map(c=>`<li>${esc(c)}</li>`).join("")}</ul>
  <div class="buyrow"><button class="btn lg" type="button" data-buy="${p.id}">${q?"Оформити":"Купити"}</button>
  <span class="step" role="group" aria-label="Кількість"><button type="button" data-hdec aria-label="Менше">−</button><output id="hq">${Math.max(q,1)}</output><button type="button" data-hinc aria-label="Більше">+</button></span></div>`;
 $("#pairs").innerHTML=PAIRS.map(id=>{const x=byId[id],n=cart[id]||0;return `<div class="it">
  <button class="ph" type="button" data-open="${id}" aria-label="Детальніше: ${esc(flat(x.name))}">${photo(x)}</button>
  <div><b>${esc(flat(x.name))}</b><div class="pr">${money(x)}</div>
  ${n?`<span class="linkadd" style="text-decoration:none">У кошику</span>${control(id,"sm")}`:`<button class="linkadd" type="button" data-add="${id}">Додати до замовлення</button>`}</div></div>`}).join("")}

let heroQty=1;
function list(){
 const ql=query.trim().toLowerCase();
 let r=pool().filter(p=>(!cats.size||cats.has(p.cat_name))&&(!brands.size||brands.has(p.brand))
   &&(!tags.size||[...tags].every(k=>(p.tags||[]).includes(k)))
   &&(!ql||(p.name+" "+p.sub+" "+p.brand+" "+p.cat+" "+p.desc).toLowerCase().includes(ql)));
 const f={pop:(a,b)=>a.pop-b.pop,asc:(a,b)=>a.price-b.price,desc:(a,b)=>b.price-a.price,az:(a,b)=>flat(a.name).localeCompare(flat(b.name),"uk")}[sort];
 return r.sort(f)}
function plural(n){const a=n%10,b=n%100;return a===1&&b!==11?"товар":a>=2&&a<=4&&(b<12||b>14)?"товари":"товарів"}
function renderGrid(){
 const r=list();
 $("#shopTitle").textContent=(cats.size===1?[...cats][0]:(group==="all"?"Каталог":GROUPS.find(g=>g[0]===group)[1]));
 $("#meta").textContent=`${r.length} ${plural(r.length)}${query?` за запитом «${query}»`:""}`+(brands.size===1?` · ${[...brands][0]}`:"");
 $("#grid").innerHTML=r.length?r.map(p=>`<article class="card">
   <button class="ph" type="button" data-open="${p.id}" aria-label="Детальніше: ${esc(flat(p.name))}">${photo(p)}<span class="br">${esc(p.brand)}</span>${badges(p,2)}</button>
   <h3><button type="button" data-open="${p.id}">${esc(flat(p.name))}</button></h3>
   <p class="s">${esc(p.sub)}${(p.sizes||[]).length?` · ${esc(p.sizes.slice(0,4).join(" "))}${p.sizes.length>4?"…":""}`:""}</p>
   <div class="pr">${money(p)}</div>
   <div class="act">${needsChoice(p)?`<button class="btn" type="button" data-open="${p.id}">Обрати</button>`:control(p.id)}</div></article>`).join(""):
   (query?`<div class="empty">Нічого не знайшли за «${esc(query)}».<br><button class="btn" type="button" data-reset>Показати всі товари</button></div>`
    :`<div class="empty">У цій групі ще немає товарів.<br><span style="font-size:15px;color:var(--muted)">Заллємо, щойно буде готова таблиця категорії.</span><br><button class="btn" type="button" data-reset>Показати всі товари</button></div>`)}

function totals(){let n=0,s=0;for(const k in cart){const p=prodOf(k);if(!p)continue;n+=cart[k];s+=cart[k]*p.price}const ship=s===0||s>=FREE?0:SHIP;return{n,s,ship,t:s+ship}}
function renderHeader(){const t=totals();$("#cartN").textContent=t.n;$("#cartSum").textContent=uah(t.s);$("#cartBtn").setAttribute("aria-label",`Кошик: ${t.n} шт., ${uah(t.s)}`);$("#whereTxt").textContent=addr?addr:"Київ, оберіть адресу"}

function variantBlock(p){
 if(!needsChoice(p))return "";
 const row=(title,list,kind)=>list.length?`<div class="vrow"><b>${title}${kind==="size"&&p.size_chart!==false?` <button class="chartlink" type="button" data-chart>таблиця розмірів</button>`:""}</b>
   <div class="vopts">${list.map(v=>`<button class="vopt" type="button" data-pick="${kind}" data-val="${esc(v)}" aria-pressed="${pick[kind]===v}">${esc(v)}</button>`).join("")}</div></div>`:"";
 return `<div class="variants">${row("Розмір",p.sizes||[],"size")}${row("Колір",p.colors||[],"color")}</div>`}

function buyControl(p){
 const need=needsChoice(p);
 const key=need?keyFor(p.id,pick.size,pick.color):String(p.id);
 const ready=!need||((!(p.sizes||[]).length||pick.size)&&(!(p.colors||[]).length||pick.color));
 if(!ready)return `<button class="btn" type="button" disabled>Оберіть ${[(p.sizes||[]).length&&!pick.size?"розмір":"",(p.colors||[]).length&&!pick.color?"колір":""].filter(Boolean).join(" і ")}</button>`;
 const q=cart[key]||0;
 return q?`${control(key)}<button class="btn" type="button" data-cart>Перейти в кошик</button>`
         :`<button class="btn" type="button" data-add="${esc(key)}">В кошик</button>`}

function renderSheet(){
 if(!sheetId)return;const p=byId[sheetId],q=cart[p.id]||0;
 const idx=P.indexOf(p),next=P[(idx+1)%P.length];
 $("#sheet").innerHTML=`<button class="x" type="button" data-close aria-label="Закрити">✕</button>
 <div class="dots" aria-hidden="true"><i style="left:6%;top:2%"></i><i style="left:52%;top:1.5%"></i><i style="left:96%;top:30%"></i><i style="left:2%;top:40%"></i><i style="left:3%;top:84%"></i><i style="left:48%;top:95%"></i></div>
 <div class="bc"><span class="brand">${esc(p.brand)}</span><span class="cat">${esc(p.cat)}</span></div>
 <div class="pcard">
  <div class="top"><b>${money(p)}</b><span>${esc(p.tag||(p.weighted?"ціна за 1 кг":""))}</span></div>
  <div class="img">${p.img?`<img src="${IMG[p.img]}" alt="${esc(flat(p.name))}">`:photo(p)}</div>
  <h2 id="pName">${esc(p.name)}</h2>
  <p class="sub">${esc(p.sub)}</p>
  ${badges(p)}
  <p class="desc">${esc(p.desc)}</p>
  ${p.sostav?`<p class="sost"><b>Склад:</b> ${esc(p.sostav)}</p>`:""}
  <ul>${p.comp.map(c=>`<li>+ ${esc(c)}</li>`).join("")}</ul>
  ${variantBlock(p)}
  <div class="buy">${buyControl(p)}</div>
 </div>
 <div class="pfoot"><span class="ast" aria-hidden="true">*</span><span class="fc">${esc(p.sect||"МОЛОЧНІ ПРОДУКТИ ТА СИРИ")}</span>
  ${p.ean?`<span class="eanwrap" title="Штрихкод ${p.ean}">${ean(p.ean)}<small>${eanTxt(p.ean)}</small></span>`:`<span class="eanwrap"><small>АРТИКУЛ ${esc(p.id)}</small></span>`}
  <button class="nx" type="button" data-open="${next.id}" aria-label="Наступний товар: ${esc(flat(next.name))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M7 7l10 10M17 8v9H8"/></svg></button>
 </div>`}

function renderDrawer(){
 const t=totals(),ids=Object.keys(cart);
 const body=$("#dBody"),foot=$("#dFoot");
 if(drawerView==="done"){return}
 if(!ids.length){$("#dTitle").textContent="Кошик";body.innerHTML=`<div class="dempty">Кошик поки порожній<p>Додайте щось смачне з каталогу — ми зберемо замовлення як для себе.</p><button class="btn" type="button" data-shop>До каталогу</button></div>`;foot.innerHTML="";return}
 const left=Math.max(0,FREE-t.s),pct=Math.min(100,t.s/FREE*100);
 const freeBox=`<div class="free">${left?`До безкоштовної доставки ще <b>${uah(left)}</b>`:"Доставка безкоштовна"}<div class="track"><i style="width:${pct}%"></i></div></div>`;
 const sums=`<div class="row"><span>Товари, ${t.n} шт.</span><span>${uah(t.s)}</span></div><div class="row"><span>Доставка</span><span>${t.ship?uah(t.ship):"0 грн"}</span></div><div class="row tot"><span>Разом</span><span>${uah(t.t)}</span></div>`;
 if(drawerView==="cart"){
  $("#dTitle").textContent="Кошик";
  body.innerHTML=freeBox+ids.map(id=>{const p=prodOf(id);const v=variantOf(id);return `<div class="line"><div class="th">${photo(p)}</div>
   <div><b>${esc(flat(p.name))}</b><small>${v?esc(v)+" · ":""}${esc(p.sub)}</small></div>
   <div class="r"><strong>${uah(p.price*cart[id])}</strong>${control(id,"sm")}</div></div>`}).join("");
  foot.innerHTML=sums+`<button class="btn" type="button" data-checkout>Оформити замовлення</button>`;
 }else{
  $("#dTitle").textContent="Оформлення";
  const tm=new Date(),slots=[];for(let h=Math.max(9,tm.getHours()+2);h<=20;h+=2)slots.push(`Сьогодні, ${h}:00–${h+2}:00`);["9:00–11:00","12:00–14:00","18:00–20:00"].forEach(s=>slots.push("Завтра, "+s));
  body.innerHTML=`<form class="form" id="coForm" novalidate>
   <fieldset style="border:0;padding:0;margin:0"><legend style="font-size:13px;font-weight:500;margin-bottom:5px">Як отримати</legend>
   <div class="seg"><input type="radio" name="how" id="h1" value="courier" checked><label for="h1">Кур'єр</label><input type="radio" name="how" id="h2" value="pickup"><label for="h2">Самовивіз</label><input type="radio" name="how" id="h3" value="np"><label for="h3">Нова Пошта</label></div></fieldset>
   <label>Ім'я<input name="name" autocomplete="name" required></label>
   <label>Телефон<input name="phone" type="tel" autocomplete="tel" placeholder="+380" required></label>
   <label id="addrL">Адреса доставки<input name="addr" autocomplete="street-address" value="${esc(addr)}" placeholder="Вулиця, будинок, квартира" required></label>
   <label>Час<select name="slot">${slots.map(s=>`<option>${s}</option>`).join("")}</select></label>
   <label>Коментар для збирача<textarea name="note" placeholder="Наприклад: буррату — з найдовшим терміном"></textarea></label>
   <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
   <div class="err" id="coErr" role="alert"></div>
  </form>`;
  foot.innerHTML=sums+`<button class="btn" type="submit" form="coForm">Підтвердити · ${uah(t.t)}</button><button class="linkadd" type="button" data-back style="margin:12px auto 0">Повернутися до кошика</button>`;
  const f=$("#coForm");
  f.addEventListener("change",e=>{if(e.target.name==="how"){const v=e.target.value,l=$("#addrL");l.firstChild.textContent=v==="pickup"?"Супермаркет для самовивозу":v==="np"?"Відділення Нової Пошти":"Адреса доставки";l.querySelector("input").placeholder=v==="pickup"?"Наприклад: вул. Хрещатик, 1":v==="np"?"Місто, номер відділення":"Вулиця, будинок, квартира"}});
  f.addEventListener("submit",async e=>{e.preventDefault();
   const d=new FormData(f),btn=document.querySelector("[form=coForm]");
   const miss=[];if(!d.get("name").trim())miss.push("ім'я");if(!/^\+?[\d\s()-]{10,}$/.test(d.get("phone").trim()))miss.push("телефон у форматі +380…");if(!d.get("addr").trim())miss.push("адресу");
   if(miss.length){$("#coErr").textContent="Заповніть "+miss.join(", ")+".";return}
   $("#coErr").textContent="";btn.disabled=true;const label=btn.textContent;btn.textContent="Надсилаємо…";
   const payload={name:d.get("name").trim(),phone:d.get("phone").trim(),addr:d.get("addr").trim(),
     slot:d.get("slot"),note:(d.get("note")||"").trim(),how:d.get("how"),website:d.get("website")||"",
     items:Object.keys(cart).map(k=>{const [id,size,color]=String(k).split("::");return {id,qty:cart[k],size:size||"",color:color||""}})};
   let res=null;
   try{
     const r=await fetch(API+"/api/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
     res=await r.json();
     if(!r.ok||!res.ok)throw new Error(res&&res.error?res.error:"Сервер не прийняв замовлення");
   }catch(err){
     btn.disabled=false;btn.textContent=label;
     $("#coErr").textContent=(err&&err.message)||"Не вдалося надіслати замовлення. Перевірте зв'язок і спробуйте ще раз.";
     return;
   }
   addr=payload.addr;store.set("polytsia-addr",addr);
   const num=res.number,slot=payload.slot,sum=res.total||t.t;
   cart={};saveCart();drawerView="done";
   $("#dTitle").textContent="Готово";
   body.innerHTML=`<div class="done"><span class="pill">Замовлення прийнято</span><h3>Дякуємо, ${esc(payload.name)}!</h3><p><span class="num">${esc(num)}</span></p><p>${uah(sum)} · ${esc(slot)}<br>${esc(addr)}</p><p style="color:var(--muted);font-size:13px">Ми зателефонуємо, щоб підтвердити замовлення.</p></div>`;
   foot.innerHTML=`<button class="btn" type="button" data-shop>Продовжити покупки</button>`;
   renderAll(true)});
 }}

function sectionItems(s){
 if(s.sale)return P.filter(p=>p.sale);
 if(s.group)return P.filter(p=>p.g===s.group);
 return P.filter(p=>s.cats.includes(p.cat_name));
}

function renderSections(){
 $("#sgrid").innerHTML=SECTIONS.map((s,i)=>{
  const items=sectionItems(s);
  const pic=items.find(p=>p.img&&p.full)||items.find(p=>p.img);
  const cover=s.cover?`<img src="${s.cover}" alt="" loading="lazy" class="${s.coverFull?"full":"cover"}">`:null;
  const style=i%3===0?"wide":"";
  return `<button class="sec ${style}${items.length?"":" dim"}" type="button" data-sec="${s.id}" ${items.length?"":"disabled"}>
    <span class="sec-ph">${cover||(pic?`<img src="${IMG[pic.img]}" alt="" loading="lazy" class="${pic.full?"full":""}">`:`<span class="sec-noph"></span>`)}</span>
    <span class="sec-label"><b>${esc(s.title)}</b><i>${items.length?`${items.length} ${plural(items.length)}`:"незабаром"}</i></span>
  </button>`}).join("")}

function renderAll(keepDrawer){renderHeader();renderHero();renderSections();renderSide();renderGrid();renderSheet();if(!keepDrawer)renderDrawer()}

/* ---- overlays ---- */
function openChart(p){
 if(p&&p.size_chart&&/^https?:/i.test(p.size_chart)){window.open(p.size_chart,"_blank","noopener");return}
 $("#chartBox").innerHTML=`<button class="iconbtn" type="button" data-chartclose aria-label="Закрити">✕</button>
  <h3>Таблиця розмірів</h3>
  <table class="chart"><thead><tr><th>Розмір</th><th>Груди, см</th><th>Талія, см</th><th>Стегна, см</th></tr></thead><tbody>
   ${[["XS","82–86","62–66","88–92"],["S","86–90","66–70","92–96"],["M","90–94","70–74","96–100"],["L","94–100","74–80","100–106"],["XL","100–106","80–86","106–112"],["XXL","106–112","86–92","112–118"]]
     .map(r=>`<tr>${r.map((c,i)=>i?`<td>${c}</td>`:`<th>${c}</th>`).join("")}</tr>`).join("")}
  </tbody></table>
  <p class="muted">Заміри виробу можуть відрізнятися на 1–2 см. Якщо ваші мірки між розмірами, беріть більший.</p>`;
 $("#chartWrap").classList.add("open")}

function openSheet(id){pick={size:"",color:""};if(!$("#overlay").classList.contains("open"))lastFocus=document.activeElement;sheetId=id;renderSheet();$("#overlay").classList.add("open");$("#overlay").scrollTop=0;document.body.style.overflow="hidden";$("#sheet .x").focus()}
function closeSheet(){sheetId=null;$("#overlay").classList.remove("open");document.body.style.overflow="";lastFocus&&lastFocus.focus&&lastFocus.focus()}
function openDrawer(){if($("#overlay").classList.contains("open"))closeSheet();lastFocus=document.activeElement;if(drawerView==="done")drawerView="cart";renderDrawer();$("#drawer").classList.add("open");$("#drawer").setAttribute("aria-hidden","false");$("#dimmer").classList.add("open");document.body.style.overflow="hidden";$("#dClose").focus()}
function closeDrawer(){$("#drawer").classList.remove("open");$("#drawer").setAttribute("aria-hidden","true");$("#dimmer").classList.remove("open");document.body.style.overflow="";if(drawerView!=="cart"){drawerView="cart"}lastFocus&&lastFocus.focus&&lastFocus.focus()}
let tt;function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(tt);tt=setTimeout(()=>t.classList.remove("show"),1800)}

/* ---- events ---- */
document.addEventListener("click",e=>{
 const el=e.target.closest("button,[data-open]");if(!el)return;const d=el.dataset;
 if(d.sec){const s=SECTIONS.find(x=>x.id===d.sec);if(!s)return;
  group=s.group||"all";cats=new Set(s.cats||[]);brands.clear();tags.clear();query="";$("#q").value="";
  renderCats();renderSide();renderGrid();
  $("#shopTitle").textContent=s.title;
  document.getElementById("shop").scrollIntoView({behavior:"smooth"});return}
 if(d.g){group=d.g;cats.clear();brands.clear();if(d.g!=="vegan")tags.clear();renderCats();renderSide();renderGrid();document.getElementById("shop").scrollIntoView({behavior:"smooth"});return}
 if(d.add){add(d.add);return}
 if(d.inc){setQty(d.inc,(cart[d.inc]||0)+1);return}
 if(d.dec){setQty(d.dec,(cart[d.dec]||0)-1);return}
 if(d.pick){pick[d.pick]=(pick[d.pick]===d.val?"":d.val);renderSheet();return}
 if("chart" in d){openChart(byId[sheetId]);return}
 if(d.open){openSheet(d.open);return}
 if("close" in d){closeSheet();return}
 if("cart" in d){openDrawer();return}
 if("hinc" in d){heroQty=Math.min(99,(+$("#hq").textContent)+1);$("#hq").textContent=heroQty;return}
 if("hdec" in d){heroQty=Math.max(1,(+$("#hq").textContent)-1);$("#hq").textContent=heroQty;return}
 if(d.buy){const n=+$("#hq").textContent||1;if(!cart[d.buy])setQty(d.buy,n);openDrawer();return}
 if("checkout" in d){drawerView="checkout";renderDrawer();$("#dBody").scrollTop=0;return}
 if("back" in d){drawerView="cart";renderDrawer();return}
 if("shop" in d){drawerView="cart";closeDrawer();document.getElementById("shop").scrollIntoView({behavior:"smooth"});return}
 if("reset" in d){query="";$("#q").value="";group="all";cats.clear();brands.clear();tags.clear();renderCats();renderSide();renderGrid();return}
});
$("#cartBtn").onclick=openDrawer;$("#dClose").onclick=closeDrawer;$("#dimmer").onclick=closeDrawer;
$("#overlay").addEventListener("click",e=>{if(e.target.id==="overlay")closeSheet()});
$("#chartWrap").addEventListener("click",e=>{if(e.target.id==="chartWrap"||e.target.closest("[data-chartclose]"))$("#chartWrap").classList.remove("open")});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if($("#chartWrap").classList.contains("open")){$("#chartWrap").classList.remove("open");return}if($("#side").classList.contains("open")){$("#sideClose").click();return}if(!$("#setPop").hidden){$("#setPop").hidden=true;$("#setBtn").setAttribute("aria-expanded","false");$("#setBtn").focus();return}if(!$("#wherePop").hidden){$("#wherePop").hidden=true;$("#whereBtn").focus();return}if($("#overlay").classList.contains("open"))closeSheet();else if($("#drawer").classList.contains("open"))closeDrawer()});
$("#side").addEventListener("change",e=>{
 const el=e.target;
 if(el.dataset.cat){el.checked?cats.add(el.dataset.cat):cats.delete(el.dataset.cat)}
 else if(el.dataset.brand){el.checked?brands.add(el.dataset.brand):brands.delete(el.dataset.brand)}
 else if(el.dataset.tag){el.checked?tags.add(el.dataset.tag):tags.delete(el.dataset.tag)}
 else return;
 renderSide();renderGrid()});
let bqT;$("#brandQ").addEventListener("input",e=>{clearTimeout(bqT);bqT=setTimeout(()=>{brandQ=e.target.value;renderSide()},120)});
$("#resetF").onclick=()=>{cats.clear();brands.clear();tags.clear();brandQ="";$("#brandQ").value="";renderSide();renderGrid()};
const upBtn=$("#toTop");
upBtn.onclick=()=>window.scrollTo({top:0,behavior:"smooth"});
let upTick;addEventListener("scroll",()=>{if(upTick)return;upTick=setTimeout(()=>{upTick=null;
 upBtn.classList.toggle("show",scrollY>700)},150)},{passive:true});
$("#filterBtn").onclick=()=>{const s=$("#side");const open=s.classList.toggle("open");$("#filterBtn").setAttribute("aria-expanded",open);document.body.style.overflow=open?"hidden":""};
$("#sideClose").onclick=()=>{$("#side").classList.remove("open");$("#filterBtn").setAttribute("aria-expanded","false");document.body.style.overflow=""};
let qt;$("#q").addEventListener("input",e=>{clearTimeout(qt);qt=setTimeout(()=>{query=e.target.value;renderSide();renderGrid()},120)});
$("#q").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("shop").scrollIntoView({behavior:"smooth"})});
$("#sort").onchange=e=>{sort=e.target.value;renderGrid()};
$("#whereBtn").onclick=()=>{const pop=$("#wherePop"),o=pop.hidden;pop.hidden=!o;$("#whereBtn").setAttribute("aria-expanded",o);if(o){$("#whereIn").value=addr;$("#whereIn").focus()}};
$("#wherePop").addEventListener("submit",e=>{e.preventDefault();addr=$("#whereIn").value.trim();store.set("polytsia-addr",addr);$("#wherePop").hidden=true;$("#whereBtn").setAttribute("aria-expanded","false");renderHeader();toast(addr?"Адресу збережено":"Адресу очищено")});
function applyTheme(dark){const r=document.documentElement;if(dark)r.dataset.theme="dark";else r.dataset.theme="light";$("#darkSw").checked=dark}
applyTheme(store.get("yimo-theme","light")==="dark");
$("#darkSw").onchange=e=>{applyTheme(e.target.checked);store.set("yimo-theme",e.target.checked?"dark":"light")};
$("#setBtn").onclick=()=>{const pop=$("#setPop"),o=pop.hidden;pop.hidden=!o;$("#setBtn").setAttribute("aria-expanded",o);if(o)$("#darkSw").focus()};
document.addEventListener("click",e=>{const pop=$("#setPop");if(!pop.hidden&&!e.target.closest("#setPop,#setBtn")){pop.hidden=true;$("#setBtn").setAttribute("aria-expanded","false")}});

async function boot(){
  try{
    const r=await fetch("assets/data/products.json",{cache:"no-cache"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    P=await r.json();
  }catch(e){
    document.getElementById("grid").innerHTML='<div class="empty">Не вдалося завантажити каталог.<br><button class="btn" type="button" onclick="location.reload()">Спробувати ще</button></div>';
    console.error(e); return;
  }
  P.forEach(p=>{ if(p.img) IMG[p.img]="assets/img/"+p.img+".webp"+(p.img_v?"?v="+p.img_v:""); });
  P.forEach(p=>{ byId[p.id]=p; });
  for(const k in cart){ if(!prodOf(k)) delete cart[k]; }
  renderCats(); renderAll();
  // режим адміна: якщо ви увійшли в адмінку, підвантажуємо інструменти редагування
  try{
    const me=await fetch("/api/admin/me",{credentials:"same-origin",cache:"no-store"});
    const who=me.ok?await me.json():{};
    if(who.admin){const s=document.createElement("script");s.src="assets/admin-mode.js?v=1";document.body.append(s)}
  }catch(e){}
}
boot();
