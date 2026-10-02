// --- IO.JS : MODEL GİRİŞ/ÇIKIŞI (AÇILIŞ EKRANI, PROJE DOSYASI, SVG) ---
//
// Kesit bu dosyadaki üç yoldan birinden gelir ya da gider: hazır model (açılış
// ekranı), proje dosyası (v2.1 JSON) ve SVG dışa aktarımı. Veri
// buildProjectData()/loadProjectData() ile dosya okuma/yazmadan AYRI kurulur ki
// testlerde doğrudan çağrılabilsin.
//
// Yükleme sırası: calc.js → script.js → draw2d.js → io.js → script3d.js.

// === AÇILIŞ EKRANI (HAZIR MODELLER) ===
// Uygulama boş bir tuvalle açıldığında ne yapacağı belli olmuyordu. Açılışta bir
// seçim ekranı çıkar: yeni model, dosya aç ya da hazır bir örnek.
//
// Örnekler burulmada birbirinden AYRI şeyleri gösterir (yalnız ölçü değişikliği
// değil): dolu/boş kesitin verimi, ince cidarın etkisi, kompozitte ara yüzdeki
// gerilme sıçraması, τmak'ın kesitin İÇİNDE kalabilmesi, dikdörtgende çarpılma
// ve en/boy oranıyla değişen katsayılar.
//
// Kart görselleri SVG'dir ve MODELİN KENDİSİNDEN üretilir (`presetThumbSVG`);
// elle çizilmiş resim olsaydı ölçüler değiştiğinde sessizce yalan söylerdi.

const STARTUP_HIDE_KEY = 'torsionHideStartup';

const STARTUP_PRESETS = [
    {
        id: 'solid',
        name: 'Dolu Mil',
        desc: 'Ø100 · çelik · T = 1.5 kNm',
        torsion: '1.5',
        circles: [{ cx: 0, cy: 0, r: 50, ri: 0, G: 80 }]
    },
    {
        id: 'hollow',
        name: 'İçi Boş Mil',
        desc: 'Ø120/Ø60 · çelik · T = 1.5 kNm',
        torsion: '1.5',
        circles: [{ cx: 0, cy: 0, r: 60, ri: 30, G: 80 }]
    },
    {
        id: 'thin',
        name: 'İnce Cidarlı Boru',
        desc: 'Ø120 · t = 6 mm · T = 1.5 kNm',
        torsion: '1.5',
        circles: [{ cx: 0, cy: 0, r: 60, ri: 54, G: 80 }]
    },
    {
        id: 'composite',
        name: 'Kompozit Mil',
        desc: 'Çelik çekirdek + alüminyum kovan',
        torsion: '2.0',
        circles: [
            { cx: 0, cy: 0, r: 60, ri: 40, G: 27 },
            { cx: 0, cy: 0, r: 40, ri: 0, G: 80 }
        ]
    },
    {
        id: 'stiffcore',
        name: 'Rijit Çekirdekli Mil',
        desc: 'En büyük gerilme kesitin içinde',
        torsion: '2.0',
        circles: [
            { cx: 0, cy: 0, r: 60, ri: 50, G: 10 },
            { cx: 0, cy: 0, r: 50, ri: 0, G: 200 }
        ]
    },
    {
        id: 'triple',
        name: 'Üç Malzemeli Mil',
        desc: 'Ara yüzlerde gerilme sıçraması',
        torsion: '2.0',
        circles: [
            { cx: 0, cy: 0, r: 60, ri: 40, G: 27 },
            { cx: 0, cy: 0, r: 40, ri: 20, G: 80 },
            { cx: 0, cy: 0, r: 20, ri: 0, G: 200 }
        ]
    },
    {
        id: 'square',
        name: 'Kare Kesit',
        desc: '100 × 100 · Saint-Venant',
        torsion: '1.0',
        rect: { x1: -50, y1: -50, x2: 50, y2: 50, G: 80 }
    },
    {
        id: 'rect2',
        name: 'Dikdörtgen Kesit',
        desc: '40 × 80 (h/b = 2) · çarpılma',
        torsion: '1.2',
        rect: { x1: -20, y1: -40, x2: 20, y2: 40, G: 80 }
    }
];

// Kart metni: sözlükten (`preset_<id>` / `presetDesc_<id>`). t() eksik anahtarda
// anahtarın kendisini döndürdüğü için, çevirisi olmayan bir dilde model tanımındaki
// Türkçe metne düşülür — kartta "preset_solid" yazması yerine.
function presetText(p, field) {
    const key = (field === 'name' ? 'preset_' : 'presetDesc_') + p.id;
    const s = t(key);
    return s === key ? p[field] : s;
}

// Kart görseli: modelin kendi geometrisinden SVG. Renkler malzeme paletinden
// gelir, böylece kart tuvaldeki kesitle aynı görünür ve temayla birlikte değişir.
function presetThumbSVG(p) {
    const W = 220, H = 120, PAD = 12;

    // Sınırlayıcı kutu ve ölçek
    let span;
    if (p.rect) {
        span = { w: p.rect.x2 - p.rect.x1, h: p.rect.y2 - p.rect.y1 };
    } else {
        const r = Math.max(...p.circles.map(c => c.r));
        span = { w: 2 * r, h: 2 * r };
    }
    const s = Math.min((W - 2 * PAD) / span.w, (H - 2 * PAD) / span.h);
    const cx = W / 2, cy = H / 2;

    const parts = [];
    if (p.rect) {
        const mat = getMaterialColor(0);
        const w = span.w * s, h = span.h * s;
        parts.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" ` +
            `width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
            `fill="${mat.fill}" stroke="${mat.stroke}" stroke-width="1.5"/>`);
    } else {
        // Halkalar dıştan içe çizilir: iç parça üste gelsin (tuvaldeki sırayla aynı)
        p.circles.slice().sort((a, b) => b.r - a.r).forEach((c, i) => {
            const idx = p.circles.indexOf(c);
            const mat = getMaterialColor(idx);
            const R = c.r * s, Ri = (c.ri || 0) * s;
            if (Ri > 0.5) {
                // Halka: dış daire CW + iç daire CCW → evenodd ile ortası boş kalır
                parts.push(`<path d="M ${cx - R} ${cy} a ${R} ${R} 0 1 0 ${2 * R} 0 a ${R} ${R} 0 1 0 ${-2 * R} 0 ` +
                    `M ${cx - Ri} ${cy} a ${Ri} ${Ri} 0 1 0 ${2 * Ri} 0 a ${Ri} ${Ri} 0 1 0 ${-2 * Ri} 0" ` +
                    `fill="${mat.fill}" fill-rule="evenodd" stroke="${mat.stroke}" stroke-width="1.5"/>`);
            } else {
                parts.push(`<circle cx="${cx}" cy="${cy}" r="${R.toFixed(1)}" ` +
                    `fill="${mat.fill}" stroke="${mat.stroke}" stroke-width="1.5"/>`);
            }
        });
    }

    // Burulma momenti yayı — tuvaldeki Mb işaretinin küçük karşılığı
    const ar = Math.min(span.w, span.h) * s * 0.28 + 6;
    const a1 = -0.55 * Math.PI, a2 = 1.15 * Math.PI;
    const px = (a) => (cx + ar * Math.cos(a)).toFixed(1);
    const py = (a) => (cy + ar * Math.sin(a)).toFixed(1);
    parts.push(`<path d="M ${px(a1)} ${py(a1)} A ${ar.toFixed(1)} ${ar.toFixed(1)} 0 1 1 ${px(a2)} ${py(a2)}" ` +
        `fill="none" stroke="${MOMENT_COLOR}" stroke-width="2.5" stroke-linecap="round"/>`);
    // Ok ucu (yayın bitiş yönünde teğet)
    const tx = cx + ar * Math.cos(a2), ty = cy + ar * Math.sin(a2);
    const tang = a2 + Math.PI / 2, hl = 6;
    parts.push(`<path d="M ${tx.toFixed(1)} ${ty.toFixed(1)} ` +
        `L ${(tx - hl * Math.cos(tang - 0.4)).toFixed(1)} ${(ty - hl * Math.sin(tang - 0.4)).toFixed(1)} ` +
        `L ${(tx - hl * Math.cos(tang + 0.4)).toFixed(1)} ${(ty - hl * Math.sin(tang + 0.4)).toFixed(1)} Z" ` +
        `fill="${MOMENT_COLOR}"/>`);

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" ` +
        `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${presetText(p, 'name')}">${parts.join('')}</svg>`;
}

// Modeli tuvale uygular. clearAll() zaten hesabı ve çizimi tazeliyor; burada
// yalnız parçalar kurulup görünüm sığdırılır.
function applyStartupPreset(p) {
    clearAll();
    // Modeller kendi merkezlerine göre (0,0) tanımlıdır; tuvale konurken DÜNYA
    // MERKEZİNE taşınırlar — elle çizilen kesitler de oraya düşer (screenToGrid
    // tuval merkezini WORLD_SIZE/2'ye eşler). Doğrudan (0,0)'a konsalardı kesit
    // 2000×2000'lik dünyanın KÖŞESİNDE dururdu: eksenler, ölçü çizgileri ve
    // gerilme diyagramı dünyanın dışına taşar, kesit ortalanamazdı.
    const ox = WORLD_SIZE_X / 2, oy = WORLD_SIZE_Y / 2;
    if (p.rect) {
        rectangles.push(newRect(p.rect.x1 + ox, p.rect.y1 + oy, p.rect.x2 + ox, p.rect.y2 + oy));
        rectangles[0].G = p.rect.G;
    } else {
        // Büyükten küçüğe eklenir: renk sırası ve eş merkezlilik kenetlenmesi
        // tuvalde elle çizilmiş gibi olsun
        p.circles.forEach(c => {
            circles.push({
                type: 'circle', cx: c.cx + ox, cy: c.cy + oy, r: c.r, ri: c.ri || 0,
                G: c.G, colorIdx: (colorSeq++) % MATERIAL_COLOR_COUNT
            });
        });
    }
    if (inputs.tbTorsion) inputs.tbTorsion.value = p.torsion;

    hesapla();
    resizeCanvas();
    fitToScreen();
    updateShapesList();
    if (calc.errorState === null) call3D('showPip');
}

function shouldShowStartup() {
    return prefGet(STARTUP_HIDE_KEY) !== '1';
}

function closeStartupModal() {
    const m = document.getElementById('startupModal');
    if (m) m.style.display = 'none';
}

function openStartupModal() {
    const m = document.getElementById('startupModal');
    if (!m) return;
    renderStartupPresets();
    m.style.display = 'flex';
}

function renderStartupPresets() {
    const grid = document.getElementById('startupGrid');
    if (!grid) return;
    grid.innerHTML = '';
    STARTUP_PRESETS.forEach(p => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'startup-card';
        card.innerHTML =
            '<div class="startup-thumb">' + presetThumbSVG(p) + '</div>' +
            '<div class="startup-card-name"></div>' +
            '<div class="startup-card-desc"></div>';
        card.querySelector('.startup-card-name').textContent = presetText(p, 'name');
        card.querySelector('.startup-card-desc').textContent = presetText(p, 'desc');
        card.addEventListener('click', () => {
            applyStartupPreset(p);
            closeStartupModal();
        });
        grid.appendChild(card);
    });
}

function initStartupModal() {
    const m = document.getElementById('startupModal');
    if (!m) return;

    document.getElementById('startupNew').addEventListener('click', () => {
        clearAll();
        closeStartupModal();
    });
    document.getElementById('startupOpen').addEventListener('click', () => {
        closeStartupModal();
        const fi = document.getElementById('fileInput');
        if (fi) fi.click();
    });
    document.getElementById('startupClose').addEventListener('click', closeStartupModal);

    const cb = document.getElementById('startupHide');
    if (cb) {
        cb.addEventListener('change', () => {
            prefSet(STARTUP_HIDE_KEY, cb.checked ? '1' : '0');
        });
    }

    // Dil düğmeleri: çerçeve metinleri data-i18n ile, kart adları/açıklamaları
    // JS'te (`presetText`) çevrilir — applyTranslations DOM'a bakar, kartlar ise
    // her dil değişiminde yeniden kurulmalı.
    m.querySelectorAll('[data-startup-lang]').forEach(btn => {
        btn.addEventListener('click', () => {
            setLanguage(btn.getAttribute('data-startup-lang'));
            markStartupLang();
        });
    });
    markStartupLang();
    window.addEventListener('languageChanged', () => {
        markStartupLang();
        if (m.style.display !== 'none') renderStartupPresets();
    });

    // Kartlar temaya bağlı renk kullandığından tema değişince yeniden çizilir
    m.addEventListener('click', (e) => { if (e.target === m) closeStartupModal(); });

    if (shouldShowStartup()) openStartupModal();
}

function markStartupLang() {
    const cur = (typeof currentLanguage !== 'undefined') ? currentLanguage : 'tr';
    document.querySelectorAll('[data-startup-lang]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-startup-lang') === cur);
    });
}

// === DOSYA İŞLEMLERİ ===
// Kaydedilecek proje verisi (v2.1: dairesel parçalar + dikdörtgen/kare kesit)
function buildProjectData() {
    return {
        version: '2.1',
        calcMode: calcMode,
        circles: circles,
        rectangles: rectangles,
        gridSpacing: gridSpacing,
        // Profil elemanları profileDef'ten üretilir; rectangles türetilmiş veridir
        profile: profileDef ? Object.assign({}, profileDef) : null,
        viewState: viewState,
        inputs: {
            tbTorsion: inputs.tbTorsion ? inputs.tbTorsion.value : '1.50',
            // Otomatik moddayken yazılmaz: dosya açılınca kesitten yeniden kurulur
            barLength: barLengthAuto ? null : barLength
        }
    };
}

async function saveProject() {
    const json = JSON.stringify(buildProjectData(), null, 2);

    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'torsion_project.json',
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(json);
            await writable.close();
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error("Save error using File System Access API:", err);
        }
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'torsion_project.json';
    a.click();
    URL.revokeObjectURL(url);
}

function openProject() {
    document.getElementById('fileInput').click();
}

// Proje verisini uygular. buildProjectData() gibi test edilebilir olsun diye
// dosya okumadan ayrıldı; atlanan eleman sayısını döndürür.
// Kayıt formatının ANA sürümü. Yazılıp hiç okunmayan bir alan güvence değildir:
// ileride v3 bir dosya, reddedilmek yerine sessizce yanlış yüklenirdi.
const PROJECT_FORMAT_MAJOR = 2;

function loadProjectData(data) {
    let skipped = 0;

    // Sürüm yoksa v1 sayılır (alan eklenmeden önceki dosyalar) — o dosyalar
    // `holes` diziliyle zaten desteklenir. İleri sürüm okunmaz.
    const major = parseInt(String(data.version || '1').split('.')[0], 10);
    if (isFinite(major) && major > PROJECT_FORMAT_MAJOR) {
        throw new Error(t('fileVersionError').replace('{v}', data.version));
    }

    // Daireleri yükle (yalnızca tam daireler desteklenir)
    let loaded = [];
    if (Array.isArray(data.circles)) {
        data.circles.forEach((c, i) => {
            const subtype = c.subtype || 'full';
            if (subtype !== 'full' || !(c.r > 0)) { skipped++; return; }
            loaded.push({
                type: 'circle',
                cx: c.cx, cy: c.cy, r: c.r,
                ri: (typeof c.ri === 'number' && c.ri > 0 && c.ri < c.r) ? c.ri : 0,
                G: (typeof c.G === 'number' && c.G > 0) ? c.G : DEFAULT_G,
                colorIdx: (typeof c.colorIdx === 'number') ? c.colorIdx : (i % MATERIAL_COLOR_COUNT)
            });
        });
    }

    // Eski format: global daire boşluklarını eş merkezli halka iç yarıçapına dönüştür
    if (Array.isArray(data.holes)) {
        data.holes.forEach(h => {
            if (h.type !== 'circle' || (h.subtype && h.subtype !== 'full')) { skipped++; return; }
            const host = loaded.find(c =>
                Math.abs(c.cx - h.cx) < 1e-6 && Math.abs(c.cy - h.cy) < 1e-6 && h.r < c.r
            );
            if (host) {
                host.ri = Math.max(host.ri || 0, h.r);
            } else {
                skipped++;
            }
        });
    }

    // Dikdörtgen elemanlar (v2.1). Sayıları serbesttir — kesit ekleme
    // yoluyla kurulur; yalnızca dairesel parçalarla birlikte olamazlar.
    let loadedRects = [];
    if (Array.isArray(data.rectangles)) {
        data.rectangles.forEach((r, i) => {
            const ok = ['x1', 'y1', 'x2', 'y2'].every(k => typeof r[k] === 'number');
            if (!ok || Math.abs(r.x2 - r.x1) < 1e-9 || Math.abs(r.y2 - r.y1) < 1e-9) { skipped++; return; }
            if (loaded.length > 0) { skipped++; return; }
            loadedRects.push({
                type: 'rect',
                x1: Math.min(r.x1, r.x2), y1: Math.min(r.y1, r.y2),
                x2: Math.max(r.x1, r.x2), y2: Math.max(r.y1, r.y2),
                G: (typeof r.G === 'number' && r.G > 0) ? r.G : DEFAULT_G,
                colorIdx: (typeof r.colorIdx === 'number') ? r.colorIdx : (i % MATERIAL_COLOR_COUNT)
            });
        });
    }

    circles = loaded;
    rectangles = loadedRects;

    // Profil varsa elemanları ondan yeniden üretilir; dosyadaki
    // rectangles türetilmiş veridir, üzerine yazılır
    profileDef = null;
    const pf = data.profile;
    if (pf && PROFILE_KINDS[pf.kind]) {
        profileDef = {
            kind: pf.kind,
            bf: +pf.bf, bw: +pf.bw, tf: +pf.tf, tw: +pf.tw,
            G: (typeof pf.G === 'number' && pf.G > 0) ? pf.G : DEFAULT_G,
            cx: +pf.cx || 0, cy: +pf.cy || 0
        };
        circles = [];
        rebuildProfileRects();
        skipped = 0;
    }

    ringDraft = null;
    colorSeq = loaded.length + loadedRects.length;
    selectedElement = null;

    if (data.gridSpacing) {
        gridSpacing = data.gridSpacing;
        const tbGridSize = document.getElementById('tbGridSize');
        if (tbGridSize) tbGridSize.value = gridSpacing;
    }
    // Görünüm durumu SAYI SAYI alınır: elle düzenlenmiş bir dosyada eksik
    // minZoom/maxZoom, applyZoom'da NaN üretip tuvali boşaltıyordu.
    if (data.viewState) {
        const v = data.viewState;
        const num = (x, dflt) => (typeof x === 'number' && isFinite(x)) ? x : dflt;
        viewState = {
            zoom: Math.max(1e-6, num(v.zoom, viewState.zoom)),
            panX: num(v.panX, 0),
            panY: num(v.panY, 0),
            minZoom: num(v.minZoom, 0.01),
            maxZoom: num(v.maxZoom, 200.0)
        };
    }

    if (data.inputs) {
        if (data.inputs.tbTorsion !== undefined && inputs.tbTorsion) {
            inputs.tbTorsion.value = data.inputs.tbTorsion;
        }
        // Eski dosyalarda alan yok → otomatik boy (kesitin 10 katı)
        const savedLen = parseFloat(data.inputs.barLength);
        barLengthAuto = !isFinite(savedLen);
        if (!barLengthAuto) barLength = Math.max(0, savedLen);
    }

    updateAll();
    updateShapesList();
    if (!sectionIsEmpty() && calc.errorState === null) call3D('showPip');

    return skipped;
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const skipped = loadProjectData(JSON.parse(e.target.result));

            if (skipped > 0) {
                alert(t('loadSkippedInfo').replace('{n}', skipped));
            }

            if (statusLabel) statusLabel.textContent = t('statusReady');

        } catch (err) {
            console.error("Error parsing project file:", err);
            alert(t('fileReadError'));
        }
        if (event.target && event.target.value) {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

// === SVG EXPORT ===

class SVGContext {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.pathCmd = '';
        this.elements = [];
        this.currentStyle = {
            strokeStyle: '#000',
            fillStyle: '#000',
            lineWidth: 1,
            font: '10px sans-serif',
            lineDash: [],
            textAlign: 'start',
            textBaseline: 'alphabetic',
            globalAlpha: 1.0
        };
        this.transformStack = [];
        this.currentTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };
        this.canvas = { width: width, height: height, style: {} };
        this.isSVG = true;
    }

    set strokeStyle(v) { this.currentStyle.strokeStyle = v; }
    get strokeStyle() { return this.currentStyle.strokeStyle; }

    set fillStyle(v) { this.currentStyle.fillStyle = v; }
    get fillStyle() { return this.currentStyle.fillStyle; }

    set lineWidth(v) { this.currentStyle.lineWidth = v; }
    get lineWidth() { return this.currentStyle.lineWidth; }

    set font(v) { this.currentStyle.font = v; }
    get font() { return this.currentStyle.font; }

    set textAlign(v) { this.currentStyle.textAlign = v; }
    get textAlign() { return this.currentStyle.textAlign; }

    set textBaseline(v) { this.currentStyle.textBaseline = v; }
    get textBaseline() { return this.currentStyle.textBaseline; }

    set globalAlpha(v) { this.currentStyle.globalAlpha = v; }
    get globalAlpha() { return this.currentStyle.globalAlpha; }

    save() {
        this.transformStack.push({
            style: { ...this.currentStyle },
            transform: { ...this.currentTransform }
        });
    }

    restore() {
        if (this.transformStack.length > 0) {
            const state = this.transformStack.pop();
            this.currentStyle = state.style;
            this.currentTransform = state.transform;
        }
    }

    scale(sx, sy) {
        this.currentTransform.scaleX *= sx;
        this.currentTransform.scaleY *= sy;
    }

    translate(x, y) {
        this.currentTransform.x += x * this.currentTransform.scaleX;
        this.currentTransform.y += y * this.currentTransform.scaleY;
    }

    rotate(angle) {
        this.currentTransform.rotate += angle;
    }

    setTransform(a, b, c, d, e, f) {
        this.currentTransform = { x: e, y: f, scaleX: a, scaleY: d, rotate: 0 };
    }

    resetTransform() {
        this.currentTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };
    }

    set globalCompositeOperation(v) {
        this.currentStyle.globalCompositeOperation = v;
        if (v === 'destination-out' || v === 'xor') {
            this.forceWhiteFill = true;
        } else {
            this.forceWhiteFill = false;
        }
    }

    get globalCompositeOperation() { return this.currentStyle.globalCompositeOperation; }

    beginPath() {
        this.pathCmd = '';
    }

    moveTo(x, y) {
        const pt = this.transformPoint(x, y);
        this.pathCmd += `M ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
    }

    lineTo(x, y) {
        const pt = this.transformPoint(x, y);
        this.pathCmd += `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
    }

    closePath() {
        if (this.pathCmd) this.pathCmd += 'Z ';
    }

    rect(x, y, w, h) {
        this.moveTo(x, y);
        this.lineTo(x + w, y);
        this.lineTo(x + w, y + h);
        this.lineTo(x, y + h);
        this.closePath();
    }

    clip() {}
    createPattern() { return null; }

    // Gerilme haritası bir canvas dokusu olarak basılır. Kesit dışında alfa = 0
    // olduğundan kırpma gerekmez (clip burada zaten desteklenmiyor); doku gömülü
    // PNG olarak yazılır. image-rendering serbest bırakılır ki geçişler yumuşasın.
    drawImage(src, dx, dy, dw, dh) {
        if (!src || typeof src.toDataURL !== 'function') return;
        if (!(dw > 0) || !(dh > 0)) return;
        const p = this.transformPoint(dx, dy);
        const data = src.toDataURL();
        this.elements.push(
            `<image x="${p.x}" y="${p.y}" width="${dw * this.currentTransform.scaleX}" ` +
            `height="${dh * this.currentTransform.scaleY}" preserveAspectRatio="none" ` +
            `opacity="${this.currentStyle.globalAlpha}" href="${data}" xlink:href="${data}" />`
        );
    }

    ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterClockwise) {
        this.arc(x, y, radiusX, startAngle, endAngle, counterClockwise);
    }

    arc(x, y, r, startAngle, endAngle, counterClockwise = false) {
        const step = 0.1;

        // Yön dikkate alınarak açıları düzenle (nonzero dolgu kuralı için önemli)
        let delta = endAngle - startAngle;
        if (!counterClockwise && delta < 0) delta += Math.PI * 2;
        if (counterClockwise && delta > 0) delta -= Math.PI * 2;
        if (delta === 0) delta = counterClockwise ? -Math.PI * 2 : Math.PI * 2;

        const startX = x + r * Math.cos(startAngle);
        const startY = y + r * Math.sin(startAngle);
        const ptStart = this.transformPoint(startX, startY);

        if (this.pathCmd === '' || this.pathCmd.endsWith('Z ')) {
            this.pathCmd += `M ${ptStart.x.toFixed(2)} ${ptStart.y.toFixed(2)} `;
        } else {
            this.pathCmd += `L ${ptStart.x.toFixed(2)} ${ptStart.y.toFixed(2)} `;
        }

        const totalSteps = Math.ceil(Math.abs(delta) / step) || 1;
        const actualStep = delta / totalSteps;

        for (let i = 1; i <= totalSteps; i++) {
            const theta = startAngle + i * actualStep;
            const px = x + r * Math.cos(theta);
            const py = y + r * Math.sin(theta);
            const pt = this.transformPoint(px, py);
            this.pathCmd += `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
        }
    }

    stroke() {
        if (!this.pathCmd.trim()) return;
        const strokeColor = this.currentStyle.strokeStyle || '#000000';
        this.elements.push(`<path d="${this.pathCmd.trim()}" fill="none" stroke="${strokeColor}" stroke-width="${this.currentStyle.lineWidth}" stroke-dasharray="${this.currentStyle.lineDash.join(',')}" stroke-linecap="round" stroke-linejoin="round" opacity="${this.currentStyle.globalAlpha}" />`);
    }

    fill(fillRule) {
        if (!this.pathCmd.trim()) return;
        const rule = (fillRule === 'evenodd') ? 'evenodd' : 'nonzero';
        let color = this.currentStyle.fillStyle || '#000000';

        if (this.forceWhiteFill) color = '#FFFFFF';
        if (color === 'transparent') return;

        this.elements.push(`<path d="${this.pathCmd.trim()}" fill="${color}" stroke="none" fill-rule="${rule}" opacity="${this.currentStyle.globalAlpha}" />`);
    }

    strokeRect(x, y, w, h) {
        this.beginPath();
        this.rect(x, y, w, h);
        this.stroke();
    }

    fillRect(x, y, w, h) {
        this.beginPath();
        this.rect(x, y, w, h);
        this.fill();
    }

    setLineDash(segments) {
        this.currentStyle.lineDash = segments || [];
    }

    getLineDash() {
        return this.currentStyle.lineDash;
    }

    fillText(text, x, y) {
        if (!text) return;
        const pt = this.transformPoint(x, y);
        const safeText = text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        let anchor = 'start';
        if (this.currentStyle.textAlign === 'center') anchor = 'middle';
        if (this.currentStyle.textAlign === 'right') anchor = 'end';

        let fontSize = 10;
        let fontFamily = 'sans-serif';
        const fontParts = this.currentStyle.font.match(/(\d+)px\s+(.*)/);
        if (fontParts) {
            fontSize = fontParts[1];
            fontFamily = fontParts[2].replace(/['"]/g, '');
        }

        this.elements.push(`<text x="${pt.x}" y="${pt.y}" fill="${this.currentStyle.fillStyle}" font-family="${fontFamily}" font-size="${fontSize}" text-anchor="${anchor}" opacity="${this.currentStyle.globalAlpha}">${safeText}</text>`);
    }

    strokeText(text, x, y) {
        if (!text) return;
        const pt = this.transformPoint(x, y);
        const safeText = text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let anchor = 'start';
        if (this.currentStyle.textAlign === 'center') anchor = 'middle';
        if (this.currentStyle.textAlign === 'right') anchor = 'end';

        this.elements.push(`<text x="${pt.x}" y="${pt.y}" stroke="${this.currentStyle.strokeStyle}" stroke-width="${this.currentStyle.lineWidth}" fill="none" text-anchor="${anchor}">${safeText}</text>`);
    }

    // Ölçüm GERÇEK bir 2B bağlamdan gelir. Eskiden `uzunluk * 6` dönüyordu:
    // font boyutundan bağımsız olduğu için 13px Times'ta "R" %24 dar, 9px
    // Times'ta "dış" %71 geniş ölçülüyordu (tarayıcıda ölçüldü). Bu genişlik
    // yalnız bilgi değil, YERLEŞİM girdisidir: drawSubscriptLabel üç ayrı fontun
    // toplamıyla ortalar/sağa yaslar ve opak zemin dikdörtgenini ona göre çizer,
    // drawStressLegend de zemin genişliğini oradan alır — dışa aktarımda
    // etiketler ve ölçek zemini kayıyordu. Dışa aktarım tarayıcıda çalıştığından
    // ölçüm bağlamı zaten elimizin altında.
    measureText(text) {
        const mctx = SVGContext.measureCtx();
        if (mctx) {
            mctx.font = this.currentStyle.font;
            const m = mctx.measureText(text.toString());
            return {
                width: m.width,
                actualBoundingBoxAscent: m.actualBoundingBoxAscent || 10,
                actualBoundingBoxDescent: m.actualBoundingBoxDescent || 2
            };
        }
        // Bağlam kurulamazsa (canvas yok) font boyutundan kaba tahmin: en azından
        // 9px ile 13px arasındaki farkı görür.
        const px = parseFloat((this.currentStyle.font.match(/(\d+(?:\.\d+)?)px/) || [0, 10])[1]);
        return { width: text.toString().length * px * 0.52, actualBoundingBoxAscent: px * 0.75, actualBoundingBoxDescent: px * 0.2 };
    }

    // Ölçüm için tek bir gizli bağlam yeter; her çağrıda canvas kurmak pahalı
    static measureCtx() {
        if (SVGContext._mctx !== undefined) return SVGContext._mctx;
        try {
            SVGContext._mctx = document.createElement('canvas').getContext('2d');
        } catch (e) {
            SVGContext._mctx = null;
        }
        return SVGContext._mctx;
    }

    clearRect(x, y, w, h) {}

    transformPoint(x, y) {
        return {
            x: x * this.currentTransform.scaleX + this.currentTransform.x,
            y: y * this.currentTransform.scaleY + this.currentTransform.y
        };
    }

    getSerializedSvg() {
        return `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}" style="background-color: #fff">
    <!-- Created by Vetin -->
    ${this.elements.join('\n')}
</svg>
        `.trim();
    }
}

async function exportToSVG() {
    const originalCtx = ctx;
    try {
        const width = canvas.width;
        const height = canvas.height;

        const svgCtx = new SVGContext(width, height);

        ctx = svgCtx;
        draw();
        ctx = originalCtx;

        const svgContent = svgCtx.getSerializedSvg();

        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'burulma_kesit.svg',
                types: [{
                    description: t('svgFileType'),
                    accept: { 'image/svg+xml': ['.svg'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(svgContent);
            await writable.close();
        } else {
            const blob = new Blob([svgContent], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'burulma_kesit.svg';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        console.error('SVG Export Hatası:', err);
        ctx = originalCtx;

        if (err.name !== 'AbortError') {
            alert(t('svgExportError') + ' ' + err.message);
        }
    }
}
