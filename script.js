// --- SCRIPT.JS : UYGULAMA DURUMU VE ARAYÜZ ---
//
// Kesitin durumu (circles, rectangles, profileDef), görünüm (viewState), hesap
// sonucu (calc), tercihler, tema, araçlar, fare/klavye olayları, sağ panel ve
// başlatma burada durur. Hesabın kendisi calc.js'tedir (saf, DOM'suz); burası
// girdileri okuyup computeSection() çağırır (hesaplaCore) ve sonucu gösterir.
//
// Dosyalar klasik <script> olarak AYNI genel kapsamı paylaşır; sıra önemlidir:
//   calc.js → script.js → draw2d.js → io.js → script3d.js
// Sonraki dosyaların fonksiyonları buradan yalnız ÇAĞRI anında (init sonrası)
// kullanılır. script3d.js ile karşılıklı sözleşme açıkça yazılıdır: dosya
// sonundaki TorsionApp (3B'nin okuduğu her şey) ve script3d.js'teki View3D.

// === CANVAS VE DOM ELEMENTLERİ ===
const canvas = document.getElementById('mainCanvas');
let ctx = canvas.getContext('2d');

// Girdiler
const inputs = {
    tbTorsion: document.getElementById('tbTorsion'),
    tbTorsionSlider: document.getElementById('tbTorsionSlider')
};

// Çıktılar
const outputs = {
    valIx: document.getElementById('valIx'),
    valIy: document.getElementById('valIy'),
    valIxy: document.getElementById('valIxy'),
    valArea: document.getElementById('valArea'),
    valTauMax: document.getElementById('valTauMax'),
    valTauMin: document.getElementById('valTauMin'),
    valIpPolar: document.getElementById('valIpPolar'),
    valGIp: document.getElementById('valGIp'),
    valTheta: document.getElementById('valTheta'),
    valPhi: document.getElementById('valPhi')
};

// Kontroller
const controls = {
    cbAxes: document.getElementById('cbAxes'),
    cbStress: document.getElementById('cbStress'),
    cbStressMap: document.getElementById('cbStressMap'),
    cbForceVector: document.getElementById('cbForceVector'),
    cbPartBorders: document.getElementById('cbPartBorders'),
    cbDimensions: document.getElementById('cbDimensions'),
    cbGeometricCenter: document.getElementById('cbGeometricCenter'),
    cb3DView: document.getElementById('cb3DView')
};

// Status label
const statusLabel = document.getElementById('statusLabel');
const dimensionLabel = document.getElementById('dimensionLabel');

// === 3B GÖRÜNÜME ÇAĞRI ===
// 2B tarafın 3B'ye yaptığı BÜTÜN çağrılar buradan geçer; karşılığı script3d.js
// sonundaki window.View3D'dir (ters yön: app-api.js → TorsionApp). 3B modülü
// yüklenemezse (WebGL yok, dosya eksik) çağrı sessizce atlanır, 2B çalışır.
function call3D(name, ...args) {
    const v = window.View3D;
    if (v && typeof v[name] === 'function') return v[name](...args);
    return undefined;
}

// === GLOBAL DEĞİŞKENLER ===
// DEG2RAD, RAD2DEG ve DEFAULT_G calc.js'te tanımlıdır (hesabın sabitleri).

// Hesap modu: 'burulma'
const calcMode = 'burulma';

// İnce cidarlı profil (I/U/Z/T/L/kutu ve çok elemanlı kesit) ARAYÜZDE KAPALIDIR.
// Kod olduğu gibi duruyor — hesap, geometri, gerilme alanı ve testler yerinde;
// yalnızca kullanıcının bu kesitleri KURMASININ önü kapatılmıştır:
//   · profil aracı ve tip menüsü gizlenir,
//   · kesite ikinci bir dikdörtgen eklenemez (tek dikdörtgen kuralı geri gelir).
// Dosyadan yüklenen çok elemanlı kesitler yine hesaplanır; eski projeler bozulmasın.
// Yeniden açmak için tek yapılacak: bu sabiti true yapmak.
const PROFILE_UI_ENABLED = false;

// Çubuk boyu (mm). Yalnız 3B modelin uzunluğu değil, bağıl dönme açısının da
// dayanağıdır (φ = θ′·L) → 3B kapalıyken de gerekli, bu yüzden script3d.js'te
// değil burada durur. Otomatik boy kesitin 10 katıdır; kullanıcı bir değer
// girene dek her hesapta yenilenir, alan boşaltılınca otomatiğe döner.
let barLength = 500;
let barLengthAuto = true;

// Dönme açılarının gösterim birimi: teorinin doğal birimi radyandır, derece
// yalnızca okuma kolaylığı için sunulur. Tercih oturumlar arasında korunur.
let angleUnit = 'rad';   // 'rad' | 'deg'
const ANGLE_UNIT_KEY = 'torsionAngleUnit';

// Ekrana sığdırırken kesit tam ortaya değil, tuval yüksekliğinin bu kadarı kadar
// YUKARIYA konur (alttaki durum çubuğu ve ölçü yazıları için pay). fitToScreen ile
// constrainView bu sabiti PAYLAŞMAK ZORUNDADIR: sığdırmanın ürettiği kaydırma
// kırpma sınırının dışında kalırsa çizim ilk yeniden boyutlandırmada zıplar.
const FIT_VERTICAL_OFFSET = 0.05;

// Malzeme renk paleti (dolgu + kenar); her kesit parçasına sırayla atanır
// Palet tema başına ayrılır: açık temanın pastel dolguları koyu zeminde parlak
// birer leke gibi duruyordu, ozalitte ise mavi kâğıtla hiç uyuşmuyordu.
// 3B görünüm çubuk rengini BURADAN alır (script3d.js `paletteBarColors`): ilk
// malzemenin dolgu/kontur çifti. Eskiden o değerler get3DColors içinde tema başına
// elle kopyalanmıştı ve senkronu yalnız bir yorum tutuyordu. Diğer renkler de aynı
// mantıkla kurulur: koyu dolgu + parlak kontur.
const MATERIAL_PALETTES = {
    light: [
        { fill: '#D4E5EE', stroke: '#4E94B1' }, // mavi
        { fill: '#EADCF3', stroke: '#9B59B6' }, // mor
        { fill: '#DFF0E1', stroke: '#27AE60' }, // yeşil
        { fill: '#FDEBD0', stroke: '#E67E22' }, // turuncu
        { fill: '#FADBD8', stroke: '#C0392B' }, // kırmızı
        { fill: '#FCF3CF', stroke: '#B7950B' }  // sarı
    ],
    dark: [
        { fill: '#1E3A5F', stroke: '#3B82F6' }, // mavi — 3B çubuk rengi
        { fill: '#38265C', stroke: '#A78BFA' }, // mor
        { fill: '#14432C', stroke: '#34D399' }, // yeşil
        { fill: '#4A3117', stroke: '#FB923C' }, // turuncu
        { fill: '#4A2127', stroke: '#F87171' }, // kırmızı
        { fill: '#453A16', stroke: '#FACC15' }  // sarı
    ],
    // Ozalit: mavi kâğıt üzerine açık renk çizgi. Dolgular kâğıttan yalnızca
    // bir tık açık, konturlar belirgin — asıl bilgi çizgide.
    blueprint: [
        { fill: '#10395F', stroke: '#7EC8E3' }, // mavi — tema vurgu rengi
        { fill: '#2B2A5E', stroke: '#B3A8F0' }, // mor
        { fill: '#12401F', stroke: '#7BE88E' }, // yeşil
        { fill: '#45301B', stroke: '#F0B36A' }, // turuncu
        { fill: '#43242E', stroke: '#F2929F' }, // kırmızı
        { fill: '#37401F', stroke: '#DBE88A' }  // sarı
    ]
};

const MATERIAL_COLOR_COUNT = MATERIAL_PALETTES.light.length;

// Geçerli tema adı; tanımsız bir tema gelirse açık temaya düşer
function themeName() {
    const t = document.documentElement.getAttribute('data-theme') || 'light';
    return MATERIAL_PALETTES[t] ? t : 'light';
}

function getMaterialColor(index) {
    const palette = MATERIAL_PALETTES[themeName()];
    const i = ((index % palette.length) + palette.length) % palette.length;
    return palette[i];
}

function shapeColor(c, fallbackIndex) {
    const idx = (typeof c.colorIdx === 'number') ? c.colorIdx : fallbackIndex;
    return getMaterialColor(idx);
}

// Kesit elemanları: dolu daire (ri = 0) veya halka (ri > 0)
// { type:'circle', cx, cy, r, ri, G (GPa), colorIdx }
let circles = [];
let colorSeq = 0; // yeni eklenen kesite renk sırası

// Dikdörtgen/kare kesit: { type:'rect', x1, y1, x2, y2, G (GPa), colorIdx }
// Dairesel parçalarla aynı kesitte kullanılamaz: dairesel burulmada kesitler
// düzlem kalır (τ = G·θ'·ρ), dikdörtgende kesit çarpılır ve Saint-Venant çözümü
// gerekir — ikisi toplanamaz. TEK eleman kesin seriyle, birden çoğu ince cidarlı
// profil olarak çözülür (arayüzde tek elemanla sınırlı, bkz. PROFILE_UI_ENABLED).
let rectangles = [];

// Seçili eleman
let selectedElement = null; // { type: 'circle'|'rect', index: number }
let hoverElement = null;

// Seçim/resize parametreleri
const HANDLE_SIZE = 8; // px
const DELETE_HANDLE_SIZE = 16;
let deleteButtonBounds = null; // {x, y, w, h} ekran koordinatları

let isResizing = false;
// Halka aracı: üç tıkla çizilir (1: merkez, 2: çaplardan biri, 3: diğeri)
// { cx, cy, r1: null|number, hoverR: null|number }
let ringDraft = null;
let activeHandle = null; // 'tm','bm','ml','mr' (dış) / 'itm','ibm','iml','imr' (iç)
let isMoving = false;
let moveStart = { x: 0, y: 0 };
let editMode = false;

function getCursorForHandle(handleKey) {
    const key = handleKey && handleKey.startsWith('i') ? handleKey.slice(1) : handleKey;
    switch (key) {
        case 'tm':
        case 'bm':
            return 'ns-resize';
        case 'ml':
        case 'mr':
            return 'ew-resize';
        case 'body':
            return 'move';
        default:
            return editMode ? 'default' : 'grab';
    }
}

// Çizim aracı: 'circle', 'ring', 'move', 'pan'
let currentTool = 'circle';

// Izgara ayarları
let gridSpacing = 10;
const WORLD_SIZE_X = 2000;
const WORLD_SIZE_Y = 2000;

// Görünüm ayarları
let viewState = {
    zoom: 2.0,   // Mutlak ölçek (birim başına piksel)
    panX: 0,
    panY: 0,
    minZoom: 0.01,
    maxZoom: 200.0
};

// Başlangıç görünüm ayarlarını saklamak için
let initialViewState = null;

// Çizim durumu
let isDrawing = false;
let drawStart = { x: 0, y: 0 };
let drawEnd = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };

// Hesaplanan değerler — son computeSection() sonucu (alanlar ve anlamları:
// calc.js → emptyResult). Nesne hiç yeniden atanmaz, hesaplaCore yerinde yeniler.
const calc = emptyResult();

// === KALICI TERCİHLER ===
// localStorage'a erişim yalnız "dolu mu" sorusu değildir: gizli sekmede, gömülü
// webview'de ve site verisi kapalı tarayıcıda ERİŞİMİN KENDİSİ istisna atar.
// Tercihlerin çoğu zaten try/catch ile sarılmıştı; tema okuması sarılmamıştı ve
// init()'in İLK işi olduğu için uygulama hiç açılmıyordu. Tek kapıdan geçirmek
// hem o boşluğu kapatır hem de yenisinin açılmasını engeller.
function prefGet(key, fallback) {
    try {
        const v = localStorage.getItem(key);
        return (v === null) ? (fallback !== undefined ? fallback : null) : v;
    } catch (e) {
        return fallback !== undefined ? fallback : null;
    }
}

function prefSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}

// Tema anahtarı bilerek ön eksizdir: Vetin uygulamaları aynı origin'de tek bir
// tema tercihini paylaşır.
const THEME_KEY = 'theme';

// === TEMA YÖNETİMİ ===
function updateThemeSubmenuActive() {
    const currentTheme = prefGet(THEME_KEY, 'light');
    ['light', 'dark', 'blueprint'].forEach(t => {
        const btn = document.getElementById('submenu-theme-' + t);
        if (btn) btn.classList.toggle('active', t === currentTheme);
    });
}

// Ayarlar menüsünü kapatır. Menü öğeleri kendi işini yapmadan önce çağırır:
// belge düzeyindeki "dışarı tıklama" dinleyicisi menü İÇİNDEKİ tıklamayı
// kapatmaz, yoksa menü dosya seçicinin arkasında açık kalıyordu.
function closeSettingsMenu() {
    const m = document.getElementById('settingsMenuLeft');
    if (m) m.classList.remove('show');
}

function initTheme() {
    const savedTheme = prefGet(THEME_KEY, 'light');
    setTheme(savedTheme, false);

    const settingsMenuBtn = document.getElementById('settings-menu-toggle-left');
    const settingsMenu = document.getElementById('settingsMenuLeft');
    if (settingsMenuBtn && settingsMenu) {
        settingsMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsMenu.classList.toggle('show');
            // stopPropagation belge dinleyicisini atladığından uygulama menüsü elle kapanır
            document.getElementById('appSwitcherMenu')?.classList.remove('show');
            document.getElementById('btnAppSwitcher')?.setAttribute('aria-expanded', 'false');
        });
        document.addEventListener('click', (e) => {
            if (!settingsMenu.contains(e.target) && e.target !== settingsMenuBtn) {
                settingsMenu.classList.remove('show');
            }
        });
    }

    document.getElementById('submenu-theme-light')?.addEventListener('click', () => {
        if (settingsMenu) settingsMenu.classList.remove('show');
        setTheme('light');
    });
    document.getElementById('submenu-theme-dark')?.addEventListener('click', () => {
        if (settingsMenu) settingsMenu.classList.remove('show');
        setTheme('dark');
    });
    document.getElementById('submenu-theme-blueprint')?.addEventListener('click', () => {
        if (settingsMenu) settingsMenu.classList.remove('show');
        setTheme('blueprint');
    });

    const settingsAboutBtn = document.getElementById('settings-about-left');
    if (settingsAboutBtn) {
        settingsAboutBtn.addEventListener('click', () => {
            if (settingsMenu) settingsMenu.classList.remove('show');
            showAboutModal();
        });
    }

    updateThemeSubmenuActive();
}

// vetin uygulamaları arası geçiş menüsü (logonun yanındaki 3×3 simge).
// Kutucuklar düz bağlantıdır; burada yalnız aç/kapa ve klavye erişimi var.
function initAppSwitcher() {
    const btn = document.getElementById('btnAppSwitcher');
    const menu = document.getElementById('appSwitcherMenu');
    if (!btn || !menu) return;
    const setOpen = (open) => {
        menu.classList.toggle('show', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        // Menü tuvalin üstüne taşar; sol panelin yığın düzeyi araç çubuğunun altında kalıyordu
        document.getElementById('left-panel')?.classList.toggle('app-menu-open', open);
    };
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !menu.classList.contains('show');
        setOpen(open);
        if (open) closeSettingsMenu();
    });
    document.addEventListener('click', (e) => {
        if (menu.classList.contains('show') && !menu.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menu.classList.contains('show')) {
            setOpen(false);
            btn.focus();
        }
    });
}

function setTheme(theme, shouldRedraw = true) {
    document.documentElement.setAttribute('data-theme', theme);
    prefSet(THEME_KEY, theme);
    updateThemeSubmenuActive();

    if (shouldRedraw) {
        setTimeout(() => {
            if (typeof draw === 'function') draw();
            call3D('update');
            call3D('updateTheme');
            // Açılış kartları SVG'yi malzeme paletinden üretir: tema değişti, yenile
            const su = document.getElementById('startupModal');
            if (su && su.style.display !== 'none' && typeof renderStartupPresets === 'function') {
                renderStartupPresets();
            }
        }, 0);
    }
}

function showAboutModal() {
    const lang = (typeof currentLanguage !== 'undefined' && currentLanguage) || 'tr';
    const tr = (typeof translations !== 'undefined' && translations[lang]) || (typeof translations !== 'undefined' && translations['tr']) || {};
    const title    = tr.aboutTitle    || 'Hakkında';
    // Alt başlık modül adıdır (Burulma). translations.js'teki aboutTagline eski
    // "kesit özellikleri" projesinden kalma olduğu için kullanılmaz.
    const tagline  = torsionModeLabel();
    const version  = tr.aboutVersion  || 'v1.0 · MIT Lisansı';
    const content  = tr.aboutContent  || '';
    const content2 = tr.aboutContent2 || 'Vetin ekosistemindeki diğer akademik çözümlere şu adresten ulaşabilirsiniz:';
    const closeText = tr.aboutClose   || 'Tamam';

    let backdrop = document.getElementById('about-modal-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'about-modal-backdrop';
        backdrop.className = 'ps-about-modal-backdrop';
        document.body.appendChild(backdrop);
    }
    backdrop.innerHTML = `
        <div class="ps-about-modal" role="dialog" aria-modal="true">
            <div class="ps-about-modal-grid">
                <div class="ps-about-modal-left">
                    <div class="ps-about-modal-left-content">
                        <img src="logo.svg" alt="Vetin" class="ps-about-logo">
                        <div class="ps-about-modal-tagline">${tagline}</div>
                        <div class="ps-about-modal-version">${version}</div>
                    </div>
                    <a href="http://www.iuc.edu.tr" target="_blank" rel="noopener noreferrer" class="ps-about-iuc-link">
                        <img src="IUC.svg" alt="IUC" class="ps-about-iuc-logo">
                    </a>
                </div>
                <div class="ps-about-modal-right">
                    <h2>${title}</h2>
                    <div class="ps-about-modal-body">
                        <p>${content}</p>
                        <p><span>${content2}</span> <a href="https://www.rasimtemur.com/vetin/" target="_blank" rel="noopener noreferrer">rasimtemur.com/vetin</a></p>
                    </div>
                    <div class="ps-about-modal-footer">
                        <button id="ps-about-modal-close">${closeText}</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    backdrop.classList.add('show');
    document.getElementById('ps-about-modal-close').addEventListener('click', () => backdrop.classList.remove('show'));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.classList.remove('show'); });
}

// === CANVAS RENK YÖNETİMİ ===
// Tuval renkleri. Ozalit önceden koyu temanın kopyasıydı (yalnızca ızgara rengi
// ayrılıyordu); bu yüzden mavi kâğıt yerine siyaha yakın bir zemin ve koyu
// temanın mavileri çiziliyordu. Üç tema da kendi paletini verir; kesit dolgusu
// MATERIAL_PALETTES'in ilk rengiyle aynı tutulur.
const CANVAS_PALETTES = {
    light: {
        gridLine: '#e8e8e8',
        gridLineMajor: '#c8c8c8',
        background: '#FFFFFF',
        sectionFill: '#D4E5EE',
        sectionStroke: '#4E94B1',
        previewFill: 'rgba(212, 229, 238, 0.5)',
        previewStroke: '#4E94B1',
        previewCutFill: 'rgba(255, 0, 0, 0.2)',
        previewCutStroke: '#ff0000',
        textColor: '#000000',
        labelBg: 'rgba(255, 255, 255, 0.72)'
    },
    dark: {
        gridLine: '#1E293B',
        gridLineMajor: '#2A3A4F',
        background: '#0F1419',
        sectionFill: '#1E3A5F',
        sectionStroke: '#3B82F6',
        previewFill: 'rgba(30, 58, 95, 0.5)',
        previewStroke: '#3B82F6',
        previewCutFill: 'rgba(255, 0, 0, 0.3)',
        previewCutStroke: '#FF4444',
        textColor: '#F0F0F0',
        labelBg: 'rgba(15, 20, 25, 0.72)'
    },
    blueprint: {
        gridLine: '#173F6B',
        gridLineMajor: '#26558F',
        background: '#0A1929',          // --fluent-layer-fill-default ile aynı
        sectionFill: '#10395F',
        sectionStroke: '#7EC8E3',       // --fluent-accent-fill-rest
        previewFill: 'rgba(16, 57, 95, 0.5)',
        previewStroke: '#7EC8E3',
        previewCutFill: 'rgba(255, 107, 107, 0.3)',
        previewCutStroke: '#FF6B6B',
        textColor: '#DDEEFF',
        labelBg: 'rgba(6, 18, 32, 0.78)'
    }
};

function getCanvasColors() {
    return CANVAS_PALETTES[themeName()];
}

// === SAYFA BAŞLIĞI ===
// Mod adı sözlükten gelir. Eskiden burada 19 dillik AYRI bir tablo duruyordu:
// desteklenen 33 dilin 14'ünde İngilizceye düşüyor, listede olmayan bir dili
// (az) taşıyor ve dil eklendiğinde güncellenmesi unutuluyordu. Tek sözlük.
function torsionModeLabel() {
    return t('modeTorsion');
}

function updateTorsionTitle() {
    const title = 'vetin : ' + torsionModeLabel();
    document.title = title;
    const el = document.querySelector('[data-bending-title]');
    if (el) el.textContent = title;
}

// === BAŞLATMA ===
function init() {
    initTheme();
    initAppSwitcher();
    initAngleUnit();
    initStressScale();

    updateTorsionTitle();
    window.addEventListener('languageChanged', updateTorsionTitle);

    setupEventListeners();

    // Başlangıç görünüm ayarlarını kaydet
    initialViewState = { ...viewState };

    // Açılışta kutu işaretliyse geçişi yine tek sahibi kursun (sınıflar, panel
    // görünürlüğü ve kamera sığdırması hep aynı yerden gelsin)
    if (controls.cb3DView && controls.cb3DView.checked) call3D('toggle', true);

    initPanelResizer();

    // Uygulama başlangıcında dolu daire aracı seçili olsun
    setTool('circle');

    // Grid aralığını başlat
    const tbGridSize = document.getElementById('tbGridSize');
    if (tbGridSize) {
        const val = parseFloat(tbGridSize.value);
        if (val > 0) gridSpacing = val;
    }

    // Boyutları hesapla ve çiz
    setTimeout(() => {
        resizeCanvas();
        updateAll();
        // Açılış ekranı tuval ölçüldükten SONRA: hazır model seçilince
        // fitToScreen doğru canvas boyutuyla çalışsın
        initStartupModal();
    }, 50);
}

function initAngleUnit() {
    angleUnit = (prefGet(ANGLE_UNIT_KEY) === 'deg') ? 'deg' : 'rad';
    document.querySelectorAll('[data-angle-unit]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-angle-unit') === angleUnit);
    });
}

function resizeCanvas() {
    const wrapper = document.getElementById('canvas-content-wrapper');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();

    canvas.width = rect.width;
    canvas.height = rect.height;

    constrainView();
    draw();
}

// === EVENT LİSTENERLARI ===
function setupEventListeners() {
    // Canvas boyut değişikliği
    window.addEventListener('resize', resizeCanvas);

    // Dil seçimi
    document.querySelectorAll('.language-switcher button[data-lang]').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.getAttribute('data-lang');
            setLanguage(lang);

            document.querySelectorAll('.language-switcher button[data-lang], .more-langs-dropdown button[data-lang]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const dd = document.getElementById('moreLangsDropdown');
            if (dd) dd.style.display = 'none';
        });
    });

    // Ek dil dropdown
    const moreLangs = [
        'es','it','pt','fa','hi','ne','hy','el','ro','id',
        'tl','ja','ko','ru','ar','bn','fr','my','th','uz',
        'dz','tg','ky','bg','he','sl','sq','ka','ur'
    ];
    const dropdown = document.createElement('div');
    dropdown.id = 'moreLangsDropdown';
    dropdown.className = 'more-langs-dropdown';
    dropdown.style.display = 'none';
    moreLangs.forEach(lang => {
        const btn = document.createElement('button');
        btn.setAttribute('data-lang', lang);
        btn.textContent = lang.toUpperCase();
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            setLanguage(lang);
            document.querySelectorAll('.language-switcher button[data-lang]').forEach(b => b.classList.remove('active'));
            dropdown.querySelectorAll('button[data-lang]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            dropdown.style.display = 'none';
        });
        dropdown.appendChild(btn);
    });
    document.body.appendChild(dropdown);

    const btnMore = document.getElementById('btnMoreLanguages');
    if (btnMore) {
        btnMore.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown.style.display === 'none') {
                dropdown.style.display = 'grid';
                const rect = btnMore.getBoundingClientRect();
                const ddRect = dropdown.getBoundingClientRect();
                dropdown.style.left = Math.max(4, rect.right - ddRect.width) + 'px';
                dropdown.style.top = (rect.top - ddRect.height - 6) + 'px';
            } else {
                dropdown.style.display = 'none';
            }
        });
    }

    document.addEventListener('click', () => {
        dropdown.style.display = 'none';
    });

    // Araç seçimi
    const btnCircle = document.getElementById('btnCircle');
    if (btnCircle) btnCircle.addEventListener('click', () => setTool('circle'));
    const btnRing = document.getElementById('btnRing');
    if (btnRing) btnRing.addEventListener('click', () => setTool('ring'));
    const btnRect = document.getElementById('btnRect');
    if (btnRect) btnRect.addEventListener('click', () => setTool('rect'));
    initProfileKindMenu();

    // Zoom butonları
    document.getElementById('btnZoomIn')?.addEventListener('click', () => applyZoom(1.2));
    document.getElementById('btnZoomOut')?.addEventListener('click', () => applyZoom(1 / 1.2));
    document.getElementById('btnResetView')?.addEventListener('click', fitToScreen);

    // Dosya butonları
    const btnSideOpen = document.getElementById('btnSideOpen');
    const btnSideSave = document.getElementById('btnSideSave');
    // Dosya işlemleri artık ayarlar menüsünde: tıklamadan sonra menü kapanmalı
    // (tema ve Hakkında öğeleri de öyle yapıyor; menü dışına tıklama dinleyicisi
    // menünün İÇİNDEKİ tıklamayı kapatmaz).
    if (btnSideOpen) btnSideOpen.addEventListener('click', () => { closeSettingsMenu(); openProject(); });
    if (btnSideSave) btnSideSave.addEventListener('click', () => { closeSettingsMenu(); saveProject(); });

    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);

    // Temizle (onay modalı ile)
    const modalConfirm = document.getElementById('confirmModal');
    const btnConfirmYes = document.getElementById('btnConfirmYes');
    const btnConfirmNo = document.getElementById('btnConfirmNo');

    // Pan aracı
    const btnPan = document.getElementById('btnPan');
    if (btnPan) {
        btnPan.addEventListener('click', () => setTool('pan'));
    }

    document.getElementById('btnClearAll')?.addEventListener('click', () => {
        if (modalConfirm) modalConfirm.style.display = 'flex';
    });

    if (btnConfirmYes) {
        btnConfirmYes.onclick = () => {
            clearAll();
            if (modalConfirm) modalConfirm.style.display = 'none';
        };
    }

    if (btnConfirmNo) {
        btnConfirmNo.onclick = () => {
            if (modalConfirm) modalConfirm.style.display = 'none';
        };
    }

    if (modalConfirm) {
        modalConfirm.onclick = (e) => {
            if (e.target === modalConfirm) modalConfirm.style.display = 'none';
        };
    }

    // SVG Export
    const btnExportSVG = document.getElementById('btnExportSVG');
    if (btnExportSVG) {
        btnExportSVG.addEventListener('click', () => { closeSettingsMenu(); exportToSVG(); });
    }

    // Sürükle-bırak ile proje açma
    canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        canvas.style.borderColor = 'var(--fluent-accent-fill-rest)';
    });
    canvas.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        canvas.style.borderColor = 'var(--fluent-stroke-color-default)';
    });
    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        canvas.style.borderColor = 'var(--fluent-stroke-color-default)';

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelect({ target: { files: e.dataTransfer.files } });
        }
    });

    // Düzenleme modu
    document.getElementById('btnEditMode')?.addEventListener('click', () => {
        editMode = !editMode;
        if (!editMode) {
            clearElementSelection();
            setTool('circle');
        } else {
            setTool('move');
        }
        draw();
    });

    // Liste dışına tıklandığında seçimleri temizle
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.shapes-list-container') && !editMode) {
            clearElementSelection();
        }
    });

    // Delete tuşu ile seçili elemanı sil
    document.addEventListener('keydown', (e) => {
        // Esc: yarım kalan halka taslağını iptal et
        if (e.key === 'Escape' && ringDraft) {
            ringDraft = null;
            if (dimensionLabel) dimensionLabel.style.display = 'none';
            updateStatus();
            draw();
            return;
        }
        if (e.key === 'Delete' && selectedElement) {
            if (selectedElement.type === 'circle') {
                circles.splice(selectedElement.index, 1);
                ringDraft = null;
            } else if (selectedElement.type === 'rect') {
                rectangles.splice(selectedElement.index, 1);
            }
            clearElementSelection();
            hesapla();
            draw();
        }
    });

    // Burulma momenti: sayısal alan ve kaydırıcı birbirini günceller
    if (inputs.tbTorsion) {
        inputs.tbTorsion.addEventListener('input', () => {
            syncTorsionSlider();
            scheduleTorsionUpdate();
        });
    }

    if (inputs.tbTorsionSlider) {
        syncTorsionSlider();
        inputs.tbTorsionSlider.addEventListener('input', () => {
            const v = parseFloat(inputs.tbTorsionSlider.value);
            if (!isFinite(v)) return;
            inputs.tbTorsion.value = v.toFixed(1);
            scheduleTorsionUpdate();
        });
        // Çift tıklama momenti sıfırlar (şekil değiştirmesiz duruma dön)
        inputs.tbTorsionSlider.addEventListener('dblclick', () => {
            inputs.tbTorsion.value = '0.0';
            syncTorsionSlider();
            scheduleTorsionUpdate();
        });
    }

    // Görselleştirme toggleları
    if (controls.cbAxes) controls.cbAxes.addEventListener('change', draw);
    // Harita hem 2B tuvalini hem 3B gövdesini boyar: ikisi de yenilenmeli
    if (controls.cbStressMap) controls.cbStressMap.addEventListener('change', () => {
        updateStressScaleRow();
        redrawStressScale();
    });
    if (controls.cbStress) controls.cbStress.addEventListener('change', () => {
        updateStressModeRow();
        draw();
    });
    if (controls.cbForceVector) controls.cbForceVector.addEventListener('change', draw);
    if (controls.cbPartBorders) controls.cbPartBorders.addEventListener('change', draw);
    if (controls.cbDimensions) controls.cbDimensions.addEventListener('change', draw);
    if (controls.cbGeometricCenter) controls.cbGeometricCenter.addEventListener('change', draw);

    // Gerilme diyagramının çizileceği yer (eksenler / köşegen)
    document.querySelectorAll('[data-stress-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            stressDiagramMode = btn.getAttribute('data-stress-mode');
            document.querySelectorAll('[data-stress-mode]').forEach(b => {
                b.classList.toggle('active', b === btn);
            });
            draw();
        });
    });

    // Renk ölçeği: mod (otomatik / sabit), referans üst sınır ve rampa eğrisi
    document.querySelectorAll('[data-stress-scale]').forEach(btn => {
        btn.addEventListener('click', () => setStressScaleMode(btn.getAttribute('data-stress-scale')));
    });
    const tbRef = document.getElementById('tbStressRef');
    if (tbRef) {
        const applyRef = () => {
            const v = parseFloat(tbRef.value);
            if (!isFinite(v) || v <= 0) return;      // boş/sıfır alanda son değer korunur
            stressRefTau = v;
            saveStressScale();
            redrawStressScale();
        };
        tbRef.addEventListener('input', applyRef);
        tbRef.addEventListener('change', applyRef);
    }
    const tbGamma = document.getElementById('tbStressGamma');
    if (tbGamma) {
        const applyGamma = () => {
            const v = parseFloat(tbGamma.value);
            if (!isFinite(v) || v <= 0) return;
            stressGamma = Math.max(STRESS_GAMMA_MIN, Math.min(STRESS_GAMMA_MAX, v));
            saveStressScale();
            redrawStressScale();
        };
        tbGamma.addEventListener('input', applyGamma);
        tbGamma.addEventListener('change', applyGamma);
    }

    // Çubuk boyu — sağ paneldeki ve 3B ayarlarındaki alanlar aynı duruma bağlıdır
    document.querySelectorAll('[data-bar-length]').forEach(el => {
        el.addEventListener('change', () => applyBarLengthInput(el));
    });

    // Dönme açılarının birimi (radyan / derece)
    document.querySelectorAll('[data-angle-unit]').forEach(btn => {
        btn.addEventListener('click', () => setAngleUnit(btn.getAttribute('data-angle-unit')));
    });

    // Izgara aralığı
    const tbGridSize = document.getElementById('tbGridSize');
    if (tbGridSize) {
        const applyGrid = () => {
            const val = parseFloat(tbGridSize.value);
            if (val > 0) {
                gridSpacing = val;
                draw();
            }
        };
        tbGridSize.addEventListener('change', applyGrid);
        tbGridSize.addEventListener('input', applyGrid);
    }

    // 3B görünüm: dinleyici script3d.js'te (toggle3DView). Burada AYRI bir
    // 'change' dinleyicisi de vardı; ikisi de view-3d-active sınıfını yönetiyor,
    // ikisi de init3D() çağırıyor ve ikisi de tuvali yeniden boyutlandırıyordu.
    // Doğru çalışmasının tek dayanağı script.js'in önce yüklenmesiydi: kendi
    // 50 ms'lik resizeCanvas/draw'ı toggle3DView'in senkron düzen işinin üstüne
    // biniyor, geçiş başına birkaç yanlış kare doğuruyordu. Geçişin tek sahibi
    // artık toggle3DView; 2B tarafı oradan sync2DLayout ile tazelenir.

    // Dil değişikliği
    window.addEventListener('languageChanged', () => {
        updateStatus();
        updateOutputs();
        draw();
    });

    // Canvas mouse olayları
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('wheel', onWheel);
}

// === BURULMA MOMENTİ GİRİŞİ ===
// Sayısal alan ile kaydırıcı çift yönlü bağlıdır.
const TORSION_SLIDER_BASE = 10;              // kNm — kaydırıcının başlangıç ± sınırı
let torsionSliderLimit = TORSION_SLIDER_BASE;
let torsionUpdateFrame = null;

// Kaydırıcıyı sayısal alandaki değere getirir. Sınır yalnızca büyür: sürükleme
// sırasında aralık daralırsa tutamak zıplar.
function syncTorsionSlider() {
    const slider = inputs.tbTorsionSlider;
    if (!slider || !inputs.tbTorsion) return;

    const v = parseFloat(inputs.tbTorsion.value);
    if (!isFinite(v)) return;

    const need = Math.ceil(Math.abs(v));
    if (need > torsionSliderLimit) {
        torsionSliderLimit = need;
        slider.min = -torsionSliderLimit;
        slider.max = torsionSliderLimit;
    }
    slider.value = v;
}

// Sürüklerken saniyede onlarca olay gelir; hesap ve çizim tek kareye indirgenir
// (aksi hâlde 3B geometrisi her olayda yeniden kurulur)
function scheduleTorsionUpdate() {
    if (typeof requestAnimationFrame !== 'function') {
        hesapla();
        draw();
        return;
    }
    if (torsionUpdateFrame !== null) return;
    torsionUpdateFrame = requestAnimationFrame(() => {
        torsionUpdateFrame = null;
        hesapla();
        draw();
    });
}

// === ARAÇ YÖNETİMİ ===
function setTool(tool) {
    // Yeni bir çizim aracı seçildiğinde düzenleme modundan çık
    if (tool !== 'move' && editMode) {
        editMode = false;
        clearElementSelection();
    }

    // Halka aracı dışına çıkıldığında yarım kalan halka durumunu sıfırla
    ringDraft = null;
    if (dimensionLabel) dimensionLabel.style.display = 'none';

    currentTool = tool;

    // Buton aktiflik durumları
    document.querySelectorAll('.tool-btn-vertical').forEach(btn => btn.classList.remove('active'));

    const activeBtn = document.getElementById('btn' + tool.charAt(0).toUpperCase() + tool.slice(1));
    if (activeBtn) activeBtn.classList.add('active');

    // Edit mode butonu aktiflik durumu
    const btnEditMode = document.getElementById('btnEditMode');
    if (btnEditMode) {
        if (editMode) btnEditMode.classList.add('active');
        else btnEditMode.classList.remove('active');
    }

    // Cursor
    switch (tool) {
        case 'circle':
        case 'ring':
        case 'rect':
            canvas.style.cursor = 'crosshair';
            break;
        case 'move':
            canvas.style.cursor = editMode ? 'default' : 'grab';
            break;
        case 'pan':
            canvas.style.cursor = 'grab';
            break;
    }

    updateStatus();
}

function updateStatus() {
    if (!statusLabel) return;

    // Halka çizimi sürerken adım yönergesini göster (halka ancak 3. tıkta oluşur)
    if (currentTool === 'ring' && ringDraft) {
        statusLabel.textContent = '🚧 ' + t(ringDraft.r1 === null ? 'statusRingD1' : 'statusRingD2');
        return;
    }

    // Hesap hatası varsa uyarıyı koru
    if (calc.errorState === 'overlap') {
        statusLabel.textContent = '⚠️ ' + t('errOverlap');
        return;
    }
    if (calc.errorState === 'concentric') {
        statusLabel.textContent = '⚠️ ' + t('errConcentric');
        return;
    }
    if (calc.errorState === 'mixed') {
        statusLabel.textContent = '⚠️ ' + t('errMixed');
        return;
    }
    if (calc.errorState === 'profileDims') {
        statusLabel.textContent = '⚠️ ' + t('errProfileDims');
        return;
    }
    if (calc.errorState === 'profileMaterial') {
        statusLabel.textContent = '⚠️ ' + t('errProfileMaterial');
        return;
    }
    if (calc.errorState === 'rectOverlap') {
        statusLabel.textContent = '⚠️ ' + t('errRectOverlap');
        return;
    }
    if (calc.errorState === 'multiCell') {
        statusLabel.textContent = '⚠️ ' + t('errMultiCell');
        return;
    }
    if (calc.errorState === 'closedShape') {
        statusLabel.textContent = '⚠️ ' + t('errClosedShape');
        return;
    }
    if (calc.errorState === 'wallStack') {
        statusLabel.textContent = '⚠️ ' + t('errWallStack');
        return;
    }

    const messages = {
        circle: t('statusDrawCircle'),
        ring: t('statusRingCenter'),
        rect: t('statusDrawRect'),
        move: t('statusEdit'),
        pan: t('statusPan')
    };
    const msg = messages[currentTool] || t('statusReady');
    statusLabel.textContent = '🚧 ' + msg;
}

function selectElement(type, index) {
    selectedElement = { type, index };
    updateShapesList();
    draw();
}

function clearElementSelection() {
    if (!selectedElement) return;
    selectedElement = null;
    deleteButtonBounds = null;
    isResizing = false;
    activeHandle = null;
    updateShapesList();
    draw();
}

// === YARDIMCILAR ===
// Mevcut kesitin ortak merkezi (eş merkezlilik için yeni parçalar buraya kenetlenir)
function getSectionCenter() {
    if (circles.length === 0) return null;
    return { x: circles[0].cx, y: circles[0].cy };
}

function newCircle(cx, cy, r) {
    return { type: 'circle', cx, cy, r, ri: 0, G: DEFAULT_G, colorIdx: (colorSeq++) % MATERIAL_COLOR_COUNT };
}

function shapeLabel(c, index) {
    if (c.type === 'rect') {
        const d = rectDims(c);
        return t(Math.abs(d.w - d.h) < 1e-9 ? 'shapeSquare' : 'shapeRect') + ' ' + (index + 1);
    }
    return t((c.ri || 0) > 0 ? 'shapeRing' : 'shapeCircle') + ' ' + (index + 1);
}

// === DİKDÖRTGEN/KARE KESİT YARDIMCILARI ===
function newRect(x1, y1, x2, y2) {
    return {
        type: 'rect', x1, y1, x2, y2,
        G: DEFAULT_G,
        colorIdx: (colorSeq++) % MATERIAL_COLOR_COUNT
    };
}

// Merkezi ve kenar uzunlukları verilen dikdörtgeni köşe koordinatlarına çevirir
function setRectSize(r, w, h) {
    const d = rectDims(r);
    r.x1 = d.cx - w / 2; r.x2 = d.cx + w / 2;
    r.y1 = d.cy - h / 2; r.y2 = d.cy + h / 2;
}

// Kesitte hangi model geçerli. Üç aile vardır ve birleştirilemezler:
// dairesel kompozit, TEK dikdörtgen (kesin Saint-Venant serisi) ve ince cidarlı
// profil (dikdörtgen elemanlardan; açıkta Σbt³/3, kapalıda Bredt–Batho).
function sectionType() {
    if (rectangles.length > 1) return 'profile';
    if (rectangles.length === 1) return 'rect';
    if (circles.length > 0) return 'circular';
    return 'empty';
}

// Kesitte hiç parça var mı (her iki model için)
function sectionIsEmpty() {
    return circles.length === 0 && rectangles.length === 0;
}

// Yeni parça eklenebilir mi? Dairesel ve dikdörtgen modeller karışamaz;
// dikdörtgen kesit tek parçadır (kompozit dikdörtgen için elemanter çözüm yoktur).
function canAddPart(kind) {
    if (kind === 'profile') return PROFILE_UI_ENABLED && sectionIsEmpty();
    if (kind === 'rect') {
        // Profil arayüzü kapalıyken kesitte yalnızca bir dikdörtgen bulunabilir;
        // açıkken elemanlar üst üste EKLENEBİLİR (kesit böyle kurulur).
        return PROFILE_UI_ENABLED ? circles.length === 0 : sectionIsEmpty();
    }
    return rectangles.length === 0;   // dairesel parça: dikdörtgenle karışamaz
}

// Profil tipi ARAÇ SEÇİMİNDE belirlenir. Tip yalnız sağ paneldeki listede olsaydı
// (ilk sürümde öyleydi) araç hep I bırakır, kullanıcı başka tip çizilemiyor sanır.
let pendingProfileKind = 'I';

function initProfileKindMenu() {
    const btn = document.getElementById('btnProfile');
    const menu = document.getElementById('profileKindMenu');
    if (!btn || !menu) return;

    if (!PROFILE_UI_ENABLED) {
        // Buton kaldırılmaz, gizlenir: geri açmak sabiti çevirmekten ibaret olsun
        const host = btn.closest('.tool-with-menu') || btn;
        host.style.display = 'none';
        return;
    }

    Object.keys(PROFILE_KINDS).forEach(k => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.kind = k;
        b.textContent = profileKindLabel(k);
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            pendingProfileKind = k;
            menu.classList.remove('show');
            markProfileKindMenu();
            setTool('profile');
            // Kesitte zaten hazır bir profil varsa tip değişikliği ona uygulanır;
            // böylece kullanıcı yeniden yerleştirmek zorunda kalmaz
            if (profileDef) {
                profileDef.kind = k;
                rebuildProfileRects();
                updateAll();
                updateShapesList();
            }
        });
        menu.appendChild(b);
    });
    markProfileKindMenu();

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTool('profile');
        menu.classList.toggle('show');
    });
    document.addEventListener('click', () => menu.classList.remove('show'));
}

function markProfileKindMenu() {
    document.querySelectorAll('#profileKindMenu button').forEach(b => {
        b.classList.toggle('active', b.dataset.kind === pendingProfileKind);
    });
}

function showPartConflict(kind) {
    if (!statusLabel) return;
    if (kind === 'profile') {
        statusLabel.textContent = '⚠️ ' + t('conflictProfile');
        return;
    }
    statusLabel.textContent = '⚠️ ' + t((kind === 'rect' && rectangles.length > 0)
        ? 'conflictRect' : 'conflictMixed');
}

// Merkezden bir noktaya olan uzaklığı ızgaraya yuvarlar (en az bir ızgara adımı)
function snapRadius(gx, gy, cx, cy) {
    const dist = Math.sqrt(Math.pow(gx - cx, 2) + Math.pow(gy - cy, 2));
    return Math.max(gridSpacing, Math.round(dist / gridSpacing) * gridSpacing);
}

// Halka taslağının o anki dış/iç yarıçapları: tıklanan çap ile imleçteki çap.
// Büyük olan dış, küçük olan iç yarıçaptır; tek yarıçap varsa dolu daire gibi.
function getRingDraftRadii() {
    if (!ringDraft) return { rOut: 0, rIn: 0 };
    const rs = [ringDraft.r1, ringDraft.hoverR].filter(v => typeof v === 'number' && v > 0);
    if (rs.length === 0) return { rOut: 0, rIn: 0 };
    return {
        rOut: Math.max.apply(null, rs),
        rIn: rs.length > 1 ? Math.min.apply(null, rs) : 0
    };
}

// Halka aracının tıklama akışı: 1) merkez 2) çaplardan biri 3) diğer çap
function handleRingClick(sx, sy) {
    const gridPos = screenToGrid(sx, sy);

    // 1. tık: merkez (kesitte parça varsa eş merkezliliğe kenetlenir)
    if (!ringDraft) {
        const center = getSectionCenter();
        const c = center ? { x: center.x, y: center.y } : snapToGrid(gridPos.x, gridPos.y);
        ringDraft = { cx: c.x, cy: c.y, r1: null, hoverR: null };
        updateStatus();
        draw();
        return;
    }

    const r = snapRadius(gridPos.x, gridPos.y, ringDraft.cx, ringDraft.cy);

    // 2. tık: çaplardan biri (dış mı iç mi olduğu 3. tıkta belli olur)
    if (ringDraft.r1 === null) {
        ringDraft.r1 = r;
        updateStatus();
        draw();
        return;
    }

    // 3. tık: diğer çap. Aynı çap seçilirse halka oluşmaz, tık yok sayılır.
    if (r === ringDraft.r1) return;

    const ring = newCircle(ringDraft.cx, ringDraft.cy, Math.max(ringDraft.r1, r));
    ring.ri = Math.min(ringDraft.r1, r);
    circles.push(ring);

    ringDraft = null;
    if (dimensionLabel) dimensionLabel.style.display = 'none';

    hesapla();
    updateStatus();
    draw();
}

// === MOUSE OLAYLARI ===
function onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (deleteButtonBounds && e.button === 0) {
        if (x >= deleteButtonBounds.x && x <= deleteButtonBounds.x + deleteButtonBounds.w &&
            y >= deleteButtonBounds.y && y <= deleteButtonBounds.y + deleteButtonBounds.h) {

            if (selectedElement && selectedElement.type === 'circle') {
                circles.splice(selectedElement.index, 1);
                ringDraft = null;
                clearElementSelection();
                hesapla();
                draw();
            } else if (selectedElement && selectedElement.type === 'rect') {
                rectangles.splice(selectedElement.index, 1);
                clearElementSelection();
                hesapla();
                draw();
            }
            return;
        }
    }

    if (e.button === 1) {
        // Orta tık = Pan
        isPanning = true;
        panStart = { x: e.clientX - viewState.panX, y: e.clientY - viewState.panY };
        canvas.style.cursor = 'grabbing';
    } else if (e.button === 0) {
        if (currentTool === 'pan') {
            isPanning = true;
            panStart = { x: e.clientX - viewState.panX, y: e.clientY - viewState.panY };
            canvas.style.cursor = 'grabbing';
            return;
        }

        if (currentTool === 'move') {
            if (editMode) {
                const hit = hitTestElements(x, y);
                if (hit) {
                    selectElement(hit.type, hit.index);
                    const gridPos = screenToGrid(x, y);
                    const snapped = snapToGrid(gridPos.x, gridPos.y);
                    if (hit.handle && hit.handle !== 'body') {
                        isResizing = true;
                        activeHandle = hit.handle;
                    } else {
                        isMoving = true;
                        moveStart = { x: snapped.x, y: snapped.y };
                    }
                    return;
                } else {
                    clearElementSelection();
                    draw();
                }
            }

            // Move aracı, boş alanda pan
            isPanning = true;
            panStart = { x: e.clientX - viewState.panX, y: e.clientY - viewState.panY };
            canvas.style.cursor = 'grabbing';
            return;
        }

        if (currentTool === 'profile') {
            if (!canAddPart('profile')) { showPartConflict('profile'); return; }
            const gp = snapToGrid(screenToGrid(x, y).x, screenToGrid(x, y).y);
            profileDef = Object.assign({}, PROFILE_DEFAULTS,
                { kind: pendingProfileKind, cx: gp.x, cy: gp.y });
            rebuildProfileRects();
            updateAll();
            updateShapesList();
            return;
        }

        if (currentTool === 'rect') {
            if (!canAddPart('rect')) { showPartConflict('rect'); return; }
            // Dikdörtgen köşeden köşeye sürüklenerek çizilir (Shift: kare)
            isDrawing = true;
            const gridPos = screenToGrid(x, y);
            drawStart = snapToGrid(gridPos.x, gridPos.y);
            drawEnd = { x: drawStart.x, y: drawStart.y };
            return;
        }

        if (currentTool === 'ring') {
            if (!canAddPart('circle')) { showPartConflict('circle'); return; }
            // Halka sürüklenerek değil, üç tıkla çizilir
            handleRingClick(x, y);
            return;
        }

        if (currentTool === 'circle') {
            if (!canAddPart('circle')) { showPartConflict('circle'); return; }
            isDrawing = true;

            // Eş merkezlilik: kesit varsa yeni parça aynı merkeze kenetlenir
            const center = getSectionCenter();
            if (center) {
                drawStart = { x: center.x, y: center.y };
            } else {
                const gridPos = screenToGrid(x, y);
                drawStart = snapToGrid(gridPos.x, gridPos.y);
            }
            drawEnd = { x: drawStart.x, y: drawStart.y };
        }
    }
}

function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Hover cursor güncellemeleri (edit mode)
    if (!isPanning && !isResizing && !isMoving && currentTool === 'move') {
        if (editMode) {
            const hit = hitTestElements(x, y);

            const oldHit = hoverElement;
            hoverElement = hit;
            if (oldHit?.type !== hit?.type || oldHit?.index !== hit?.index || oldHit?.handle !== hit?.handle) {
                draw();
            }

            if (hit) {
                if (hit.handle === 'body') {
                    const isAlreadySelected = selectedElement && selectedElement.type === hit.type && selectedElement.index === hit.index;
                    canvas.style.cursor = isAlreadySelected ? 'move' : 'pointer';
                } else {
                    canvas.style.cursor = getCursorForHandle(hit.handle || 'body');
                }
            } else {
                canvas.style.cursor = 'default';
            }
        } else {
            canvas.style.cursor = 'grab';
            if (hoverElement) {
                hoverElement = null;
                draw();
            }
        }
    } else if (currentTool === 'pan') {
        canvas.style.cursor = isPanning ? 'grabbing' : 'grab';
    } else {
        if (hoverElement) {
            hoverElement = null;
            draw();
        }
    }

    if (isPanning) {
        viewState.panX = e.clientX - panStart.x;
        viewState.panY = e.clientY - panStart.y;
        constrainView();
        draw();
    } else if (isResizing && selectedElement && selectedElement.type === 'circle') {
        const gridPos = screenToGrid(x, y);
        const c = circles[selectedElement.index];
        if (!c) return;

        canvas.style.cursor = getCursorForHandle(activeHandle);

        const dist = Math.sqrt(Math.pow(gridPos.x - c.cx, 2) + Math.pow(gridPos.y - c.cy, 2));
        const snapped = Math.max(gridSpacing, Math.round(dist / gridSpacing) * gridSpacing);

        if (activeHandle && activeHandle.startsWith('i')) {
            // İç yarıçap: dış yarıçapın altında kalmalı
            c.ri = Math.min(snapped, Math.max(0, c.r - gridSpacing));
        } else {
            // Dış yarıçap: iç yarıçapın üzerinde kalmalı
            c.r = Math.max((c.ri || 0) + gridSpacing, snapped);
        }

        hesapla();
        draw();
    } else if (isResizing && selectedElement && selectedElement.type === 'rect') {
        const r = rectangles[selectedElement.index];
        if (!r) return;

        canvas.style.cursor = getCursorForHandle(activeHandle);

        const gridPos = screenToGrid(x, y);
        const snapped = snapToGrid(gridPos.x, gridPos.y);
        const min = gridSpacing;

        // Tutamak, sürüklenen kenarı taşır; karşı kenar sabit kalır
        // ('mr'/'tm' küçük koordinatlı kenarlar, 'ml'/'bm' büyük koordinatlı)
        switch (activeHandle) {
            case 'mr': r.x1 = Math.min(snapped.x, r.x2 - min); break;
            case 'ml': r.x2 = Math.max(snapped.x, r.x1 + min); break;
            case 'tm': r.y1 = Math.min(snapped.y, r.y2 - min); break;
            case 'bm': r.y2 = Math.max(snapped.y, r.y1 + min); break;
        }

        hesapla();
        draw();
    } else if (isMoving && selectedElement) {
        canvas.style.cursor = 'move';
        const gridPos = screenToGrid(x, y);
        const snapped = snapToGrid(gridPos.x, gridPos.y);
        const dx = snapped.x - moveStart.x;
        const dy = snapped.y - moveStart.y;
        if (dx === 0 && dy === 0) return;
        moveStart = { x: snapped.x, y: snapped.y };

        // Kesit tek bir mil enkesitidir: tüm parçalar eş merkezli olarak birlikte taşınır
        circles.forEach(c => {
            c.cx += dx;
            c.cy += dy;
        });
        rectangles.forEach(r => {
            r.x1 += dx; r.x2 += dx;
            r.y1 += dy; r.y2 += dy;
        });

        hesapla();
        draw();
    } else if (isDrawing && currentTool === 'rect') {
        const gridPos = screenToGrid(x, y);
        const snapped = snapToGrid(gridPos.x, gridPos.y);

        let ex = snapped.x, ey = snapped.y;
        if (e.shiftKey) {
            // Shift: kare (kısa kenara göre, sürükleme yönü korunarak)
            const side = Math.max(Math.abs(ex - drawStart.x), Math.abs(ey - drawStart.y));
            ex = drawStart.x + Math.sign(ex - drawStart.x || 1) * side;
            ey = drawStart.y + Math.sign(ey - drawStart.y || 1) * side;
        }
        drawEnd = { x: ex, y: ey };

        const w = Math.abs(ex - drawStart.x), h = Math.abs(ey - drawStart.y);
        if (dimensionLabel) {
            dimensionLabel.textContent = w + ' × ' + h + ' mm';
            dimensionLabel.style.display = 'block';
            dimensionLabel.style.left = (x + 15) + 'px';
            dimensionLabel.style.top = (y + 15) + 'px';
        }
        draw();
    } else if (isDrawing && currentTool === 'circle') {
        const gridPos = screenToGrid(x, y);
        const snapped = snapToGrid(gridPos.x, gridPos.y);

        const dx = snapped.x - drawStart.x;
        const dy = snapped.y - drawStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const snappedR = Math.max(gridSpacing, Math.round(dist / gridSpacing) * gridSpacing);
        drawEnd = { x: drawStart.x + snappedR, y: drawStart.y };

        if (snappedR > 0 && dimensionLabel) {
            dimensionLabel.textContent = 'R: ' + snappedR + ' mm';
            dimensionLabel.style.display = 'block';
            dimensionLabel.style.left = (x + 15) + 'px';
            dimensionLabel.style.top = (y + 15) + 'px';
        }
        draw();
    } else if (currentTool === 'ring' && ringDraft) {
        // Merkez sabit; imleç bir sonraki çapı belirler
        const gridPos = screenToGrid(x, y);
        const r = snapRadius(gridPos.x, gridPos.y, ringDraft.cx, ringDraft.cy);
        const changed = ringDraft.hoverR !== r;
        ringDraft.hoverR = r;

        if (dimensionLabel) {
            dimensionLabel.textContent = 'R: ' + r + ' mm';
            dimensionLabel.style.display = 'block';
            dimensionLabel.style.left = (x + 15) + 'px';
            dimensionLabel.style.top = (y + 15) + 'px';
        }
        if (changed) draw();
    }
}

function onMouseUp(e) {
    // Halka tıklamayla çizildiği için sürükleme bitişi yoktur; imleç tuvalden
    // çıkınca yalnızca serbest (imleçle belirlenen) çap önizlemesi kaldırılır
    if (currentTool === 'ring' && ringDraft && e && e.type === 'mouseleave') {
        ringDraft.hoverR = null;
        if (dimensionLabel) dimensionLabel.style.display = 'none';
        draw();
    }

    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = (currentTool === 'move' || currentTool === 'pan') ? 'grab' : 'crosshair';
    } else if (isResizing) {
        isResizing = false;
        activeHandle = null;
        hesapla();
        draw();
    } else if (isMoving) {
        isMoving = false;
        hesapla();
        draw();
        canvas.style.cursor = editMode ? 'default' : 'grab';
    } else if (isDrawing && currentTool === 'rect') {
        isDrawing = false;
        if (dimensionLabel) dimensionLabel.style.display = 'none';

        const w = Math.abs(drawEnd.x - drawStart.x);
        const h = Math.abs(drawEnd.y - drawStart.y);

        // Sıfır boyutlu (tek tık) dikdörtgen oluşturulmaz
        if (w >= gridSpacing && h >= gridSpacing && canAddPart('rect')) {
            rectangles.push(newRect(
                Math.min(drawStart.x, drawEnd.x), Math.min(drawStart.y, drawEnd.y),
                Math.max(drawStart.x, drawEnd.x), Math.max(drawStart.y, drawEnd.y)
            ));
            // Elle eleman eklendi: kesit artık hazır profilin parametreleriyle
            // tanımlı değil, elemanlarıyla tanımlı
            profileDef = null;
            hesapla();
            updateShapesList();
        }
        updateStatus();
        draw();
    } else if (isDrawing && currentTool === 'circle') {
        isDrawing = false;
        if (dimensionLabel) dimensionLabel.style.display = 'none';

        const rect = canvas.getBoundingClientRect();
        const mouseGrid = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        const r = snapRadius(mouseGrid.x, mouseGrid.y, drawStart.x, drawStart.y);

        circles.push(newCircle(drawStart.x, drawStart.y, r));
        hesapla();
        updateStatus();
        draw();
    }
}

function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.98 : 1.02;
    applyZoom(delta);
}

// Zoom: ağırlık merkezini (veya ızgara merkezini) sabit tutar
function applyZoom(delta) {
    const oldZoom = viewState.zoom;
    let newZoom = oldZoom * delta;
    newZoom = Math.max(viewState.minZoom, Math.min(viewState.maxZoom, newZoom));

    if (newZoom === oldZoom) return;

    let targetGX, targetGY;
    if (calc && calc.area > 0) {
        targetGX = calc.centroidX;
        targetGY = calc.centroidY;
    } else {
        targetGX = WORLD_SIZE_X / 2;
        targetGY = WORLD_SIZE_Y / 2;
    }

    const posBefore = gridToScreen(targetGX, targetGY);
    viewState.zoom = newZoom;
    const posAfter = gridToScreen(targetGX, targetGY);

    viewState.panX += (posBefore.x - posAfter.x);
    viewState.panY += (posBefore.y - posAfter.y);

    constrainView();
    draw();
}

// Kaydırma sınırı: dünyanın herhangi bir NOKTASI tuvalin MERKEZİNE getirilebilmeli.
// Eski kural dünyanın KENARINI tuvalin KENARINA sabitliyordu; bu, dünyanın kıyısında
// duran bir kesitin (örn. hazır modeller (0,0)'daydı) ortalanmasını imkânsız kılıyordu:
// fitToScreen() doğru pan'i yazıyor, hemen ardından ilk resizeCanvas()→constrainView()
// onu tam TUVAL YARISI kadar kırpıyor ve çizim köşeye fırlıyordu. İki fonksiyon artık
// aynı sınırı paylaşır: fitToScreen()'in dünya içindeki bir kesit için ürettiği pan
// hiçbir zaman kırpılmaz.
function constrainView() {
    const scale = viewState.zoom;

    // Düşeyde sığdırmanın üst payı kadar ek serbestlik: dünyanın alt kıyısındaki
    // bir kesitte fitToScreen bu kadar daha kaydırır, sınır onu kesmemelidir
    const maxPanX = (WORLD_SIZE_X * scale) / 2;
    const maxPanY = (WORLD_SIZE_Y * scale) / 2 + canvas.height * FIT_VERTICAL_OFFSET;

    viewState.panX = Math.max(-maxPanX, Math.min(maxPanX, viewState.panX));
    viewState.panY = Math.max(-maxPanY, Math.min(maxPanY, viewState.panY));
}

// === KOORDİNAT DÖNÜŞÜMÜ ===
function getTransformParams() {
    const centerX = canvas.width / 2 + viewState.panX;
    const centerY = canvas.height / 2 + viewState.panY;
    const scale = viewState.zoom;
    return { centerX, centerY, scale };
}

function gridToScreen(gx, gy) {
    const { centerX, centerY, scale } = getTransformParams();
    const maxX = WORLD_SIZE_X;
    const maxY = WORLD_SIZE_Y;
    return {
        x: (centerX - (gx - maxX / 2) * scale),
        y: (centerY + (gy - maxY / 2) * scale)
    };
}

function screenToGrid(sx, sy) {
    const { centerX, centerY, scale } = getTransformParams();
    const maxX = WORLD_SIZE_X;
    const maxY = WORLD_SIZE_Y;
    return {
        x: -(sx - centerX) / scale + maxX / 2,
        y: (sy - centerY) / scale + maxY / 2
    };
}

function snapToGrid(gx, gy) {
    return {
        x: Math.round(gx / gridSpacing) * gridSpacing,
        y: Math.round(gy / gridSpacing) * gridSpacing
    };
}

// === HIT TEST ===
function hitTestElements(sx, sy) {
    // Tutamaçlar (yalnızca edit modunda)
    if (editMode) {
        for (let i = circles.length - 1; i >= 0; i--) {
            const c = circles[i];
            const handles = [];

            // İç yarıçap tutamaçları (halka ise)
            if ((c.ri || 0) > 0) {
                handles.push(
                    { key: 'imr', gx: c.cx - c.ri, gy: c.cy },
                    { key: 'iml', gx: c.cx + c.ri, gy: c.cy },
                    { key: 'itm', gx: c.cx, gy: c.cy - c.ri },
                    { key: 'ibm', gx: c.cx, gy: c.cy + c.ri }
                );
            }

            // Dış yarıçap tutamaçları
            handles.push(
                { key: 'mr', gx: c.cx - c.r, gy: c.cy },
                { key: 'ml', gx: c.cx + c.r, gy: c.cy },
                { key: 'tm', gx: c.cx, gy: c.cy - c.r },
                { key: 'bm', gx: c.cx, gy: c.cy + c.r }
            );

            for (const h of handles) {
                const hp = gridToScreen(h.gx, h.gy);
                const { w, h: hh } = getHandleSize(h.key);
                if (Math.abs(sx - hp.x) <= w && Math.abs(sy - hp.y) <= hh) {
                    return { type: 'circle', index: i, handle: h.key };
                }
            }
        }
    }

    // Dikdörtgen kenar tutamaçları (yalnızca edit modunda)
    if (editMode) {
        for (let i = rectangles.length - 1; i >= 0; i--) {
            const d = rectDims(rectangles[i]);
            const handles = [
                { key: 'mr', gx: d.cx - d.w / 2, gy: d.cy },
                { key: 'ml', gx: d.cx + d.w / 2, gy: d.cy },
                { key: 'tm', gx: d.cx, gy: d.cy - d.h / 2 },
                { key: 'bm', gx: d.cx, gy: d.cy + d.h / 2 }
            ];
            for (const h of handles) {
                const hp = gridToScreen(h.gx, h.gy);
                const { w, h: hh } = getHandleSize(h.key);
                if (Math.abs(sx - hp.x) <= w && Math.abs(sy - hp.y) <= hh) {
                    return { type: 'rect', index: i, handle: h.key };
                }
            }
        }
    }

    const gridClick = screenToGrid(sx, sy);

    // Gövde (en üstteki / en küçük olan öncelikli seçilsin diye küçükten büyüğe)
    const order = circles.map((_, i) => i).sort((a, b) => circles[a].r - circles[b].r);
    for (const i of order) {
        if (isPointInShape(gridClick.x, gridClick.y, circles[i])) {
            return { type: 'circle', index: i, handle: 'body' };
        }
    }

    for (let i = rectangles.length - 1; i >= 0; i--) {
        if (isPointInShape(gridClick.x, gridClick.y, rectangles[i])) {
            return { type: 'rect', index: i, handle: 'body' };
        }
    }

    return null;
}

function getHandleSize(handleKey) {
    const key = handleKey && handleKey.startsWith('i') ? handleKey.slice(1) : handleKey;
    const horiz = ['tm', 'bm'].includes(key);
    const vert = ['ml', 'mr'].includes(key);

    if (horiz) return { w: HANDLE_SIZE * 1.8, h: HANDLE_SIZE * 0.6 };
    if (vert) return { w: HANDLE_SIZE * 0.6, h: HANDLE_SIZE * 1.8 };
    return { w: HANDLE_SIZE, h: HANDLE_SIZE };
}

// === FİT TO SCREEN ===
function fitToScreen() {
    if (sectionIsEmpty()) {
        if (initialViewState) {
            viewState.zoom = initialViewState.zoom;
            viewState.panX = initialViewState.panX;
            viewState.panY = initialViewState.panY;
        } else {
            viewState.zoom = 2.0;
            viewState.panX = 0;
            viewState.panY = 0;
        }
        draw();
        return;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    const includePoint = (x, y) => {
        if (!isFinite(x) || !isFinite(y)) return;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    };

    // 1. Enkesit parçaları
    circles.concat(rectangles).forEach(s => {
        const b = shapeBounds(s);
        includePoint(b.xMin, b.yMin);
        includePoint(b.xMax, b.yMax);
    });

    // 2. Eksenler
    if (controls.cbAxes && controls.cbAxes.checked && calc && calc.area > 0) {
        const axisLen = Math.max(calc.xMax - calc.xMin, calc.yMax - calc.yMin) * 0.64;
        includePoint(calc.centroidX - axisLen, calc.centroidY - axisLen);
        includePoint(calc.centroidX + axisLen, calc.centroidY + axisLen);
    }

    // 3. Hesaplama göstergeleri
    if (calc && calc.area > 0 && Math.abs(calc.torsion) > 1e-6) {
        if (controls.cbForceVector && controls.cbForceVector.checked) {
            const sectionSize = Math.max(calc.xMax - calc.xMin, calc.yMax - calc.yMin);
            const radius = sectionSize * MOMENT_ARC_SCALE;
            includePoint(calc.centroidX - radius, calc.centroidY - radius);
            includePoint(calc.centroidX + radius, calc.centroidY + radius);
        }
        if (controls.cbStress && controls.cbStress.checked) {
            if (calc.sectionType === 'rect' && calc.rectInfo) {
                // Diyagram iki merkez ekseninin dört yanına da taşar
                const reach = (Math.max(calc.rectInfo.w, calc.rectInfo.h) / 2) * STRESS_DIAGRAM_REACH;
                includePoint(calc.xMin - reach, calc.yMin - reach);
                includePoint(calc.xMax + reach, calc.yMax + reach);
            } else if (calc.rhoMax > 0) {
                // Diyagram düşey çapın iki yanına yatayda ~REACH·ρmax kadar taşar
                const reach = calc.rhoMax * STRESS_DIAGRAM_REACH;
                includePoint(calc.centroidX - reach, calc.centroidY - calc.rhoMax);
                includePoint(calc.centroidX + reach, calc.centroidY + calc.rhoMax);
            }
        }
    }

    // 4. Boyut çizgileri
    if (controls.cbDimensions && controls.cbDimensions.checked) {
        const dimPadding = gridSpacing * 3;
        minX -= dimPadding; maxX += dimPadding; minY -= dimPadding; maxY += dimPadding;
    }

    let sectionWidth = maxX - minX;
    let sectionHeight = maxY - minY;
    let sectionCenterX = (minX + maxX) / 2;
    let sectionCenterY = (minY + maxY) / 2;

    const padding = 50;
    const availableWidth = canvas.width - padding * 2;
    const availableHeight = canvas.height - padding * 2;

    const requiredScaleX = availableWidth / sectionWidth;
    const requiredScaleY = availableHeight / sectionHeight;
    let optimalScale = Math.min(requiredScaleX, requiredScaleY);
    if (!isFinite(optimalScale) || optimalScale <= 0) optimalScale = 2.0;

    optimalScale *= 1.15;
    viewState.zoom = Math.max(viewState.minZoom, Math.min(viewState.maxZoom, optimalScale));

    const currentScale = viewState.zoom;
    const gridCenterX = WORLD_SIZE_X / 2;
    const gridCenterY = WORLD_SIZE_Y / 2;

    viewState.panX = (sectionCenterX - gridCenterX) * currentScale;
    const yOffset = -(canvas.height * FIT_VERTICAL_OFFSET);
    viewState.panY = -(sectionCenterY - gridCenterY) * currentScale + yOffset;

    draw();
}

// === TEMİZLE ===
function clearAll() {
    circles = [];
    rectangles = [];
    profileDef = null;
    isDrawing = false;
    ringDraft = null;
    colorSeq = 0;
    selectedElement = null;
    hesapla();
    draw();
}

// === KESİT LİSTESİ (SAĞ PANEL) ===
// Sayısal özellik alanı (yarıçap, kenar, G) — daire ve dikdörtgen satırları paylaşır
function makeShapePropField(labelHTML, value, min, step, onApply, unit) {
    const wrap = document.createElement('label');
    wrap.className = 'shape-prop-field';
    const lbl = document.createElement('span');
    lbl.className = 'shape-prop-label';
    lbl.innerHTML = labelHTML;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = min;
    inp.step = step;
    inp.value = value;
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (isFinite(v)) {
            onApply(v);
            hesapla();
            draw();
        }
    });
    inp.addEventListener('change', () => {
        // Blur/Enter sonrası kenetlenmiş değeri alana geri yaz
        updateShapesList();
        updateOutputs();
    });
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    if (unit) {
        const u = document.createElement('span');
        u.className = 'shape-prop-unit';
        u.textContent = unit;
        wrap.appendChild(u);
    }
    return wrap;
}

function updateShapesList() {
    const list = document.getElementById('shapesList');
    const container = document.getElementById('shapesListSection');
    if (!list) return;

    // Kullanıcı liste içindeki bir alana yazıyorsa listeyi yeniden kurma
    // (focus kaybını önle); yalnızca etiket ve alan metinlerini tazele.
    const active = document.activeElement;
    if (active && list.contains(active)) {
        list.querySelectorAll('.shape-item').forEach(item => {
            if (item.dataset.kind === 'profile') {
                const areaEl = item.querySelector('.shape-area');
                if (areaEl) areaEl.textContent = 'A = ' + formatNumber(calc.area) + ' mm²';
                return;
            }
            const idx = parseInt(item.dataset.index, 10);
            const isRect = item.dataset.kind === 'rect';
            const c = isRect ? rectangles[idx] : circles[idx];
            if (!c) return;
            const areaEl = item.querySelector('.shape-area');
            if (areaEl) areaEl.textContent = 'A = ' + formatNumber(isRect ? rectArea(c) : ringArea(c)) + ' mm²';
            const nameEl = item.querySelector('.shape-name');
            if (nameEl) nameEl.textContent = shapeLabel(c, idx);
        });
        return;
    }

    list.innerHTML = '';

    // Tek elemanlı kesitte eleman kartı (başlık "Daire 1", ayrı alan, sil düğmesi)
    // gösterilmez: kesitin kendisini tekrarlıyordu — alan zaten üstte "Toplam
    // Kesit Alanı"dır, silmek için tuvaldeki çöp düğmesi vardır. Yalnız düzenleme
    // alanları kalır; "Kesit Elemanları" başlığı ve liste çerçevesi CSS ile kalkar.
    const singlePart = !profileDef && circles.length + rectangles.length === 1;
    if (container) container.classList.toggle('single-part', singlePart);

    if (profileDef) {
        const div = document.createElement('div');
        div.className = 'shape-item shape-item-torsion';
        div.dataset.kind = 'profile';

        const mat = getMaterialColor(0);
        const headRow = document.createElement('div');
        headRow.className = 'shape-head-row';

        const swatch = document.createElement('span');
        swatch.className = 'material-swatch';
        swatch.style.background = mat.fill;
        swatch.style.borderColor = mat.stroke;

        const sel = document.createElement('select');
        sel.className = 'profile-kind-select';
        Object.keys(PROFILE_KINDS).forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = profileKindLabel(k);
            if (k === profileDef.kind) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
            profileDef.kind = sel.value;
            pendingProfileKind = sel.value;
            markProfileKindMenu();
            rebuildProfileRects();
            updateAll();
            updateShapesList();
        });

        const areaSpan = document.createElement('span');
        areaSpan.className = 'shape-area';
        areaSpan.textContent = 'A = ' + formatNumber(calc.area) + ' mm²';

        const del = document.createElement('button');
        del.className = 'btn-delete-shape';
        del.innerHTML = '×';
        del.title = 'Sil';
        del.onclick = (e) => {
            e.stopPropagation();
            profileDef = null;
            rectangles.length = 0;
            hesapla();
            draw();
            updateShapesList();
        };

        headRow.appendChild(swatch);
        headRow.appendChild(sel);
        headRow.appendChild(areaSpan);
        headRow.appendChild(del);
        div.appendChild(headRow);

        const apply = (key) => (v) => {
            profileDef[key] = v;
            rebuildProfileRects();
        };
        const props = document.createElement('div');
        props.className = 'shape-props';
        props.appendChild(makeShapePropField('b<sub>f</sub>', profileDef.bf, 1, 1, apply('bf'), 'mm'));
        props.appendChild(makeShapePropField('b<sub>w</sub>', profileDef.bw, 1, 1, apply('bw'), 'mm'));
        props.appendChild(makeShapePropField('t<sub>f</sub>', profileDef.tf, 0.1, 0.5, apply('tf'), 'mm'));
        props.appendChild(makeShapePropField('t<sub>w</sub>', profileDef.tw, 0.1, 0.5, apply('tw'), 'mm'));
        props.appendChild(makeShapePropField('G', profileDef.G, 1, 1, apply('G'), 'GPa'));
        div.appendChild(props);

        const hint = document.createElement('div');
        hint.className = 'profile-hint';
        hint.textContent = profileIsClosed(profileDef)
            ? t('closedSectionNote')
            : t('openSectionNote');
        div.appendChild(hint);

        list.appendChild(div);
        if (container) container.style.display = 'block';
        return;
    }

    circles.forEach((c, i) => {
        const div = document.createElement('div');
        div.className = 'shape-item shape-item-torsion';
        div.dataset.index = i;
        if (!singlePart && selectedElement && selectedElement.type === 'circle' && selectedElement.index === i) {
            div.classList.add('selected');
        }

        const mat = shapeColor(c, i);

        // Üst satır: renk + ad + alan + sil
        const headRow = document.createElement('div');
        headRow.className = 'shape-head-row';

        const swatch = document.createElement('span');
        swatch.className = 'material-swatch';
        swatch.style.background = mat.fill;
        swatch.style.borderColor = mat.stroke;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'shape-name';
        nameSpan.textContent = shapeLabel(c, i);

        const areaSpan = document.createElement('span');
        areaSpan.className = 'shape-area';
        areaSpan.textContent = 'A = ' + formatNumber(ringArea(c)) + ' mm²';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete-shape';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Sil';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            circles.splice(i, 1);
            ringDraft = null;
            clearElementSelection();
            hesapla();
            draw();
        };

        headRow.appendChild(swatch);
        headRow.appendChild(nameSpan);
        headRow.appendChild(areaSpan);
        headRow.appendChild(deleteBtn);

        // Alt satır: r_dış, r_iç, G girişleri
        const inputRow = document.createElement('div');
        inputRow.className = 'shape-input-row';

        const makeField = makeShapePropField;

        inputRow.appendChild(makeField(t('labelROuter'), c.r, 1, 1, (v) => {
            c.r = Math.max(Math.max(1, v), (c.ri || 0) + 1);
        }, 'mm'));

        inputRow.appendChild(makeField(t('labelRInner'), (c.ri || 0), 0, 1, (v) => {
            c.ri = Math.min(Math.max(0, v), c.r - 1);
        }, 'mm'));

        const gField = makeField('G', (typeof c.G === 'number' ? c.G : DEFAULT_G), 0.1, 1, (v) => {
            c.G = Math.max(0.1, v);
        }, 'GPa');
        gField.classList.add('shape-prop-field-wide');
        inputRow.appendChild(gField);

        if (!singlePart) div.appendChild(headRow);
        div.appendChild(inputRow);

        div.onclick = (e) => {
            e.stopPropagation();
            selectElement('circle', i);
            if (!editMode) {
                editMode = true;
                const btnEditMode = document.getElementById('btnEditMode');
                if (btnEditMode) btnEditMode.classList.add('active');
                setTool('move');
            }
        };

        list.appendChild(div);
    });

    // Dikdörtgen/kare satırı: genişlik, yükseklik ve G düzenlenebilir
    rectangles.forEach((r, i) => {
        const d = rectDims(r);

        const div = document.createElement('div');
        div.className = 'shape-item shape-item-torsion';
        div.dataset.index = i;
        div.dataset.kind = 'rect';
        if (!singlePart && selectedElement && selectedElement.type === 'rect' && selectedElement.index === i) {
            div.classList.add('selected');
        }

        const mat = shapeColor(r, i);

        const headRow = document.createElement('div');
        headRow.className = 'shape-head-row';

        const swatch = document.createElement('span');
        swatch.className = 'material-swatch';
        swatch.style.background = mat.fill;
        swatch.style.borderColor = mat.stroke;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'shape-name';
        nameSpan.textContent = shapeLabel(r, i);

        const areaSpan = document.createElement('span');
        areaSpan.className = 'shape-area';
        areaSpan.textContent = 'A = ' + formatNumber(rectArea(r)) + ' mm²';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete-shape';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Sil';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            rectangles.splice(i, 1);
            clearElementSelection();
            hesapla();
            draw();
        };

        headRow.appendChild(swatch);
        headRow.appendChild(nameSpan);
        headRow.appendChild(areaSpan);
        headRow.appendChild(deleteBtn);

        const inputRow = document.createElement('div');
        inputRow.className = 'shape-input-row';

        // Kenarlar merkez sabit kalacak şekilde değiştirilir
        inputRow.appendChild(makeShapePropField('b', d.w, 1, 1, (v) => {
            setRectSize(r, Math.max(1, v), rectDims(r).h);
        }, 'mm'));

        inputRow.appendChild(makeShapePropField('h', d.h, 1, 1, (v) => {
            setRectSize(r, rectDims(r).w, Math.max(1, v));
        }, 'mm'));

        const gFieldRect = makeShapePropField('G', (typeof r.G === 'number' ? r.G : DEFAULT_G), 0.1, 1, (v) => {
            r.G = Math.max(0.1, v);
        }, 'GPa');
        gFieldRect.classList.add('shape-prop-field-wide');
        inputRow.appendChild(gFieldRect);

        if (!singlePart) div.appendChild(headRow);
        div.appendChild(inputRow);

        div.onclick = (e) => {
            e.stopPropagation();
            selectElement('rect', i);
            if (!editMode) {
                editMode = true;
                const btnEditMode = document.getElementById('btnEditMode');
                if (btnEditMode) btnEditMode.classList.add('active');
                setTool('move');
            }
        };

        list.appendChild(div);
    });

    if (container) {
        container.style.display = sectionIsEmpty() ? 'none' : 'block';
    }
}

// === İNCE CİDARLI PROFİL (ARAYÜZ DURUMU) ===
// Profil verisi, eleman üretimi ve bütün profil hesabı calc.js'tedir
// (PROFILE_KINDS, profileRects, hesaplaBurulmaProfil). Burada yalnız arayüzün
// durumu ve sözlüğe bağlı etiket kalır.

function profileKindLabel(kind) {
    const k = PROFILE_KINDS[kind];
    return k ? t(k.labelKey) : kind;
}

// Kesitte bir profil varsa burada durur; yoksa null (daire/tek dikdörtgen yolu)
let profileDef = null;

function rebuildProfileRects() {
    rectangles.length = 0;
    circles.length = 0;
    if (profileDef) rectangles.push(...profileRects(profileDef));
}

// === HESAP (ARAYÜZ BAĞLANTISI) ===
// Hesabın kendisi calc.js'tedir (computeSection, saf). Burada yalnız girdiler
// DOM'dan okunur, sonuç `calc`a kopyalanır ve panel/durum/3B tazelenir.

// Kesit boştan geçerli bir kesite geçince (elle ilk parça eklenince ya da bir
// model yüklenince) 3B önizlemeyi (PiP) tetikler; kesit boşalınca kapatır. Bunu
// hesapla()'nın kendi 20 çağrı noktasına dağıtmak yerine tek bir sarmalayıcıda
// tutmak, hesap mantığını (hesaplaCore) bu bildirimden ayrı tutar.
let section3DShowable = false;
function hesapla() {
    hesaplaCore();
    const empty = sectionIsEmpty();
    if (empty) {
        call3D('hidePip');
    } else if (!section3DShowable && calc.errorState === null) {
        call3D('showPip');
    }
    section3DShowable = !empty && calc.errorState === null;
}

function hesaplaCore() {
    const tInput = parseFloat(inputs.tbTorsion ? inputs.tbTorsion.value : 0) || 0;
    const res = computeSection({ circles, rectangles, profileDef }, tInput * 1e6);   // kNm → N·mm

    // calc AYNI nesne kalır ve yerinde yenilenir: çizim, panel ve script3d.js ona
    // başvurur. Önce boşaltılır ki önceki kesitten hiçbir alan kalmasın.
    Object.keys(calc).forEach(k => { delete calc[k]; });
    Object.assign(calc, res);

    updateOutputs();
    updateStatus();
    call3D('update');
}

// === ÇUBUK BOYU VE AÇI BİRİMİ ===

// Kesitin en büyük yatay/düşey açıklığı — otomatik çubuk boyunun dayanağı.
// Hata durumunda calc sıfırlandığı için sınırlar doğrudan parçalardan okunur.
function sectionMaxSpan() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    circles.concat(rectangles).forEach(s => {
        const b = shapeBounds(s);
        if (b.xMin < minX) minX = b.xMin;
        if (b.xMax > maxX) maxX = b.xMax;
        if (b.yMin < minY) minY = b.yMin;
        if (b.yMax > maxY) maxY = b.yMax;
    });
    if (!isFinite(minX)) return 0;
    return Math.max(maxX - minX, maxY - minY);
}

// Otomatik moddayken boyu tazeler ve tüm çubuk boyu alanlarını eşler.
// Alanlar odaktayken yazılmaz: kullanıcı rakam girerken değeri altından değişmesin.
function syncBarLength() {
    if (barLengthAuto) {
        const span = sectionMaxSpan();
        if (span > 0) barLength = span * 10;   // kesit boşken son boy korunur
    }
    document.querySelectorAll('[data-bar-length]').forEach(el => {
        if (el === document.activeElement) return;
        el.value = String(Math.round(barLength));
    });
}

// Kullanıcı girişi: boş/geçersiz değer otomatiğe döndürür (bkz. barLengthAuto)
function applyBarLengthInput(el) {
    const v = parseFloat(el.value);
    barLengthAuto = !isFinite(v);
    if (!barLengthAuto) barLength = Math.max(0, v);
    syncBarLength();
    // change olayı ancak giriş bitince (blur/Enter) gelir; alanın kendisi de o an
    // yazılabilir — boşaltılan alanda otomatik boy hemen görünsün diye gerekli,
    // çünkü syncBarLength odaktaki alanı atlar
    el.value = String(Math.round(barLength));
    updateOutputs();
    call3D('update');
}

// rad → seçili birim
function angleFactor() {
    return angleUnit === 'deg' ? RAD2DEG : 1;
}

function angleUnitLabel() {
    return angleUnit === 'deg' ? '°' : 'rad';
}

function setAngleUnit(unit) {
    angleUnit = (unit === 'deg') ? 'deg' : 'rad';
    prefSet(ANGLE_UNIT_KEY, angleUnit);
    document.querySelectorAll('[data-angle-unit]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-angle-unit') === angleUnit);
    });
    updateOutputs();
    // 3B geometri değişmez, yalnız okuma alanları tazelenir
    call3D('updateDeformReadouts');
}

// === ÇIKTI GÜNCELLEME ===
function updateOutputs() {
    // Moment dosyadan yüklenmiş veya başka yerden değişmiş olabilir
    syncTorsionSlider();

    // Etiketlerin ve bazı satırların görünürlüğü kesit tipine bağlıdır
    // Dikdörtgende ve profilde burulma atalet momenti (It) gösterilir; kutupsal
    // atalet momenti bu ailelerde burulmayı yönetmez
    const isRectSection = calc.sectionType === 'rect' || calc.sectionType === 'profile';

    // 1. Atalet momentleri
    if (outputs.valIx) outputs.valIx.textContent = formatNumber(calc.Ix);
    if (outputs.valIy) outputs.valIy.textContent = formatNumber(calc.Iy);
    if (outputs.valIxy) outputs.valIxy.textContent = formatNumber(calc.Ixy);

    // Listenin dördüncü satırı: dairede kutupsal atalet momenti (Ip = Ix + Iy),
    // dikdörtgen/profilde burulma atalet momenti It — calc.Ip ikisini de taşır.
    // Ayrı polar kutusu kaldırıldığından It'nin panelde yazıldığı tek yer burasıdır.
    if (outputs.valIpPolar) outputs.valIpPolar.textContent = formatNumber(calc.Ip);
    updateInertiaPartList(isRectSection);

    // 2. Geometrik özellikler
    if (outputs.valArea) outputs.valArea.textContent = formatNumber(calc.area);

    // 3. Burulma gerilmeleri
    // Dikdörtgende ikinci değer τ₂'dir (kısa kenar ortası); dairesel kesitte τmin
    // (bantların iç kenarlarındaki en küçük değer). Etiketler kesit tipine göre değişir.
    if (outputs.valTauMax) outputs.valTauMax.textContent = calc.tauMax.toFixed(2);
    if (outputs.valTauMin) {
        outputs.valTauMin.textContent =
            (calc.sectionType === 'rect' ? calc.tauSecond : (calc.tauMin || 0)).toFixed(2);
    }

    const setLabel = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };
    setLabel('lblTauMin', calc.sectionType === 'rect'
        ? 'τ<span class="sub">2</span>' : 'τ<span class="sub">min</span>');
    setLabel('lblIpPolar', isRectSection
        ? 'I<span class="sub">t</span>' : 'I<span class="sub">p</span>');
    setLabel('lblGIp', isRectSection
        ? 'GI<span class="sub">t</span>' : 'ΣGI<span class="sub">p</span>');

    updateStressModeRow();

    // 4. Burulma rijitliği, birim dönme açısı (θ′) ve bağıl dönme açısı (φ = θ′·L)
    if (outputs.valGIp) outputs.valGIp.textContent = formatNumber(calc.GIp / 1e9); // N·mm² → kNm²

    syncBarLength();
    const f = angleFactor();
    // θ′ metrede yazılır (rad/mm okunmayacak kadar küçük), φ mutlak açıdır
    if (outputs.valTheta) {
        outputs.valTheta.textContent = formatAngle(calc.thetaPrime * 1000 * f);
    }
    if (outputs.valPhi) {
        outputs.valPhi.textContent = formatAngle(calc.thetaPrime * barLength * f);
    }
    const unitTheta = document.getElementById('unitTheta');
    if (unitTheta) unitTheta.textContent = angleUnitLabel() + '/m';
    const unitPhi = document.getElementById('unitPhi');
    if (unitPhi) unitPhi.textContent = angleUnitLabel();

    // 5. Eleman bazında iç kuvvetler ve gerilmeler (kompozit kesit)
    updateTauPartList();

    updateShapesList();
}

// Çok elemanlı kesitte eleman bazındaki listelerin ortak parçaları: başlık (renk +
// ad) ve tek elemandaki salt okunur satırın aynısı. Atalet ve kayma kutusu aynı
// biçimi kullanır ki iki kutu aynı elemanları aynı sırayla göstersin.
function makePartHead(kind, index, suffix) {
    const shape = kind === 'circle' ? circles[index] : rectangles[index];
    const mat = shape ? shapeColor(shape, index) : getMaterialColor(index);
    const head = document.createElement('div');
    head.className = 'sub-panel-title inertia-part-head';
    const swatch = document.createElement('span');
    swatch.className = 'material-swatch';
    swatch.style.background = mat.fill;
    swatch.style.borderColor = mat.stroke;
    const nameEl = document.createElement('span');
    nameEl.textContent = shape ? shapeLabel(shape, index) : (t('partLabel') + ' ' + (index + 1));
    head.appendChild(swatch);
    head.appendChild(nameEl);
    if (suffix) {
        const suf = document.createElement('span');
        suf.textContent = suffix;
        head.appendChild(suf);
    }
    return head;
}

function makeReadonlyRow(labelHtml, value, unit) {
    const row = document.createElement('div');
    row.className = 'input-row single-col';
    row.innerHTML = '<div class="input-group readonly">'
        + '<span class="math-label">' + labelHtml + '</span>'
        + '<span class="value-readonly">' + value + '</span>'
        + '<span class="unit-input">' + unit + '</span></div>';
    return row;
}

// Toplam satırlarını gizleyip eleman listesini açar (ya da tersini); liste
// açıksa boşaltılmış kabı döndürür, değilse null
function togglePartList(listId, totalsId, multi) {
    const list = document.getElementById(listId);
    const totals = document.getElementById(totalsId);
    if (totals) totals.style.display = multi ? 'none' : 'block';
    if (!list) return null;
    list.innerHTML = '';
    list.style.display = multi ? 'block' : 'none';
    return multi ? list : null;
}

// Eleman bazında atalet momentleri. Çok elemanlı kesitte (kompozit mil) TOPLAM
// satırları gizlenir ve her eleman tek elemandaki satır biçimiyle kendi değerlerini
// alır: toplamla birlikte yazıldığında kullanıcı iki eleman için üç takım değer
// görüyor, toplamı da bir elemanınki sanıyordu. Ip, kutupsal satırla aynı nedenle
// yalnız dairesel kesitte yazılır (dikdörtgen/profilde burulmayı It yönetir).
function updateInertiaPartList(isRectSection) {
    const parts = calc.partInertias;
    const list = togglePartList('inertiaPartList', 'inertiaTotalRows', !!(parts && parts.length > 1));
    if (!list) return;
    parts.forEach(p => {
        list.appendChild(makePartHead(p.kind, p.index));
        const terms = [['x', p.Ix], ['y', p.Iy], ['xy', p.Ixy]];
        if (!isRectSection) terms.push(['p', p.Ip]);
        terms.forEach(([sub, v]) => {
            list.appendChild(makeReadonlyRow('I<span class="sub">' + sub + '</span>', formatNumber(v), 'mm⁴'));
        });
    });
}

// Kayma gerilmeleri kompozit milde eleman bazındadır (atalet kutusuyla aynı
// nedenle): kesitin τmax/τmin'i elemanların yanında üçüncü bir takım gibi
// okunuyordu. Kesitin τmax'ı elemanların τ_dış'larının en büyüğüdür, τmin'i
// τ_iç'lerin en küçüğü — ikisi de listede zaten görünür. Her elemanın taşıdığı
// moment payı T_i = G_i·θ′·J_i (ΣT_i = T) de buradadır, kutunun adı bu yüzden
// "iç kuvvetler ve kayma gerilmeleri" olur. Ad data-i18n anahtarı değiştirilerek
// verilir ki dil değişince applyTranslations() eski adı geri yazmasın. Sözlükteki τ_iç/τ_dış
// değerleri "τ" + kısaltma biçimindedir; kısaltma alt simgeye alınır ki satır
// tek elemandaki τ_max/τ_min etiketleriyle aynı görünsün.
function tauSubLabel(key) {
    return 'τ<span class="sub">' + t(key).replace(/^τ_?/, '') + '</span>';
}

function updateTauPartList() {
    const bands = calc.torsionBands;
    const multi = calc.sectionType === 'circular' && !!(bands && bands.length > 1);
    const title = document.getElementById('lblShearBoxTitle');
    if (title) {
        const key = multi ? 'internalForcesShearTitle' : 'shearStressTitle';
        title.setAttribute('data-i18n', key);
        title.textContent = t(key);
    }
    const list = togglePartList('tauPartList', 'tauTotalRows', multi);
    if (!list) return;
    bands.slice().sort((a, b) => a.index - b.index).forEach(b => {
        list.appendChild(makePartHead('circle', b.index, '(G = ' + b.G + ' GPa)'));
        list.appendChild(makeReadonlyRow('T<span class="sub">i</span>', formatNumber(b.torque / 1e6), 'kNm'));
        list.appendChild(makeReadonlyRow(tauSubLabel('tauInner'), b.tauIn.toFixed(2), 'MPa'));
        list.appendChild(makeReadonlyRow(tauSubLabel('tauOuter'), b.tauOut.toFixed(2), 'MPa'));
    });
}

// Köşegen seçeneği yalnızca dikdörtgen kesitte ve diyagram açıkken görünür;
// dairesel kesitte köşegen diye bir şey yoktur
function updateStressModeRow() {
    const row = document.getElementById('stressModeRow');
    if (!row) return;
    const stressOn = !controls.cbStress || controls.cbStress.checked;
    row.style.display = (calc.sectionType === 'rect' && stressOn) ? 'flex' : 'none';
}

// 1.23×10⁴ biçimi — üst simge rakamlar, panelde de SVG'de de aynı görünsün diye
function toSuperscriptExp(num, digits) {
    const parts = num.toExponential(digits).split('e');
    const mantissa = parseFloat(parts[0]);
    const exponent = parseInt(parts[1]);

    const superscripts = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    const expStr = exponent.toString().split('').map(d => {
        if (d === '-') return '⁻';
        return superscripts[parseInt(d)];
    }).join('');

    return mantissa.toFixed(digits) + '×10' + expStr;
}

function formatNumber(num) {
    if (!isFinite(num)) return '∞';
    if (Math.abs(num) < 0.01) return '0.00';
    if (Math.abs(num) >= 1e6) return toSuperscriptExp(num, 2);
    return num.toFixed(2);
}

// Dönme açıları radyanda çok küçük çıkar (tipik olarak 10⁻³ mertebesi);
// formatNumber bunları 0.00'a yuvarlardı. Burada ondalık sayısı büyüklüğe göre
// seçilir, böylece birim değişse de hep dört anlamlı basamak okunur.
function formatAngle(num) {
    if (!isFinite(num)) return '∞';
    const a = Math.abs(num);
    if (a < 1e-12) return '0.0000';
    if (a >= 1e5 || a < 1e-4) return toSuperscriptExp(num, 3);
    const dec = Math.min(8, Math.max(2, 3 - Math.floor(Math.log10(a))));
    return num.toFixed(dec);
}

// === GÜNCELLE ===
function updateAll() {
    hesapla();
    draw();
}

// === BAŞLAT ===
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('load', () => {
    resizeCanvas();
    updateAll();
});

function initPanelResizer() {
    const resizer = document.getElementById('panel-resizer');
    const centerPanel = document.getElementById('center-panel');
    let isResizingPanel = false;

    if (!resizer) return;

    resizer.addEventListener('mousedown', (e) => {
        isResizingPanel = true;
        document.body.classList.add('resizing');
        resizer.classList.add('resizing');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizingPanel) return;

        const middleArea = document.getElementById('middle-area');
        if (!middleArea) return;

        const middleRect = middleArea.getBoundingClientRect();
        const mouseX = e.clientX;

        let leftWidth = mouseX - middleRect.left - 15;

        const totalWidth = middleRect.width;
        const netAvailable = totalWidth - 45;

        const minWidth = 150;
        if (leftWidth < minWidth) leftWidth = minWidth;
        if (leftWidth > netAvailable - minWidth) leftWidth = netAvailable - minWidth;

        centerPanel.style.flex = `0 0 ${leftWidth}px`;

        resizeCanvas();
        call3D('onResize');
    });

    document.addEventListener('mouseup', () => {
        if (isResizingPanel) {
            isResizingPanel = false;
            document.body.classList.remove('resizing');
            resizer.classList.remove('resizing');

            resizeCanvas();
            call3D('onResize');
        }
    });
}
