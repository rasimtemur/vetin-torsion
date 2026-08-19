// --- SCRIPT.JS : BURULMA (TORSION) HESAP VE ÇİZİM MANTIĞI ---
//
// Bu uygulama dairesel ve halka (içi boş dairesel) enkesitlerin burulma
// analizini yapar. Farklı malzemelerden (farklı kayma modülü G) oluşan
// eş merkezli kompozit kesitler de desteklenir:
//
//   Uygunluk:  θ' tüm malzemelerde ortaktır (kesitler düzlem kalır)
//   Denge:     T = θ' · Σ(G_i · Ip_i)   →   θ' = T / Σ(G_i · Ip_i)
//   Gerilme:   τ_i(ρ) = G_i · θ' · ρ     (her malzeme bandında doğrusal)
//
// Tek malzemede bu bağıntı klasik τ = T·ρ/Ip ifadesine indirgenir.

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
    valIp: document.getElementById('valIp'),
    valWt: document.getElementById('valWt'),
    valGIp: document.getElementById('valGIp'),
    valTheta: document.getElementById('valTheta')
};

// Kontroller
const controls = {
    cbAxes: document.getElementById('cbAxes'),
    cbStress: document.getElementById('cbStress'),
    cbForceVector: document.getElementById('cbForceVector'),
    cbPartBorders: document.getElementById('cbPartBorders'),
    cbDimensions: document.getElementById('cbDimensions'),
    cbGeometricCenter: document.getElementById('cbGeometricCenter'),
    cb3DView: document.getElementById('cb3DView')
};

// Status label
const statusLabel = document.getElementById('statusLabel');
const dimensionLabel = document.getElementById('dimensionLabel');

// === GLOBAL DEĞİŞKENLER ===
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Hesap modu: 'burulma'
const calcMode = 'burulma';

// Varsayılan kayma modülü (GPa) — çelik
const DEFAULT_G = 80;

// Gerilme diyagramının görsel ölçeği: τmak oku, dış yarıçapın bu katı kadar uzar
const STRESS_DIAGRAM_REACH = 0.95;

// Gerilme oklarının dolu üçgen ucunun boyu (px)
const STRESS_ARROW_HEAD = 12;

// Dikdörtgen kesitte gerilme diyagramının çizildiği yer:
//   'axes'     → iki simetri ekseni (kenar ortalarına giden doğrultular)
//   'diagonal' → tek köşegen (simetri ekseni değildir; köşede ve merkezde τ = 0)
//   'all'      → yatay eksen + düşey eksen + köşegen, tek diyagramda
let stressDiagramMode = 'axes';

// Köşegen diyagramında yarım köşegen başına ordinat (çubuk) sayısı; zarf eğrisi
// bunun DENSITY katı noktadan geçirilir
const DIAGONAL_ORDINATES = 10;
const DIAGONAL_ENVELOPE_DENSITY = 6;

// Burulma momenti yayı: kesit boyutunun bu katı yarıçapta, referans figürdeki kırmızı
const MOMENT_ARC_SCALE = 0.15;
const MOMENT_COLOR = '#D0021B';
const MOMENT_LINE_WIDTH = 5;
const MOMENT_ARROW_HEAD = 16;

// Yarıçap ölçü oklarının açı bandı (ekranda sağ-üst çeyrek; yukarı = negatif).
// Moment yayının boşluğu bu bandı iki yandan MOMENT_GAP_MARGIN kadar aşarak
// bırakılır; böylece ölçü okları yayı ve yayın ok ucunu kesmez.
const RADIUS_LEADER_A1 = -20 * Math.PI / 180;
const RADIUS_LEADER_A2 = -55 * Math.PI / 180;
const MOMENT_GAP_MARGIN = 25 * Math.PI / 180;

// Malzeme renk paleti (dolgu + kenar); her kesit parçasına sırayla atanır
// Palet tema başına ayrılır: açık temanın pastel dolguları koyu zeminde parlak
// birer leke gibi duruyordu, ozalitte ise mavi kâğıtla hiç uyuşmuyordu.
// Koyu temanın İLK rengi 3B görünümün çubuk rengiyle (script3d.js get3DColors)
// birebir aynıdır — aynı kesit iki pencerede aynı renkte görünsün diye referans
// oradan alınır. Diğer renkler de aynı mantıkla kurulur: koyu dolgu + parlak kontur.
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
// 3B görünüm (script3d.js) malzeme renklerine buradan erişir
window.getMaterialColor = getMaterialColor;

function shapeColor(c, fallbackIndex) {
    const idx = (typeof c.colorIdx === 'number') ? c.colorIdx : fallbackIndex;
    return getMaterialColor(idx);
}

// Kesit elemanları: dolu daire (ri = 0) veya halka (ri > 0)
// { type:'circle', cx, cy, r, ri, G (GPa), colorIdx }
let circles = [];
let colorSeq = 0; // yeni eklenen kesite renk sırası

// Dikdörtgen/kare kesit: { type:'rect', x1, y1, x2, y2, G (GPa), colorIdx }
// En çok bir adet bulunur ve dairesel parçalarla aynı kesitte kullanılamaz:
// dairesel burulmada kesitler düzlem kalır (τ = G·θ'·ρ), dikdörtgende kesit
// çarpılır ve Saint-Venant çözümü gerekir — ikisi toplanamaz.
let rectangles = [];
let holes = []; // script3d.js uyumluluğu (bu modülde kullanılmıyor)

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

// Hesaplanan değerler
let calc = {
    // Geometrik
    area: 0,
    centroidX: 0,
    centroidY: 0,

    // Atalet momentleri
    Ix: 0,
    Iy: 0,
    Ixy: 0,
    I1: 0,
    I2: 0,
    phi: 0,

    // Kesit sınırları
    xMin: 0, xMax: 0,
    yMin: 0, yMax: 0,

    // Kesit tipi: 'empty' | 'circular' (daire/halka kompozit) | 'rect' (dikdörtgen/kare)
    sectionType: 'empty',
    // Dikdörtgen kesitte Saint-Venant sonuçları:
    // { w, h, a, b, q, alpha, beta, gamma, It, tauLong, tauShort, longIsHorizontal }
    rectInfo: null,
    tauSecond: 0,     // Dikdörtgende kısa kenar ortasındaki gerilme (MPa)

    // Burulma
    torsion: 0,       // Uygulanan burulma momenti (Nmm)
    Ip: 0,            // Toplam polar atalet momenti (mm⁴)
    GIp: 0,           // Toplam burulma rijitliği Σ(G·Ip) (N·mm²)
    thetaPrime: 0,    // Birim burulma açısı (rad/mm)
    thetaDegPerM: 0,  // Birim burulma açısı (°/m)
    Wt: 0,            // Burulma mukavemet momenti (mm³)
    tauMax: 0,        // En büyük kayma gerilmesi (MPa, işaretli)
    tauMin: 0,        // En içteki malzemenin iç yarıçapındaki gerilme (MPa)
    rhoMax: 0,        // En dış yarıçap
    rhoMin: 0,        // En içteki malzemenin iç yarıçapı
    torsionBands: null, // [{rIn, rOut, G, J, tauIn, tauOut, index}] (rOut artan)
    torsionRay: null, // Diyagram yarıçap bandı {rInner, rOuter, dirX}
    maxStressPoint: null,
    minStressPoint: null,

    // Hata durumu: null | 'overlap' | 'concentric'
    errorState: null
};

// === TEMA YÖNETİMİ ===
function updateThemeSubmenuActive() {
    const currentTheme = localStorage.getItem('theme') || 'light';
    ['light', 'dark', 'blueprint'].forEach(t => {
        const btn = document.getElementById('submenu-theme-' + t);
        if (btn) btn.classList.toggle('active', t === currentTheme);
    });
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme, false);

    const settingsMenuBtn = document.getElementById('settings-menu-toggle-left');
    const settingsMenu = document.getElementById('settingsMenuLeft');
    if (settingsMenuBtn && settingsMenu) {
        settingsMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsMenu.classList.toggle('show');
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

function setTheme(theme, shouldRedraw = true) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeSubmenuActive();

    if (shouldRedraw) {
        setTimeout(() => {
            if (typeof draw === 'function') draw();
            if (typeof window.update3DVisualization === 'function') window.update3DVisualization();
            if (typeof window.update3DTheme === 'function') window.update3DTheme();
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
// Sayfa başlığındaki mod adı (translations.js'de burulma anahtarı bulunmadığından yerel tablo)
const TORSION_MODE_LABELS = {
    tr: 'Burulma', en: 'Torsion', de: 'Torsion', zh: '扭转',
    es: 'Torsión', it: 'Torsione', pt: 'Torção', fr: 'Torsion',
    ru: 'Кручение', ar: 'الالتواء', ja: 'ねじり', ko: '비틀림',
    fa: 'پیچش', el: 'Στρέψη', ro: 'Torsiune', bg: 'Усукване',
    id: 'Torsi', hi: 'मरोड़', az: 'Burulma'
};

function torsionModeLabel() {
    const lang = (typeof currentLanguage !== 'undefined' && currentLanguage) || 'tr';
    return TORSION_MODE_LABELS[lang] || 'Torsion';
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

    updateTorsionTitle();
    window.addEventListener('languageChanged', updateTorsionTitle);

    setupEventListeners();

    // Başlangıç görünüm ayarlarını kaydet
    initialViewState = { ...viewState };

    // Uygulama başlangıcında 3B görünüm durumunu kontrol et
    if (controls.cb3DView && controls.cb3DView.checked) {
        const middleArea = document.getElementById('middle-area');
        if (middleArea) middleArea.classList.add('view-3d-active');
        document.body.classList.add('view-3d-active');
        if (typeof init3D === 'function') init3D();
    }

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
    }, 50);
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

    // Zoom butonları
    document.getElementById('btnZoomIn')?.addEventListener('click', () => applyZoom(1.2));
    document.getElementById('btnZoomOut')?.addEventListener('click', () => applyZoom(1 / 1.2));
    document.getElementById('btnResetView')?.addEventListener('click', fitToScreen);

    // Dosya butonları
    const btnSideOpen = document.getElementById('btnSideOpen');
    const btnSideSave = document.getElementById('btnSideSave');
    if (btnSideOpen) btnSideOpen.addEventListener('click', openProject);
    if (btnSideSave) btnSideSave.addEventListener('click', saveProject);

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
        btnExportSVG.addEventListener('click', exportToSVG);
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

    // 3B görünüm
    if (controls.cb3DView) {
        controls.cb3DView.addEventListener('change', () => {
            const middleArea = document.getElementById('middle-area');
            if (middleArea) middleArea.classList.toggle('view-3d-active', controls.cb3DView.checked);
            document.body.classList.toggle('view-3d-active', controls.cb3DView.checked);
            if (controls.cb3DView.checked) {
                if (typeof init3D === 'function') init3D();
            } else {
                const centerPanel = document.getElementById('center-panel');
                if (centerPanel) centerPanel.style.flex = '';
            }

            setTimeout(() => {
                resizeCanvas();
                if (typeof onResize3D === 'function') onResize3D();
                draw();
                if (typeof window.update3DVisualization === 'function') {
                    window.update3DVisualization();
                }
            }, 50);
        });
    }

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
        statusLabel.textContent = '🚧 ' + (ringDraft.r1 === null
            ? 'Halkanın çaplarından biri için tıklayın (Esc: iptal)'
            : 'Halkanın diğer çapı için tıklayın (Esc: iptal)');
        return;
    }

    // Hesap hatası varsa uyarıyı koru
    if (calc.errorState === 'overlap') {
        statusLabel.textContent = '⚠️ Kesit parçaları çakışamaz! Çakışan parçayı silin veya taşıyın.';
        return;
    }
    if (calc.errorState === 'concentric') {
        statusLabel.textContent = '⚠️ Burulma hesabı için tüm parçalar eş merkezli olmalıdır.';
        return;
    }
    if (calc.errorState === 'mixed') {
        statusLabel.textContent = '⚠️ Dikdörtgen ve dairesel kesitler birlikte hesaplanamaz (farklı burulma teorileri).';
        return;
    }
    if (calc.errorState === 'multiRect') {
        statusLabel.textContent = '⚠️ Kesitte yalnızca bir dikdörtgen/kare bulunabilir.';
        return;
    }

    const messages = {
        circle: t('statusDrawCircle'),
        ring: 'Halka merkezi için tıklayın',
        rect: 'Dikdörtgen için köşeden köşeye sürükleyin (Shift: kare)',
        move: 'Modeli düzenle',
        pan: 'Çizimi taşı'
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

function ringArea(c) {
    const ri = c.ri || 0;
    return Math.PI * (c.r * c.r - ri * ri);
}

function shapeLabel(c, index) {
    if (c.type === 'rect') {
        const d = rectDims(c);
        return (Math.abs(d.w - d.h) < 1e-9 ? 'Kare ' : 'Dikdörtgen ') + (index + 1);
    }
    return ((c.ri || 0) > 0 ? 'Halka ' : 'Daire ') + (index + 1);
}

// === DİKDÖRTGEN/KARE KESİT YARDIMCILARI ===
function newRect(x1, y1, x2, y2) {
    return {
        type: 'rect', x1, y1, x2, y2,
        G: DEFAULT_G,
        colorIdx: (colorSeq++) % MATERIAL_COLOR_COUNT
    };
}

function rectDims(r) {
    return {
        w: Math.abs(r.x2 - r.x1),
        h: Math.abs(r.y2 - r.y1),
        cx: (r.x1 + r.x2) / 2,
        cy: (r.y1 + r.y2) / 2
    };
}

function rectArea(r) {
    const d = rectDims(r);
    return d.w * d.h;
}

// Merkezi ve kenar uzunlukları verilen dikdörtgeni köşe koordinatlarına çevirir
function setRectSize(r, w, h) {
    const d = rectDims(r);
    r.x1 = d.cx - w / 2; r.x2 = d.cx + w / 2;
    r.y1 = d.cy - h / 2; r.y2 = d.cy + h / 2;
}

// Kesitte hangi model geçerli: dairesel kompozit mi, tek dikdörtgen mi?
function sectionType() {
    if (rectangles.length > 0) return 'rect';
    if (circles.length > 0) return 'circular';
    return 'empty';
}

// Kesitte hiç parça var mı (her iki model için)
function sectionIsEmpty() {
    return circles.length === 0 && rectangles.length === 0;
}

// Bir parçanın sınırlayıcı kutusu (daire/halka veya dikdörtgen)
function shapeBounds(s) {
    if (s.type === 'rect' || s.x1 !== undefined) {
        return {
            xMin: Math.min(s.x1, s.x2), xMax: Math.max(s.x1, s.x2),
            yMin: Math.min(s.y1, s.y2), yMax: Math.max(s.y1, s.y2)
        };
    }
    return { xMin: s.cx - s.r, xMax: s.cx + s.r, yMin: s.cy - s.r, yMax: s.cy + s.r };
}

// Yeni parça eklenebilir mi? Dairesel ve dikdörtgen modeller karışamaz;
// dikdörtgen kesit tek parçadır (kompozit dikdörtgen için elemanter çözüm yoktur).
function canAddPart(kind) {
    return kind === 'rect' ? sectionIsEmpty() : rectangles.length === 0;
}

function showPartConflict(kind) {
    if (!statusLabel) return;
    statusLabel.textContent = (kind === 'rect' && rectangles.length > 0)
        ? '⚠️ Kesitte yalnızca bir dikdörtgen/kare bulunabilir.'
        : '⚠️ Dikdörtgen ve dairesel kesitler birlikte hesaplanamaz (farklı burulma teorileri). Önce kesiti temizleyin.';
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
            hesapla();
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

function constrainView() {
    const maxX = WORLD_SIZE_X;
    const maxY = WORLD_SIZE_Y;

    const scale = viewState.zoom;

    const maxPanX = Math.max(0, (maxX * scale - canvas.width) / 2);
    const maxPanY = Math.max(0, (maxY * scale - canvas.height) / 2);

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
    const yOffset = -(canvas.height * 0.05);
    viewState.panY = -(sectionCenterY - gridCenterY) * currentScale + yOffset;

    draw();
}

// === TEMİZLE ===
function clearAll() {
    circles = [];
    rectangles = [];
    holes = [];
    isDrawing = false;
    ringDraft = null;
    colorSeq = 0;
    selectedElement = null;
    hesapla();
    draw();
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
        viewState: viewState,
        inputs: {
            tbTorsion: inputs.tbTorsion ? inputs.tbTorsion.value : '1.50'
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

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);

            let skipped = 0;

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

            // Dikdörtgen/kare kesit (v2.1). Dairesel parçalarla birlikte
            // hesaplanamadığı için yalnızca biri yüklenir.
            let loadedRects = [];
            if (Array.isArray(data.rectangles)) {
                data.rectangles.forEach((r, i) => {
                    const ok = ['x1', 'y1', 'x2', 'y2'].every(k => typeof r[k] === 'number');
                    if (!ok || Math.abs(r.x2 - r.x1) < 1e-9 || Math.abs(r.y2 - r.y1) < 1e-9) { skipped++; return; }
                    if (loadedRects.length > 0 || loaded.length > 0) { skipped++; return; }
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
            holes = [];
            ringDraft = null;
            colorSeq = loaded.length + loadedRects.length;
            selectedElement = null;

            if (data.gridSpacing) {
                gridSpacing = data.gridSpacing;
                const tbGridSize = document.getElementById('tbGridSize');
                if (tbGridSize) tbGridSize.value = gridSpacing;
            }
            if (data.viewState) viewState = data.viewState;

            if (data.inputs && inputs.tbTorsion) {
                if (data.inputs.tbTorsion !== undefined) {
                    inputs.tbTorsion.value = data.inputs.tbTorsion;
                }
            }

            updateAll();

            if (skipped > 0) {
                alert('Bilgi: Burulma modülü dairesel/halka kesitleri veya tek bir ' +
                      'dikdörtgen/kare kesiti destekler (ikisi birlikte hesaplanamaz). ' +
                      skipped + ' adet desteklenmeyen eleman atlandı.');
            }

            if (statusLabel) statusLabel.textContent = t('statusReady');

        } catch (err) {
            console.error("Error parsing project file:", err);
            alert("Dosya okuma hatası!");
        }
        if (event.target && event.target.value) {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
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

    circles.forEach((c, i) => {
        const div = document.createElement('div');
        div.className = 'shape-item shape-item-torsion';
        div.dataset.index = i;
        if (selectedElement && selectedElement.type === 'circle' && selectedElement.index === i) {
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

        inputRow.appendChild(makeField('r<sub>dış</sub>', c.r, 1, 1, (v) => {
            c.r = Math.max(Math.max(1, v), (c.ri || 0) + 1);
        }, 'mm'));

        inputRow.appendChild(makeField('r<sub>iç</sub>', (c.ri || 0), 0, 1, (v) => {
            c.ri = Math.min(Math.max(0, v), c.r - 1);
        }, 'mm'));

        const gField = makeField('G', (typeof c.G === 'number' ? c.G : DEFAULT_G), 0.1, 1, (v) => {
            c.G = Math.max(0.1, v);
        }, 'GPa');
        gField.classList.add('shape-prop-field-wide');
        inputRow.appendChild(gField);

        div.appendChild(headRow);
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
        if (selectedElement && selectedElement.type === 'rect' && selectedElement.index === i) {
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

        div.appendChild(headRow);
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

// === HESAPLAMA FONKSİYONLARI ===

// Bir nokta kesit parçasının (dolu daire / halka) malzemesi içinde mi?
function isPointInShape(px, py, shape) {
    if (shape.x1 !== undefined || shape.type === 'rect') {
        const x1 = Math.min(shape.x1, shape.x2);
        const x2 = Math.max(shape.x1, shape.x2);
        const y1 = Math.min(shape.y1, shape.y2);
        const y2 = Math.max(shape.y1, shape.y2);
        return px >= x1 && px <= x2 && py >= y1 && py <= y2;
    }
    const dx = px - shape.cx;
    const dy = py - shape.cy;
    const distSq = dx * dx + dy * dy;
    if (distSq > shape.r * shape.r) return false;
    const ri = shape.ri || 0;
    if (ri > 0 && distSq < ri * ri) return false;
    return true;
}

// İki dairesel parçanın (halka/dolu) malzemeleri örtüşüyor mu?
function circlesOverlap(c1, c2) {
    const eps = 1e-6;
    const dx = c1.cx - c2.cx;
    const dy = c1.cy - c2.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r1o = c1.r, r1i = c1.ri || 0;
    const r2o = c2.r, r2i = c2.ri || 0;

    if (dist < eps) {
        // Eş merkezli: radyal aralıklar [ri, r] kesişiyorsa malzemeler örtüşür
        return Math.max(r1i, r2i) < Math.min(r1o, r2o) - eps;
    }

    if (dist >= r1o + r2o - eps) return false;   // ayrık
    if (dist + r2o <= r1i + eps) return false;   // c2 tamamen c1'in boşluğunda
    if (dist + r1o <= r2i + eps) return false;   // c1 tamamen c2'nin boşluğunda
    return true;
}

function shapesIntersect(s1, s2) {
    return circlesOverlap(s1, s2);
}

function checkIntersectionExists() {
    for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
            if (circlesOverlap(circles[i], circles[j])) return true;
        }
    }
    return false;
}

function isConcentric() {
    if (circles.length < 2) return true;
    const { cx, cy } = circles[0];
    return circles.every(c => Math.abs(c.cx - cx) < 1e-6 && Math.abs(c.cy - cy) < 1e-6);
}

// Malzeme bantları: [{rIn, rOut, G, index}] rOut'a göre artan sıralı
function getSectionBands() {
    return circles
        .map((c, i) => ({
            rIn: Math.max(0, c.ri || 0),
            rOut: c.r,
            G: (typeof c.G === 'number' && c.G > 0) ? c.G : DEFAULT_G,
            index: i
        }))
        .sort((a, b) => a.rOut - b.rOut);
}

// === DİKDÖRTGEN KESİTTE BURULMA (SAINT-VENANT) ===
// Dairesel kesitten farklı olarak dikdörtgen kesit burulmada çarpılır; τ = T·ρ/Ip
// geçerli değildir. Prandtl gerilme fonksiyonunun kesin seri çözümünden:
//   J  = β·a·b³                     (burulma atalet momenti; a = uzun, b = kısa kenar)
//   τ1 = T/(α·a·b²) = k1·G·θ'·b     (uzun kenar ortası — mutlak maksimum)
//   τ2 = γ·τ1       = k2·G·θ'·b     (kısa kenar ortası)
//   τ  köşelerde sıfırdır.
// Seriler tanh(x) = 1 − 2/(e^{2x}+1) ile kapalı toplamlara indirgendiğinden
// üstel hızla yakınsar. Katsayılar Timoshenko/Roark tablolarıyla doğrulanmıştır.
const CATALAN = 0.9159655941772190;               // Σ_{n tek} (−1)^((n−1)/2)/n²
const S5_ODD = (31 / 32) * 1.0369277551433699;    // Σ_{n tek} 1/n⁵

function rectTorsionCoeffs(q) {
    let s5corr = 0, sc = 0, stcorr = 0;
    for (let n = 1; n <= 199; n += 2) {
        const x = n * Math.PI * q;
        const inv = 1 / (Math.exp(x) + 1);        // x büyükse 0 (taşma güvenli)
        const sgn = (((n - 1) / 2) % 2 === 0) ? 1 : -1;
        s5corr += inv / Math.pow(n, 5);
        stcorr += sgn * inv / (n * n);
        sc += 1 / (n * n * Math.cosh(x / 2));
    }
    const beta = 1 / 3 - (64 / Math.pow(Math.PI, 5)) * (1 / q) * (S5_ODD - 2 * s5corr);
    const k1 = 1 - (8 / (Math.PI * Math.PI)) * sc;
    const k2 = (8 / (Math.PI * Math.PI)) * (CATALAN - 2 * stcorr);
    return { alpha: beta / k1, beta, gamma: k2 / k1, k1, k2 };
}

// Kenar orta noktasından merkeze doğru τ dağılımı (kesin seri).
// t ∈ [0,1]: 0 = kesit merkezi, 1 = kenar ortası. Dönen değer τ/τ(kenar).
// Uzun kenar ortasına giden eksende (kısa doğrultu) profil:
function rectTauProfileLong(t, q) {
    // τ_zx(0, y) ∝ Σ (−1)^m/n² [1 − 1/cosh(nπq/2)] sin(nπ t/2) ; t = 2y/b
    let num = 0, den = 0;
    for (let n = 1; n <= 199; n += 2) {
        const sgn = (((n - 1) / 2) % 2 === 0) ? 1 : -1;
        const c = 1 - 1 / Math.cosh(n * Math.PI * q / 2);
        num += sgn * c * Math.sin(n * Math.PI * t / 2) / (n * n);
        den += c / (n * n);   // t = 1'de sin(nπ/2) = (−1)^m → işaretler sadeleşir
    }
    return den !== 0 ? num / den : 0;
}

// Kısa kenar ortasına giden eksende (uzun doğrultu) profil; t = 2x/a
function rectTauProfileShort(t, q) {
    let num = 0, den = 0;
    for (let n = 1; n <= 199; n += 2) {
        const sgn = (((n - 1) / 2) % 2 === 0) ? 1 : -1;
        const A = n * Math.PI * q / 2;
        // sinh(A·t)/cosh(A) doğrudan hesaplanırsa büyük A'da ∞/∞ olur; pay ve
        // paydayı e^A'ya bölen taşma güvenli biçim (t = 1'de tanh(A) verir):
        const ratio = (Math.exp(A * (t - 1)) - Math.exp(-A * (t + 1))) / (1 + Math.exp(-2 * A));
        num += sgn * ratio / (n * n);
        den += sgn * Math.tanh(A) / (n * n);
    }
    return den !== 0 ? num / den : 0;
}

// Kesit içindeki HERHANGİ bir noktada kayma gerilmesi vektörü. Kenar ortası
// profilleri yalnızca iki merkez ekseni üzerinde tanımlıdır; köşegen diyagramı
// için alanın tamamı gerekir. Prandtl gerilme fonksiyonunun kesin serisinden
// τ_zx = ∂φ/∂y, τ_zy = −∂φ/∂x alınarak (G·θ′ = 1 birimlerinde, mm):
//   τx = −2y + (8h/π²) Σ_{n tek} (−1)^((n−1)/2)/n² · cosh(nπx/h)/cosh(nπw/2h) · sin(nπy/h)
//   τy =       (8h/π²) Σ_{n tek} (−1)^((n−1)/2)/n² · sinh(nπx/h)/cosh(nπw/2h) · cos(nπy/h)
// x, y kesit merkezine göredir. Doğrulandı: kenar ortalarında tam olarak k1·b ve
// k2·b verir, ∇²φ = −2Gθ′'nin sonlu fark çözümüyle ‰1'den iyi uyuşur.
const RECT_TAU_TERMS = 199;

function rectTauVectorCore(x, y, w, h) {
    // h ≤ w varsayılır: seriler e^{−nπ(w/2−|x|)/h} ile söndüğünden yakınsama hızlı
    const C = 8 * h / (Math.PI * Math.PI);
    let sx = 0, sy = 0;
    for (let n = 1; n <= RECT_TAU_TERMS; n += 2) {
        const A = n * Math.PI * w / (2 * h);
        const B = n * Math.PI * x / h;
        // cosh(B)/cosh(A) ve sinh(B)/cosh(A) doğrudan hesaplanırsa büyük A'da
        // ∞/∞ olur; |x| ≤ w/2 iken üsler daima ≤ 0 olan taşma güvenli biçim:
        const e = 1 + Math.exp(-2 * A);
        const p = Math.exp(B - A), m = Math.exp(-B - A);
        const sgn = (((n - 1) / 2) % 2 === 0) ? 1 : -1;
        const ang = n * Math.PI * y / h;
        sx += sgn * ((p + m) / e) * Math.sin(ang) / (n * n);
        sy += sgn * ((p - m) / e) * Math.cos(ang) / (n * n);
    }
    return { tx: -2 * y + C * sx, ty: C * sy };
}

function rectTauVector(x, y, w, h) {
    if (!(w > 0) || !(h > 0)) return { tx: 0, ty: 0 };
    if (h <= w) return rectTauVectorCore(x, y, w, h);
    // Kısa kenar düşeyse eksenleri takas et. (x,y) → (y,x) bir yansımadır ve
    // burulma yönünü ters çevirir; bu yüzden geri dönüşte işaret de değişir.
    const r = rectTauVectorCore(y, x, h, w);
    return { tx: -r.ty, ty: -r.tx };
}

// Dikdörtgen kesitin çarpılma (warping) fonksiyonu ψ(x,y); eksenel yer
// değiştirme w = θ'·ψ olur. Dairesel kesitte ψ ≡ 0'dır (kesitler düzlem kalır),
// dikdörtgende sıfır değildir — burulmada kesitin çarpılmasının nedeni budur.
// ∇²ψ = 0 ve serbest yüzeyde ∂ψ/∂n = y·nx − x·ny koşullarını sağlayan kesin seri:
//   ψ = xy − (8w²/π³) Σ_{n tek} (−1)^((n−1)/2)/n³ · sin(nπx/w)·sinh(nπy/w)/cosh(nπh/2w)
// x ∈ [−w/2, w/2], y ∈ [−h/2, h/2] (kesit merkezine göre).
function rectWarpPsi(x, y, w, h) {
    if (!(w > 0) || !(h > 0)) return 0;
    const t = 2 * y / h;
    let s = 0;
    for (let n = 1; n <= 59; n += 2) {
        const A = n * Math.PI * h / (2 * w);
        // sinh(A·t)/cosh(A) — büyük A'da ∞/∞ olmaması için taşma güvenli biçim
        const ratio = (Math.exp(A * (t - 1)) - Math.exp(-A * (t + 1))) / (1 + Math.exp(-2 * A));
        const sgn = (((n - 1) / 2) % 2 === 0) ? 1 : -1;
        s += sgn * Math.sin(n * Math.PI * x / w) * ratio / (n * n * n);
    }
    return x * y - (8 * w * w / Math.pow(Math.PI, 3)) * s;
}

function resetCalcResults() {
    calc.sectionType = 'empty';
    calc.rectInfo = null;
    calc.tauSecond = 0;
    calc.area = 0;
    calc.centroidX = 0; calc.centroidY = 0;
    calc.Ix = 0; calc.Iy = 0; calc.Ixy = 0;
    calc.I1 = 0; calc.I2 = 0; calc.phi = 0;

    calc.xMin = 0; calc.xMax = 0; calc.yMin = 0; calc.yMax = 0;

    calc.Ip = 0;
    calc.GIp = 0;
    calc.thetaPrime = 0;
    calc.thetaDegPerM = 0;
    calc.Wt = 0;
    calc.tauMax = 0;
    calc.tauMin = 0;
    calc.rhoMax = 0;
    calc.rhoMin = 0;
    calc.torsion = 0;
    calc.torsionBands = null;
    calc.torsionRay = null;
    calc.maxStressPoint = null;
    calc.minStressPoint = null;
}

function hesapla() {
    const fail = (state) => {
        calc.errorState = state;
        resetCalcResults();
        updateOutputs();
        updateStatus();
        if (typeof window.update3DVisualization === 'function') {
            window.update3DVisualization();
        }
    };

    // Geçersiz geometri kontrolleri
    // Dairesel ve dikdörtgen kesit farklı burulma teorileriyle çözülür; aynı
    // kesitte birleştirilemezler (birinde kesit düzlem kalır, diğerinde çarpılır)
    if (rectangles.length > 0 && circles.length > 0) return fail('mixed');
    if (rectangles.length > 1) return fail('multiRect');
    if (checkIntersectionExists()) return fail('overlap');
    if (!isConcentric()) return fail('concentric');

    calc.errorState = null;

    if (rectangles.length > 0) {
        hesaplaBurulmaDikdortgen();
    } else {
        hesaplaBurulma();
    }
    updateOutputs();
    updateStatus();

    if (typeof window.update3DVisualization === 'function') {
        window.update3DVisualization();
    }
}

// Kesit özellikleri — dikdörtgen/kare için kesin formüllerle
function hesaplaAtaletDikdortgen() {
    const r = rectangles[0];
    const d = rectDims(r);

    calc.area = d.w * d.h;
    calc.centroidX = d.cx;
    calc.centroidY = d.cy;
    calc.xMin = d.cx - d.w / 2; calc.xMax = d.cx + d.w / 2;
    calc.yMin = d.cy - d.h / 2; calc.yMax = d.cy + d.h / 2;

    calc.Ix = d.w * Math.pow(d.h, 3) / 12;
    calc.Iy = d.h * Math.pow(d.w, 3) / 12;
    calc.Ixy = 0;

    // Ixy = 0 olduğundan asal eksenler geometrik eksenlerle çakışır
    calc.I1 = Math.max(calc.Ix, calc.Iy);
    calc.I2 = Math.min(calc.Ix, calc.Iy);
    calc.phi = 0;
}

// Kesit özellikleri — daire/halka için kesin (analitik) formüllerle
function hesaplaAtalet() {
    if (rectangles.length > 0) {
        hesaplaAtaletDikdortgen();
        return;
    }
    if (circles.length === 0) {
        calc.area = 0; calc.Ix = 0; calc.Iy = 0; calc.Ixy = 0;
        calc.I1 = 0; calc.I2 = 0; calc.phi = 0;
        calc.centroidX = 0; calc.centroidY = 0;
        calc.xMin = 0; calc.xMax = 0; calc.yMin = 0; calc.yMax = 0;
        return;
    }

    let A = 0, Sx = 0, Sy = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    circles.forEach(c => {
        const Ai = ringArea(c); // π(r² − ri²)
        A += Ai;
        Sx += Ai * c.cx;
        Sy += Ai * c.cy;
        minX = Math.min(minX, c.cx - c.r);
        maxX = Math.max(maxX, c.cx + c.r);
        minY = Math.min(minY, c.cy - c.r);
        maxY = Math.max(maxY, c.cy + c.r);
    });

    calc.area = A;
    calc.xMin = minX; calc.xMax = maxX;
    calc.yMin = minY; calc.yMax = maxY;

    if (A <= 0) {
        calc.centroidX = 0; calc.centroidY = 0;
        calc.Ix = 0; calc.Iy = 0; calc.Ixy = 0;
        calc.I1 = 0; calc.I2 = 0; calc.phi = 0;
        return;
    }

    const gx = Sx / A;
    const gy = Sy / A;
    calc.centroidX = gx;
    calc.centroidY = gy;

    // Daire/halka için: Ix,c = Iy,c = π/4 (r⁴ − ri⁴), Ixy,c = 0 + paralel eksen taşımaları
    let Ix = 0, Iy = 0, Ixy = 0;
    circles.forEach(c => {
        const ri = c.ri || 0;
        const Ai = ringArea(c);
        const Ic = Math.PI / 4 * (Math.pow(c.r, 4) - Math.pow(ri, 4));
        const dx = c.cx - gx;
        const dy = c.cy - gy;
        Ix += Ic + Ai * dy * dy;
        Iy += Ic + Ai * dx * dx;
        Ixy += Ai * dx * dy;
    });

    calc.Ix = Ix;
    calc.Iy = Iy;
    calc.Ixy = Ixy;

    // Asal atalet momentleri
    const Iavg = (Ix + Iy) / 2;
    const R = Math.sqrt(Math.pow((Ix - Iy) / 2, 2) + Math.pow(Ixy, 2));
    calc.I1 = Iavg + R;
    calc.I2 = Iavg - R;
    calc.phi = Math.atan2(-2 * Ixy, Ix - Iy) / 2 * RAD2DEG;
}

// Ekranda sağa doğru giden grid-x yönü (koordinat sistemi ters olabilir)
function screenDirGridX() {
    const c0 = gridToScreen(calc.centroidX, calc.centroidY);
    const c1 = gridToScreen(calc.centroidX + 1, calc.centroidY);
    return (c1.x - c0.x) >= 0 ? 1 : -1;
}

// Dikdörtgen/kare kesitte burulma analizi (Saint-Venant)
function hesaplaBurulmaDikdortgen() {
    hesaplaAtalet();

    const tInput = parseFloat(inputs.tbTorsion ? inputs.tbTorsion.value : 0) || 0;
    calc.torsion = tInput * 1e6; // kNm → Nmm

    calc.sectionType = 'rect';
    calc.torsionBands = null;
    calc.torsionRay = null;

    const r = rectangles[0];
    const d = rectDims(r);

    if (calc.area <= 0 || d.w <= 0 || d.h <= 0) {
        calc.rectInfo = null;
        calc.Ip = 0; calc.GIp = 0; calc.thetaPrime = 0; calc.thetaDegPerM = 0;
        calc.Wt = 0; calc.tauMax = 0; calc.tauMin = 0; calc.tauSecond = 0;
        calc.rhoMax = 0; calc.rhoMin = 0;
        calc.maxStressPoint = null; calc.minStressPoint = null;
        return;
    }

    const a = Math.max(d.w, d.h);          // uzun kenar
    const b = Math.min(d.w, d.h);          // kısa kenar
    const q = a / b;
    const G = (typeof r.G === 'number' && r.G > 0) ? r.G : DEFAULT_G;
    const Gmpa = G * 1000;                 // GPa → MPa (N/mm²)

    const co = rectTorsionCoeffs(q);
    const It = co.beta * a * b * b * b;    // burulma atalet momenti (mm⁴)
    const Wt = co.alpha * a * b * b;       // burulma mukavemet momenti (mm³)

    const thetaPrime = (Gmpa * It > 1e-9) ? calc.torsion / (Gmpa * It) : 0; // rad/mm

    // τ1: uzun kenarın ortasında (mutlak maksimum), τ2: kısa kenarın ortasında
    const tauLong = co.k1 * Gmpa * thetaPrime * b;
    const tauShort = co.gamma * tauLong;

    calc.Ip = It;                          // burulma atalet momenti (panelde It)
    calc.GIp = Gmpa * It;                  // burulma rijitliği G·It (N·mm²)
    calc.thetaPrime = thetaPrime;
    calc.thetaDegPerM = thetaPrime * 1000 * RAD2DEG;
    calc.Wt = Wt;
    calc.tauMax = tauLong;
    calc.tauSecond = tauShort;
    calc.tauMin = 0;                       // dikdörtgende köşelerde τ = 0

    // Uzun kenar yatay ise (w ≥ h) kenar ortaları düşey eksende, aksi hâlde yatayda
    const longIsHorizontal = d.w >= d.h;

    calc.rectInfo = {
        w: d.w, h: d.h, a, b, q,
        alpha: co.alpha, beta: co.beta, gamma: co.gamma,
        It, Wt, G, tauLong, tauShort, longIsHorizontal,
        gTheta: Gmpa * thetaPrime      // rectTauVector çıktısını MPa'ya çevirir
    };

    calc.rhoMax = b / 2;                   // τmax'ın merkeze uzaklığı
    calc.rhoMin = 0;

    // τmax noktası: uzun kenarın ortası
    calc.maxStressPoint = longIsHorizontal
        ? { x: d.cx, y: d.cy + b / 2 }
        : { x: d.cx + b / 2, y: d.cy };
    calc.minStressPoint = { x: d.cx, y: d.cy };
}

// Kompozit (çok malzemeli) dairesel kesitte burulma analizi
function hesaplaBurulma() {
    hesaplaAtalet();
    calc.sectionType = 'circular';
    calc.rectInfo = null;
    calc.tauSecond = 0;

    // Burulma momenti (kNm -> Nmm)
    const tInput = parseFloat(inputs.tbTorsion ? inputs.tbTorsion.value : 0) || 0;
    calc.torsion = tInput * 1e6;

    if (calc.area <= 0) {
        calc.Ip = 0; calc.GIp = 0; calc.thetaPrime = 0; calc.thetaDegPerM = 0;
        calc.Wt = 0; calc.tauMax = 0; calc.tauMin = 0;
        calc.rhoMax = 0; calc.rhoMin = 0;
        calc.torsionBands = null;
        calc.torsionRay = null;
        calc.maxStressPoint = null;
        calc.minStressPoint = null;
        return;
    }

    const bands = getSectionBands();

    // Polar atalet momentleri: J_i = π/2 (r_dış⁴ − r_iç⁴)
    let Ip = 0;
    let GIp = 0; // N·mm² (G: GPa → MPa için ×1000)
    bands.forEach(b => {
        b.J = Math.PI / 2 * (Math.pow(b.rOut, 4) - Math.pow(b.rIn, 4));
        Ip += b.J;
        GIp += (b.G * 1000) * b.J;
    });

    calc.Ip = Ip;
    calc.GIp = GIp;

    // Uygunluk + denge: θ' = T / Σ(G·Ip)
    const thetaPrime = (GIp > 1e-9) ? (calc.torsion / GIp) : 0; // rad/mm
    calc.thetaPrime = thetaPrime;
    calc.thetaDegPerM = thetaPrime * 1000 * RAD2DEG;

    // Her malzeme bandında τ = G·θ'·ρ (doğrusal)
    bands.forEach(b => {
        b.tauIn = (b.G * 1000) * thetaPrime * b.rIn;
        b.tauOut = (b.G * 1000) * thetaPrime * b.rOut;
    });
    calc.torsionBands = bands;

    const rMax = bands.length ? bands[bands.length - 1].rOut : 0;
    const rMin = bands.length ? bands[0].rIn : 0;
    calc.rhoMax = rMax;
    calc.rhoMin = rMin;

    // Genel τmax: bant dış kenarlarındaki en büyük mutlak değer (işaret korunur)
    let tauMax = 0;
    bands.forEach(b => {
        if (Math.abs(b.tauOut) > Math.abs(tauMax)) tauMax = b.tauOut;
    });
    calc.tauMax = tauMax;
    // τmin: en içteki malzemenin iç kenarındaki gerilme (dolu kesitte 0)
    calc.tauMin = rMin > 0 ? bands[0].tauIn : 0;

    // Burulma mukavemet momenti (geometrik): Wt = Ip / ρmax
    calc.Wt = rMax > 0 ? Ip / rMax : 0;

    // Diyagram düşey çap üzerinde çizilir: uçları ρmax'ta, iç kenarı ρmin'de
    const dirX = screenDirGridX();
    calc.torsionRay = { rInner: rMin, rOuter: rMax, dirX };
    calc.maxStressPoint = { x: calc.centroidX, y: calc.centroidY + rMax };
    calc.minStressPoint = { x: calc.centroidX, y: calc.centroidY + rMin };
}

// === ÇIKTI GÜNCELLEME ===
function updateOutputs() {
    // Moment dosyadan yüklenmiş veya başka yerden değişmiş olabilir
    syncTorsionSlider();

    // 1. Atalet momentleri
    if (outputs.valIx) outputs.valIx.textContent = formatNumber(calc.Ix);
    if (outputs.valIy) outputs.valIy.textContent = formatNumber(calc.Iy);
    if (outputs.valIxy) outputs.valIxy.textContent = formatNumber(calc.Ixy);

    // 2. Geometrik özellikler
    if (outputs.valArea) outputs.valArea.textContent = formatNumber(calc.area);

    // 3. Burulma gerilmeleri
    // Dikdörtgende ikinci değer τ₂'dir (kısa kenar ortası); dairesel kesitte τmin
    // (en içteki malzemenin iç kenarı). Etiketler kesit tipine göre değişir.
    const isRectSection = calc.sectionType === 'rect';
    if (outputs.valTauMax) outputs.valTauMax.textContent = calc.tauMax.toFixed(2);
    if (outputs.valTauMin) {
        outputs.valTauMin.textContent = (isRectSection ? calc.tauSecond : (calc.tauMin || 0)).toFixed(2);
    }

    const setLabel = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };
    setLabel('lblTauMin', isRectSection
        ? 'τ<span class="sub">2</span>' : 'τ<span class="sub">min</span>');
    setLabel('lblIp', isRectSection
        ? 'I<span class="sub">t</span>' : 'I<span class="sub">p</span>');
    setLabel('lblGIp', isRectSection
        ? 'GI<span class="sub">t</span>' : 'ΣGI<span class="sub">p</span>');
    setLabel('lblPolarBoxTitle', isRectSection
        ? 'BURULMA ATALET MOMENTİ' : 'POLAR ATALET MOMENTİ');

    updateStressModeRow();

    // 4. Polar atalet ve mukavemet momenti
    if (outputs.valIp) outputs.valIp.textContent = formatNumber(calc.Ip);
    if (outputs.valWt) outputs.valWt.textContent = formatNumber(calc.Wt);

    // 5. Burulma rijitliği ve birim dönme açısı
    if (outputs.valGIp) outputs.valGIp.textContent = formatNumber(calc.GIp / 1e9); // N·mm² → kNm²
    if (outputs.valTheta) outputs.valTheta.textContent = calc.thetaDegPerM.toFixed(4);

    // 6. Malzeme bazında gerilmeler (kompozit kesit)
    const matList = document.getElementById('torsionMaterialList');
    const matRows = document.getElementById('torsionMaterialRows');
    if (matList && matRows) {
        const bands = calc.torsionBands;
        if (bands && bands.length > 1) {
            matList.style.display = 'block';
            matRows.innerHTML = '';
            bands.forEach(b => {
                const c = circles[b.index];
                const mat = c ? shapeColor(c, b.index) : getMaterialColor(b.index);

                const row = document.createElement('div');
                row.className = 'shape-item torsion-band-row';

                const swatch = document.createElement('span');
                swatch.className = 'material-swatch';
                swatch.style.background = mat.fill;
                swatch.style.borderColor = mat.stroke;

                const info = document.createElement('div');
                info.className = 'torsion-band-info';

                // Ad ve malzeme ayrı kutulardır: dar panelde kırılma aralarında olur,
                // ad kısaltılmaz
                const nameEl = document.createElement('span');
                nameEl.className = 'shape-name';
                const bandName = document.createElement('span');
                bandName.textContent = c ? shapeLabel(c, b.index) : ('Parça ' + (b.index + 1));
                const bandMat = document.createElement('span');
                bandMat.textContent = '(G = ' + b.G + ' GPa)';
                nameEl.appendChild(bandName);
                nameEl.appendChild(bandMat);

                // İki terim ayrı kutulardır: dar panelde satır kırılması yalnızca
                // aralarında olur, sayı ile birim asla bölünmez
                const tauEl = document.createElement('span');
                tauEl.className = 'shape-area';
                const tauInEl = document.createElement('span');
                tauInEl.textContent = 'τiç = ' + b.tauIn.toFixed(2) + ' MPa';
                const tauOutEl = document.createElement('span');
                tauOutEl.textContent = 'τdış = ' + b.tauOut.toFixed(2) + ' MPa';
                tauEl.appendChild(tauInEl);
                tauEl.appendChild(tauOutEl);

                info.appendChild(nameEl);
                info.appendChild(tauEl);
                row.appendChild(swatch);
                row.appendChild(info);
                matRows.appendChild(row);
            });
        } else {
            matList.style.display = 'none';
            matRows.innerHTML = '';
        }
    }

    updateShapesList();
}

// Köşegen seçeneği yalnızca dikdörtgen kesitte ve diyagram açıkken görünür;
// dairesel kesitte köşegen diye bir şey yoktur
function updateStressModeRow() {
    const row = document.getElementById('stressModeRow');
    if (!row) return;
    const stressOn = !controls.cbStress || controls.cbStress.checked;
    row.style.display = (calc.sectionType === 'rect' && stressOn) ? 'flex' : 'none';
}

function formatNumber(num) {
    if (!isFinite(num)) return '∞';
    if (Math.abs(num) < 0.01) return '0.00';
    if (Math.abs(num) >= 1e6) {
        const exp = num.toExponential(2);
        const parts = exp.split('e');
        const mantissa = parseFloat(parts[0]);
        const exponent = parseInt(parts[1]);

        const superscripts = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
        const expStr = exponent.toString().split('').map(d => {
            if (d === '-') return '⁻';
            return superscripts[parseInt(d)];
        }).join('');

        return mantissa.toFixed(2) + '×10' + expStr;
    }
    return num.toFixed(2);
}

// === ÇİZİM FONKSİYONLARI ===

// Daire/halka yolunu tanımla (halkalar için dış CW + iç CCW → nonzero dolgu halka verir)
function defineShapePath(targetCtx, shape) {
    targetCtx.beginPath();
    if (shape.x1 !== undefined) {
        const p1 = gridToScreen(shape.x1, shape.y1);
        const p2 = gridToScreen(shape.x2, shape.y2);
        targetCtx.rect(
            Math.min(p1.x, p2.x), Math.min(p1.y, p2.y),
            Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y)
        );
        return;
    }
    const { scale } = getTransformParams();
    const p = gridToScreen(shape.cx, shape.cy);
    const rOut = shape.r * scale;
    const rIn = (shape.ri || 0) * scale;

    targetCtx.arc(p.x, p.y, rOut, 0, Math.PI * 2, false);
    targetCtx.closePath();
    if (rIn > 0.01) {
        targetCtx.moveTo(p.x + rIn, p.y);
        targetCtx.arc(p.x, p.y, rIn, 0, Math.PI * 2, true);
        targetCtx.closePath();
    }
}

function drawIntersections() {
    if (ctx.isSVG) return; // SVG'de çakışma vurgusu atlanır (yalnızca görsel geri bildirim)
    if (circles.length < 2) return;

    const iCanvas = document.createElement('canvas');
    iCanvas.width = canvas.width;
    iCanvas.height = canvas.height;
    const iCtx = iCanvas.getContext('2d');

    // Tarama deseni
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 10; patternCanvas.height = 10;
    const pCtx = patternCanvas.getContext('2d');
    pCtx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    pCtx.lineWidth = 1;
    pCtx.beginPath(); pCtx.moveTo(0, 0); pCtx.lineTo(10, 10); pCtx.stroke();
    pCtx.beginPath(); pCtx.moveTo(10, 0); pCtx.lineTo(0, 10); pCtx.stroke();
    const pattern = iCtx.createPattern(patternCanvas, 'repeat');

    iCtx.lineWidth = 2;
    iCtx.strokeStyle = '#FF0000';

    for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
            const s1 = circles[i];
            const s2 = circles[j];

            if (!circlesOverlap(s1, s2)) continue;

            // 1. Dolgu (tarama)
            iCtx.save();
            defineShapePath(iCtx, s1);
            iCtx.clip();
            defineShapePath(iCtx, s2);
            iCtx.fillStyle = pattern;
            iCtx.fill();
            iCtx.restore();

            // 2. Sınırlar
            iCtx.save();
            defineShapePath(iCtx, s1);
            iCtx.clip();
            defineShapePath(iCtx, s2);
            iCtx.stroke();
            iCtx.restore();

            iCtx.save();
            defineShapePath(iCtx, s2);
            iCtx.clip();
            defineShapePath(iCtx, s1);
            iCtx.stroke();
            iCtx.restore();
        }
    }

    ctx.drawImage(iCanvas, 0, 0);
}

function drawGrid() {
    const colors = getCanvasColors();
    ctx.lineWidth = 0.5;

    const pTopLeft = screenToGrid(0, 0);
    const pBottomRight = screenToGrid(canvas.width, canvas.height);

    const startX = Math.max(0, Math.floor(Math.min(pTopLeft.x, pBottomRight.x) / gridSpacing) * gridSpacing);
    const endX = Math.min(WORLD_SIZE_X, Math.ceil(Math.max(pTopLeft.x, pBottomRight.x) / gridSpacing) * gridSpacing);
    const startY = Math.max(0, Math.floor(Math.min(pTopLeft.y, pBottomRight.y) / gridSpacing) * gridSpacing);
    const endY = Math.min(WORLD_SIZE_Y, Math.ceil(Math.max(pTopLeft.y, pBottomRight.y) / gridSpacing) * gridSpacing);

    // Dikey çizgiler
    for (let gx = startX; gx <= endX; gx += gridSpacing) {
        const idx = Math.round(gx / gridSpacing);
        ctx.strokeStyle = idx % 5 === 0 ? colors.gridLineMajor : colors.gridLine;

        const screenP = gridToScreen(gx, 0);
        ctx.beginPath();
        ctx.moveTo(screenP.x, 0);
        ctx.lineTo(screenP.x, canvas.height);
        ctx.stroke();
    }

    // Yatay çizgiler
    for (let gy = startY; gy <= endY; gy += gridSpacing) {
        const idx = Math.round(gy / gridSpacing);
        ctx.strokeStyle = idx % 5 === 0 ? colors.gridLineMajor : colors.gridLine;

        const screenP = gridToScreen(0, gy);
        ctx.beginPath();
        ctx.moveTo(0, screenP.y);
        ctx.lineTo(canvas.width, screenP.y);
        ctx.stroke();
    }
}

function draw() {
    const colors = getCanvasColors();
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid();

    // Kesit parçalarını (malzeme renkleriyle) çiz
    try { drawPart(); } catch (e) { console.error("drawPart error:", e); }

    // UI yardımcıları (SVG modunda atlanır)
    if (!ctx.isSVG) {
        drawSelectionHighlight();
        drawIntersections();
        drawHandles();
        drawPreview();
    }

    const shapesExist = !sectionIsEmpty();

    if (shapesExist) {
        if (controls.cbPartBorders && controls.cbPartBorders.checked && !ctx.isSVG) {
            try { drawPartBorders(); } catch (e) { console.error("drawPartBorders error:", e); }
        }

        if (controls.cbStress && controls.cbStress.checked) {
            // Diyagramın opak zemini kesit dolgusunu ve konturunu örter:
            // dağılımın içinde kesit sınırları görünmez (referans figür)
            try { drawStressDistribution(); } catch (e) { console.error("drawStressDistribution error:", e); }
        }
        if (controls.cbForceVector && controls.cbForceVector.checked) {
            try { drawMomentVector(); } catch (e) { console.error("drawMomentVector error:", e); }
        }
    }

    // Eksenler ve ağırlık merkezi en üstte: gerilme diyagramının opak zemini
    // altta kalanları örttüğü için bunlar diyagramdan sonra çizilir
    drawAxes();
    drawCentroid();

    // Boyutlandırma için önizleme şekli
    let previewShape = null;
    if (isDrawing && currentTool === 'rect') {
        if (Math.abs(drawEnd.x - drawStart.x) > 0.1 && Math.abs(drawEnd.y - drawStart.y) > 0.1) {
            previewShape = {
                type: 'rect',
                x1: drawStart.x, y1: drawStart.y,
                x2: drawEnd.x, y2: drawEnd.y
            };
        }
    } else if (isDrawing && currentTool === 'circle') {
        const dist = Math.sqrt(Math.pow(drawEnd.x - drawStart.x, 2) + Math.pow(drawEnd.y - drawStart.y, 2));
        if (dist > 0.1) {
            previewShape = { cx: drawStart.x, cy: drawStart.y, r: dist, ri: 0 };
        }
    } else if (currentTool === 'ring' && ringDraft) {
        const { rOut, rIn } = getRingDraftRadii();
        if (rOut > 0) {
            previewShape = { cx: ringDraft.cx, cy: ringDraft.cy, r: rOut, ri: rIn };
        }
    }

    if (controls.cbDimensions && controls.cbDimensions.checked && (shapesExist || previewShape)) {
        try { drawDimensions(previewShape); } catch (e) { console.error("drawDimensions error:", e); }
    } else if (previewShape && previewShape.type !== 'rect' && !ctx.isSVG) {
        // Ölçülendirme kapalıyken de çizim sırasında yarıçap etiketi gösterilir
        // (dikdörtgende ölçü, imleç yanındaki "g × y" etiketiyle verilir)
        try {
            drawRadiusLeaderSet(shapeRadiusEntries(previewShape, ''), viewState.zoom);
        } catch (e) { console.error("drawRadiusLeaderSet error:", e); }
    }
}

function drawPart() {
    // Dikdörtgen/kare kesit
    rectangles.forEach((r, idx) => {
        const mat = shapeColor(r, idx);
        defineShapePath(ctx, r);
        ctx.fillStyle = mat.fill;
        ctx.fill('nonzero');
        ctx.strokeStyle = mat.stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });

    // Halkalar radyal olarak ayrıktır; geçersiz (çakışan) anlık durumlarda
    // küçük parça üstte kalsın diye büyükten küçüğe çizilir.
    const order = circles.map((_, i) => i).sort((a, b) => circles[b].r - circles[a].r);

    order.forEach(idx => {
        const c = circles[idx];
        const mat = shapeColor(c, idx);

        defineShapePath(ctx, c);
        ctx.fillStyle = mat.fill;
        ctx.fill('nonzero');
        ctx.strokeStyle = mat.stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });
}

function drawPartBorders() {
    const colors = getCanvasColors();
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.sectionStroke;
    ctx.setLineDash([6, 4]);
    circles.concat(rectangles).forEach(s => {
        defineShapePath(ctx, s);
        ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
}

// Seçili elemanın kaynak dizisi (daire veya dikdörtgen)
function selectedShape() {
    if (!selectedElement) return null;
    const arr = selectedElement.type === 'rect' ? rectangles : circles;
    return arr[selectedElement.index] || null;
}

function drawSelectionHighlight() {
    const c = selectedShape();
    if (!c) return;

    ctx.strokeStyle = '#C0392B';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    defineShapePath(ctx, c);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawDeleteHandle(gx, gy) {
    const p = gridToScreen(gx, gy);
    const size = DELETE_HANDLE_SIZE;
    const x = p.x - size - 10;
    const y = p.y + 10;

    deleteButtonBounds = { x: x, y: y, w: size, h: size };

    ctx.fillStyle = '#dc3545';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.lineTo(x + size - 4, y + size - 4);
    ctx.moveTo(x + size - 4, y + 4);
    ctx.lineTo(x + 4, y + size - 4);
    ctx.stroke();
}

function drawHandles() {
    if (!selectedElement || !editMode || currentTool !== 'move') return;

    if (selectedElement.type === 'rect') {
        const r = rectangles[selectedElement.index];
        if (!r) return;
        const d = rectDims(r);

        drawDeleteHandle(d.cx + d.w / 2, d.cy + d.h / 2);

        [
            { key: 'mr', gx: d.cx - d.w / 2, gy: d.cy },
            { key: 'ml', gx: d.cx + d.w / 2, gy: d.cy },
            { key: 'tm', gx: d.cx, gy: d.cy - d.h / 2 },
            { key: 'bm', gx: d.cx, gy: d.cy + d.h / 2 }
        ].forEach(h => {
            const hp = gridToScreen(h.gx, h.gy);
            const { w, h: hh } = getHandleSize(h.key);
            ctx.fillStyle = '#C0392B';
            ctx.fillRect(hp.x - w / 2, hp.y - hh / 2, w, hh);
        });
        return;
    }

    if (selectedElement.type !== 'circle') return;

    const c = circles[selectedElement.index];
    if (!c) return;

    // Silme butonu (ekran sol-alt köşesi: grid büyük X, büyük Y)
    drawDeleteHandle(c.cx + c.r, c.cy + c.r);

    const handles = [
        { key: 'mr', gx: c.cx - c.r, gy: c.cy },
        { key: 'ml', gx: c.cx + c.r, gy: c.cy },
        { key: 'tm', gx: c.cx, gy: c.cy - c.r },
        { key: 'bm', gx: c.cx, gy: c.cy + c.r }
    ];
    if ((c.ri || 0) > 0) {
        handles.push(
            { key: 'imr', gx: c.cx - c.ri, gy: c.cy },
            { key: 'iml', gx: c.cx + c.ri, gy: c.cy },
            { key: 'itm', gx: c.cx, gy: c.cy - c.ri },
            { key: 'ibm', gx: c.cx, gy: c.cy + c.ri }
        );
    }

    handles.forEach(h => {
        const hp = gridToScreen(h.gx, h.gy);
        const { w, h: hh } = getHandleSize(h.key);
        ctx.fillStyle = h.key.startsWith('i') ? '#E67E22' : '#C0392B';
        ctx.fillRect(hp.x - w / 2, hp.y - hh / 2, w, hh);
    });
}

function drawPreview() {
    if (currentTool === 'ring') {
        drawRingPreview();
        return;
    }

    if (isDrawing && currentTool === 'rect') {
        const colors = getCanvasColors();
        const p1 = gridToScreen(drawStart.x, drawStart.y);
        const p2 = gridToScreen(drawEnd.x, drawEnd.y);
        const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
        if (w < 0.5 || h < 0.5) return;

        ctx.fillStyle = colors.previewFill;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = colors.previewStroke;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        return;
    }

    if (!isDrawing || currentTool !== 'circle') return;

    const colors = getCanvasColors();
    const p = gridToScreen(drawStart.x, drawStart.y);
    const { scale } = getTransformParams();
    const dist = Math.sqrt(Math.pow(drawEnd.x - drawStart.x, 2) + Math.pow(drawEnd.y - drawStart.y, 2));
    if (dist <= 0.1) return;

    ctx.fillStyle = colors.previewFill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, dist * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = colors.previewStroke;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, dist * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
}

// Halka taslağı: sabitlenen merkez, tıklanan çap ve imleçteki çap birlikte gösterilir
function drawRingPreview() {
    if (!ringDraft) return;

    const colors = getCanvasColors();
    const { scale } = getTransformParams();
    const p = gridToScreen(ringDraft.cx, ringDraft.cy);

    ctx.save();

    // Merkez işareti (1. tıkla sabitlenen merkez)
    ctx.strokeStyle = colors.previewStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y);
    ctx.lineTo(p.x + 6, p.y);
    ctx.moveTo(p.x, p.y - 6);
    ctx.lineTo(p.x, p.y + 6);
    ctx.stroke();

    const { rOut, rIn } = getRingDraftRadii();
    if (rOut > 0) {
        const sOut = rOut * scale;
        const sIn = rIn * scale;

        // Halka yüzeyi: iç çap belliyse ortası boşluk olarak kesilir
        ctx.fillStyle = colors.previewFill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, sOut, 0, Math.PI * 2, false);
        ctx.closePath();
        if (sIn > 0.01) {
            ctx.moveTo(p.x + sIn, p.y);
            ctx.arc(p.x, p.y, sIn, 0, Math.PI * 2, true);
            ctx.closePath();
        }
        ctx.fill('nonzero');

        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = colors.previewStroke;
        ctx.beginPath();
        ctx.arc(p.x, p.y, sOut, 0, Math.PI * 2);
        ctx.stroke();

        if (sIn > 0.01) {
            ctx.strokeStyle = colors.previewCutStroke;
            ctx.beginPath();
            ctx.arc(p.x, p.y, sIn, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    ctx.restore();
}

function drawAxes() {
    if (!controls.cbAxes || !controls.cbAxes.checked || !calc || calc.area <= 0) return;

    const cx = calc.centroidX;
    const cy = calc.centroidY;

    const axisLen = Math.max(calc.xMax - calc.xMin, calc.yMax - calc.yMin) * 0.64;

    ctx.lineWidth = 1.5;

    // X ekseni (Lacivert)
    const xAxisColor = '#000080';
    ctx.strokeStyle = xAxisColor;
    const xStart = gridToScreen(cx - axisLen, cy);
    const xEnd = gridToScreen(cx + axisLen, cy);
    ctx.beginPath();
    ctx.moveTo(xStart.x, xStart.y);
    ctx.lineTo(xEnd.x, xEnd.y);
    ctx.stroke();
    ctx.fillStyle = xAxisColor;
    drawArrowHeadSimple(xEnd.x, xEnd.y, Math.atan2(xEnd.y - xStart.y, xEnd.x - xStart.x));
    ctx.font = 'italic 12px "Times New Roman"';
    ctx.fillText('x', xEnd.x - 15, xEnd.y + 12);

    // Y ekseni (Yeşil)
    const yAxisColor = '#008000';
    ctx.strokeStyle = yAxisColor;
    const yStart = gridToScreen(cx, cy - axisLen);
    const yEnd = gridToScreen(cx, cy + axisLen);
    ctx.beginPath();
    ctx.moveTo(yStart.x, yStart.y);
    ctx.lineTo(yEnd.x, yEnd.y);
    ctx.stroke();
    ctx.fillStyle = yAxisColor;
    drawArrowHeadSimple(yEnd.x, yEnd.y, Math.atan2(yEnd.y - yStart.y, yEnd.x - yStart.x));
    ctx.font = 'italic 12px "Times New Roman"';
    ctx.fillText('y', yEnd.x + 8, yEnd.y + 15);
}

// === BOYUTLANDIRMA ÇİZİMİ ===
function drawDimensions(previewShape = null) {
    if ((!calc.area || calc.area <= 0) && !previewShape) return;

    let { xMin, xMax, yMin, yMax, centroidX, centroidY } = calc;

    if (previewShape) {
        // Önizleme dahil sınırları genişlet
        if (!calc.area || calc.area <= 0) {
            xMin = Infinity; xMax = -Infinity; yMin = Infinity; yMax = -Infinity;
        }
        const pb = shapeBounds(previewShape);
        xMin = Math.min(xMin, pb.xMin);
        xMax = Math.max(xMax, pb.xMax);
        yMin = Math.min(yMin, pb.yMin);
        yMax = Math.max(yMax, pb.yMax);

        if (!calc.area || calc.area <= 0) {
            centroidX = (xMin + xMax) / 2;
            centroidY = (yMin + yMax) / 2;
        }
    }

    if (!isFinite(xMin) || !isFinite(xMax) || !isFinite(yMin) || !isFinite(yMax)) return;

    ctx.save();
    const dimColor = '#888888';
    ctx.strokeStyle = dimColor;
    ctx.fillStyle = dimColor;
    ctx.font = '11px Arial';
    ctx.lineWidth = 1;

    const scale = viewState.zoom;
    const gDist = gridSpacing * scale;
    const level1 = gDist;

    const currentWidth = xMax - xMin;
    const currentHeight = yMax - yMin;

    // A) Yatay boyutlar (üst & alt)
    const screenTopY = gridToScreen(xMin, yMin).y;
    const screenBottomY = gridToScreen(xMin, yMax).y;

    // Toplam genişlik (altta)
    const bLeft = gridToScreen(xMax, yMax);
    const bRight = gridToScreen(xMin, yMax);
    drawDimLine(bLeft.x, screenBottomY + level1, bRight.x, screenBottomY + level1, currentWidth.toFixed(1) + " mm", false, 1);

    // Ağırlık merkezi mesafeleri (üstte)
    const cGrid = gridToScreen(centroidX, centroidY);
    const dToMin = Math.abs(centroidX - xMin);
    const dToMax = Math.abs(centroidX - xMax);

    if (dToMax > 0.1) {
        const pEdge = gridToScreen(xMax, yMin);
        drawDimLine(pEdge.x, screenTopY - level1, cGrid.x, screenTopY - level1, dToMax.toFixed(1) + " mm", false, -1);
    }
    if (dToMin > 0.1) {
        const pEdge = gridToScreen(xMin, yMin);
        drawDimLine(cGrid.x, screenTopY - level1, pEdge.x, screenTopY - level1, dToMin.toFixed(1) + " mm", false, -1);
    }

    // B) Dikey boyutlar (sol & sağ)
    const screenLeftX = gridToScreen(xMax, yMin).x;
    const screenRightX = gridToScreen(xMin, yMin).x;

    // Toplam yükseklik (solda)
    const p1Y = gridToScreen(xMax, yMin);
    const p2Y = gridToScreen(xMax, yMax);
    drawDimLine(screenLeftX - level1, p1Y.y, screenLeftX - level1, p2Y.y, currentHeight.toFixed(1) + " mm", true, -1);

    // Ağırlık merkezi mesafeleri (sağda)
    const dToBottom = Math.abs(centroidY - yMax);
    const dToTop = Math.abs(centroidY - yMin);
    if (dToTop > 0.1) {
        const p1 = gridToScreen(xMin, yMin);
        const pC = gridToScreen(xMin, centroidY);
        drawDimLine(screenRightX + level1, p1.y, screenRightX + level1, pC.y, dToTop.toFixed(1) + " mm", true, 1);
    }
    if (dToBottom > 0.1) {
        const p2 = gridToScreen(xMin, yMax);
        const pC = gridToScreen(xMin, centroidY);
        drawDimLine(screenRightX + level1, pC.y, screenRightX + level1, p2.y, dToBottom.toFixed(1) + " mm", true, 1);
    }

    // Dairesel elemanlar için merkez çizgileri
    circles.forEach(c => {
        const pCenter = gridToScreen(c.cx, c.cy);
        const rPix = c.r * scale;

        ctx.beginPath();
        ctx.setLineDash([2, 4]);
        ctx.moveTo(pCenter.x - rPix, pCenter.y); ctx.lineTo(pCenter.x + rPix, pCenter.y);
        ctx.moveTo(pCenter.x, pCenter.y - rPix); ctx.lineTo(pCenter.x, pCenter.y + rPix);
        ctx.stroke();
        ctx.setLineDash([]);
    });

    ctx.restore();

    drawRadiusLeaderSet(collectRadiusEntries(previewShape), scale);
}

// Bir parçanın yarıçap ölçüleri: dolu dairede R, halkada Rd (dış) / Ri (iç).
// Birden çok parça varsa sembole parça numarası eklenir (Rd1, Ri1, Rd2 …).
function shapeRadiusEntries(shape, n) {
    const isRing = (shape.ri || 0) > 0;
    const entries = [];
    if (isRing) entries.push({ cx: shape.cx, cy: shape.cy, r: shape.ri, sub: 'i' + n });
    entries.push({ cx: shape.cx, cy: shape.cy, r: shape.r, sub: isRing ? 'd' + n : n });
    return entries;
}

// Kesitteki tüm parçaların (ve varsa çizim önizlemesinin) yarıçap ölçüleri
function collectRadiusEntries(previewShape = null) {
    const entries = [];
    const n = circles.length > 1 ? (i) => String(i + 1) : () => '';
    circles.forEach((c, i) => entries.push(...shapeRadiusEntries(c, n(i))));
    // Dikdörtgenin ölçüsü yarıçapla değil, kenar uzunluklarıyla verilir
    if (previewShape && previewShape.type !== 'rect') {
        entries.push(...shapeRadiusEntries(previewShape, ''));
    }
    return entries;
}

// Referans figürdeki yarıçap ölçülendirmesi: merkezden ilgili çembere giden ok
// ve üzerinde sembol + değer.
function drawRadiusLeaderSet(entries, scale) {
    if (!entries || entries.length === 0) return;

    // Aynı çember iki parçada birden geçebilir (birinin dışı, diğerinin içi):
    // eş merkezli ve eşit yarıçaplı ölçü yalnızca bir kez çizilir
    entries = entries.filter((e, i) => !entries.some((u, j) => j < i &&
        Math.abs(u.r - e.r) < 1e-6 && Math.abs(u.cx - e.cx) < 1e-6 && Math.abs(u.cy - e.cy) < 1e-6));

    // Küçük yarıçaplar yataya, büyük yarıçaplar dikeye yakın açıda çizilir;
    // böylece oklar ve etiketler sağ-üst çeyrekte üst üste binmez.
    entries.sort((a, b) => a.r - b.r);
    const A1 = RADIUS_LEADER_A1, A2 = RADIUS_LEADER_A2; // ekranda yukarı = negatif açı
    const colors = getCanvasColors();

    ctx.save();
    ctx.strokeStyle = colors.textColor;
    ctx.fillStyle = colors.textColor;
    ctx.lineWidth = 1;

    entries.forEach((e, k) => {
        const ang = entries.length === 1
            ? (A1 + A2) / 2
            : A1 + (A2 - A1) * (k / (entries.length - 1));
        const cos = Math.cos(ang), sin = Math.sin(ang);

        const p = gridToScreen(e.cx, e.cy);
        const rPix = e.r * scale;
        if (rPix < 6) return; // ekranda görünmeyecek kadar küçük

        const tip = { x: p.x + cos * rPix, y: p.y + sin * rPix };

        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        drawArrowHeadSimple(tip.x, tip.y, ang);

        // Etiket ok üzerinde, çizginin biraz yanında (figürdeki gibi). Konum,
        // moment yayının yarıçapını (kesitin 0.3'ü) aşacak kadar dışarıda
        // tutulur ki etiket kutusu yayın üstüne düşmesin.
        const lp = Math.max(0.55 * rPix, Math.min(0.8 * rPix, 1.5 * MOMENT_ARC_SCALE * 2 * calc.rhoMax * scale));
        const lx = p.x + cos * lp - sin * 9;
        const ly = p.y + sin * lp + cos * 9;

        drawSubscriptLabel('R', e.sub, ' = ' + e.r.toFixed(1) + ' mm', lx, ly, {
            align: 'left',
            color: colors.textColor,
            box: colors.labelBg
        });
    });

    ctx.restore();
}

function drawDimLine(x1, y1, x2, y2, text, vertical = false, textSide = -1) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const tick = 4;
    ctx.beginPath();
    ctx.moveTo(x1 - tick, y1 + tick); ctx.lineTo(x1 + tick, y1 - tick);
    ctx.moveTo(x2 - tick, y2 + tick); ctx.lineTo(x2 + tick, y2 - tick);

    if (vertical) {
        ctx.moveTo(x1 - tick, y1); ctx.lineTo(x1 + tick, y1);
        ctx.moveTo(x2 - tick, y2); ctx.lineTo(x2 + tick, y2);
    } else {
        ctx.moveTo(x1, y1 - tick); ctx.lineTo(x1, y1 + tick);
        ctx.moveTo(x2, y2 - tick); ctx.lineTo(x2, y2 + tick);
    }
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const offset = textSide * 12;

    if (vertical) {
        ctx.save();
        ctx.translate((x1 + x2) / 2 + offset, (y1 + y2) / 2);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(text, 0, 0);
        ctx.restore();
    } else {
        ctx.fillText(text, (x1 + x2) / 2, (y1 + y2) / 2 + offset);
    }
}

// Tuvalde alt simge desteği olmadığından etiketler parça parça yazılır:
// ana sembol (italik), alt simge (küçük, biraz aşağıda) ve kalan metin
// (" = 100 mm"). Örn. drawSubscriptLabel('R', 'd', ' = 100 mm', ...)
function drawSubscriptLabel(main, sub, rest, x, y, opts = {}) {
    const mainFont = opts.mainFont || 'italic 13px "Times New Roman"';
    const subFont = opts.subFont || 'italic 9px "Times New Roman"';
    const restFont = opts.restFont || '11px Arial';
    const align = opts.align || 'left';

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    ctx.font = mainFont; const wMain = ctx.measureText(main).width;
    ctx.font = subFont; const wSub = sub ? ctx.measureText(sub).width : 0;
    ctx.font = restFont; const wRest = rest ? ctx.measureText(rest).width : 0;
    const w = wMain + wSub + wRest;

    let bx = x;
    if (align === 'right') bx = x - w;
    else if (align === 'center') bx = x - w / 2;

    if (opts.box) {
        ctx.fillStyle = opts.box;
        ctx.fillRect(bx - 3, y - 9, w + 6, 18);
    }

    ctx.fillStyle = opts.color || '#000';
    ctx.font = mainFont;
    ctx.fillText(main, bx, y);
    if (sub) {
        ctx.font = subFont;
        ctx.fillText(sub, bx + wMain, y + (opts.subDy || 4));
    }
    if (rest) {
        ctx.font = restFont;
        ctx.fillText(rest, bx + wMain + wSub, y);
    }

    ctx.restore();
    return w;
}

function drawCentroid() {
    if (!controls.cbGeometricCenter || !controls.cbGeometricCenter.checked || !calc || calc.area <= 0) return;
    const colors = getCanvasColors();

    const pos = gridToScreen(calc.centroidX, calc.centroidY);

    ctx.fillStyle = colors.textColor;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'italic 12px Times New Roman';
    ctx.fillText('G', pos.x + 6, pos.y - 6);
}

// === BURULMA GERİLME DİYAGRAMI — DİKDÖRTGEN KESİT ===
// Diyagram bir veya birkaç DOĞRU üzerine oturur (iki merkez ekseni ve/veya bir
// köşegen). Çizim sırası kritik: opak zeminler, kesit dolgusunu ve konturunu
// örtmek için TÜM okların altında kalmalı — aksi hâlde "Tümü" modunda köşegenin
// zemini eksen oklarını siler. Bu yüzden önce plan çıkarılır, sonra bütün kollar
// evre evre birlikte çizilir: zeminler → taban çizgileri → oklar+zarf → etiketler.
//
// Plan biçimi: { branches: [{fill, ordinates, envelope}], baselines: [], labels: [] }
//   fill      : opak zemin çokgeninin ekran noktaları
//   ordinates : {base, tip} ok çiftleri
//   envelope  : zarf eğrisinin ekran noktaları
//   labels    : drawSubscriptLabel argümanları

// Diyagramların ortak ekran ölçüsü; iki mod arasında geçerken büyüklükler
// doğrudan kıyaslanabilsin diye tek referanstan (τmak) türetilir
function rectStressGeometry(info) {
    const scale = viewState.zoom;
    const wPx = info.w * scale, hPx = info.h * scale;
    return {
        scale, wPx, hPx,
        cS: gridToScreen(calc.centroidX, calc.centroidY),
        tSign: calc.torsion >= 0 ? 1 : -1,
        maxLen: Math.max(28, (Math.max(wPx, hPx) / 2) * STRESS_DIAGRAM_REACH)
    };
}

// İki merkez ekseni üzerindeki dağılım:
//   • kısa doğrultunun ucu = uzun kenarın ortası  → τmak
//   • uzun doğrultunun ucu  = kısa kenarın ortası → τ₂ = γ·τmak
// Köşelerde τ = 0'dır. Profil doğrusal değildir; kesin seri çözümüyle çizilir.
// τ teğetsel olduğundan oklar eksene diktir ve merkezin iki yanında ters yönlüdür.
// halfOnly: dağılım antisimetrik olduğu için her eksende iki lob çıkar; "Tümü"
// modunda üç doğru birden çizildiğinden yalnızca birer lob bırakılır (yatay,
// düşey ve köşegenden ikişer tane değil, birer tane).
function planRectAxesStress(info, tauMaxAbs, g, halfOnly = false) {
    const { cS, tSign, wPx, hPx, maxLen } = g;
    const lenAt = (tau) => (Math.abs(tau) / tauMaxAbs) * maxLen;
    const N = 8; // yarım eksendeki ok sayısı
    // Tek lob çizilirken düşey eksenin diyagramı x ekseninin ÜSTÜNDE kalsın
    // (pt'de s = +1 ekranda aşağı gider), yatayınki y ekseninin sağında.
    // Böylece üç lob üç ayrı bölgeye düşer: sol üst, sağ üst ve alt.
    const sidesFor = (ax) => halfOnly ? [ax.vertical ? -1 : 1] : [1, -1];

    const axisOf = (vertical) => {
        const halfSpan = (vertical ? hPx : wPx) / 2;
        // Ucu uzun kenarın ortasına denk gelen eksen "kısa doğrultu"dur
        const isShortAxis = vertical ? (info.h <= info.w) : (info.w <= info.h);
        return {
            vertical, halfSpan, isShortAxis,
            tauEnd: isShortAxis ? info.tauLong : info.tauShort,
            prof: isShortAxis
                ? (t) => rectTauProfileLong(t, info.q)
                : (t) => rectTauProfileShort(t, info.q),
            pt: (t, s) => vertical
                ? { x: cS.x, y: cS.y + s * t * halfSpan }
                : { x: cS.x + s * t * halfSpan, y: cS.y },
            // Teğet yön: düşey eksende yatay, yatay eksende düşey oklar
            dir: (s) => vertical
                ? { dx: s * tSign, dy: 0 }
                : { dx: 0, dy: -s * tSign }
        };
    };
    const axes = [axisOf(true), axisOf(false)];
    const tipOf = (ax, t, s) => {
        const p = ax.pt(t, s);
        const d = ax.dir(s);
        const L = lenAt(ax.tauEnd) * ax.prof(t);
        return { x: p.x + d.dx * L, y: p.y + d.dy * L, base: p };
    };

    const plan = { branches: [], baselines: [], labels: [] };

    axes.forEach(ax => {
        sidesFor(ax).forEach(s => {
            const fill = [{ x: cS.x, y: cS.y }];
            const envelope = [];
            for (let i = 0; i <= N * 3; i++) {
                const p = tipOf(ax, i / (N * 3), s);
                fill.push({ x: p.x, y: p.y });
                envelope.push({ x: p.x, y: p.y });
            }
            fill.push(ax.pt(1, s));

            const ordinates = [];
            for (let i = 1; i <= N; i++) {
                const p = tipOf(ax, i / N, s);
                ordinates.push({ base: p.base, tip: { x: p.x, y: p.y } });
            }
            plan.branches.push({ fill, ordinates, envelope });
        });
    });

    // Taban çizgisi yalnızca diyagramın bulunduğu yarıyı kapsar
    axes.forEach(ax => {
        const s = sidesFor(ax)[0];
        plan.baselines.push(
            halfOnly ? [ax.pt(0, s), ax.pt(1, s)] : [ax.pt(1, -1), ax.pt(1, 1)]
        );
    });

    axes.forEach(ax => {
        sidesFor(ax).forEach(s => {
            const p = tipOf(ax, 1, s);
            const d = ax.dir(s);
            plan.labels.push({
                main: 'τ', sub: ax.isShortAxis ? 'mak' : '2',
                rest: ' = ' + Math.abs(ax.tauEnd).toFixed(2) + ' MPa',
                x: p.x + d.dx * 6,
                y: p.y + d.dy * 6 + (ax.vertical ? 0 : (d.dy > 0 ? 9 : -9)),
                align: ax.vertical ? (d.dx > 0 ? 'left' : 'right') : 'center'
            });
        });
    });

    return plan;
}

// Tek KÖŞEGEN üzerindeki dağılım.
// Öğretici yanı: dairesel kesitten gelen "merkezden uzaklaştıkça gerilme artar"
// sezgisi (τ = G·θ′·ρ) burada geçersizdir — köşegenin iki ucunda da, yani hem
// merkezde hem KÖŞEDE τ = 0'dır; tek maksimum ikisinin arasında kalır. Köşegen
// bir simetri ekseni olmadığından (karede istisna) diyagram tek doğru üzerinde
// çizilir, eksen çiftindeki gibi tekrarlanmaz.
//
// Ordinat |τ|'dur ve köşegene DİK çizilir. Bu bir diyagram gösterimidir: okların
// UZUNLUĞU gerilmenin büyüklüğünü, YÖNÜ ise yalnızca dönme yönünü (momentle aynı
// çevrim) verir — gerçek τ vektörü köşegene ancak karede diktir, dikdörtgen
// uzadıkça uzun kenar doğrultusuna yatar (4:1'de köşegenle arasındaki açı ~15°).
// Dağılım merkeze göre ters simetrik olduğu için (τ(−P) = −τ(P)) ordinatlar
// köşegenin iki yarısında karşıt yanlara düşer.
// halfOnly: "Tümü" modunda köşegenden de tek lob çizilir (bkz. planRectAxesStress)
function planRectDiagonalStress(info, tauMaxAbs, g, halfOnly = false) {
    const { cS, tSign, wPx, hPx, maxLen } = g;

    // Köşegen grid'de (−w/2,−h/2) → (+w/2,+h/2), u ∈ [−1,1] ile parametrelenir.
    // gridToScreen x'i ters çevirdiğinden u artarken ekranda sola gidilir.
    const L = Math.hypot(info.w, info.h);
    const endS = { x: -wPx / 2, y: hPx / 2 };          // u = +1 ucunun ekran ötelemesi
    const dS = { x: -info.w / L, y: info.h / L };      // köşegen birim yönü (ekran)
    const nS = { x: info.h / L, y: info.w / L };       // köşegene dik birim (ekran)

    const at = (u) => ({ x: cS.x + u * endS.x, y: cS.y + u * endS.y });
    const tauAt = (u) => {
        const t = rectTauVector(u * info.w / 2, u * info.h / 2, info.w, info.h);
        return Math.abs(info.gTheta) * Math.hypot(t.tx, t.ty);
    };
    // Ordinatın hangi yana düştüğü: u > 0 yarısında τ·n > 0'dır (her en/boy
    // oranında doğrulandı), moment ters dönünce iki yarı birlikte döner
    const sideOf = (u) => (u >= 0 ? 1 : -1) * tSign;
    const tipOf = (u) => {
        const base = at(u);
        const len = (tauAt(u) / tauMaxAbs) * maxLen * sideOf(u);
        return { x: base.x + nS.x * len, y: base.y + nS.y * len, base };
    };

    const N = DIAGONAL_ORDINATES;
    const M = N * DIAGONAL_ENVELOPE_DENSITY;          // zarf çözünürlüğü
    const sides = halfOnly ? [1] : [1, -1];

    // Taban çizgisi yalnızca diyagramın bulunduğu yarıyı kapsar
    const plan = {
        branches: [],
        baselines: [halfOnly ? [at(0), at(1)] : [at(-1), at(1)]],
        labels: []
    };

    // Zarf tek parçadır: tam köşegende merkezde tabana inip karşı yana geçer
    const envelope = [];
    for (let i = halfOnly ? 0 : -M; i <= M; i++) {
        const p = tipOf(i / M);
        envelope.push({ x: p.x, y: p.y });
    }

    sides.forEach((s, idx) => {
        const fill = [{ x: cS.x, y: cS.y }];
        for (let i = 0; i <= M; i++) {
            const p = tipOf(s * i / M);
            fill.push({ x: p.x, y: p.y });
        }
        fill.push(at(s));

        const ordinates = [];
        for (let i = 1; i <= N; i++) {
            const p = tipOf(s * i / N);
            ordinates.push({ base: p.base, tip: { x: p.x, y: p.y } });
        }
        // Zarf bir kez, son kolla birlikte çizilir
        plan.branches.push({
            fill, ordinates,
            envelope: idx === sides.length - 1 ? envelope : null
        });
    });

    // Tepe değeri (iki yarıda da aynı) ve köşede τ = 0.
    // Alt simge kullanılmaz: köşegende gösterilen tek bir büyüklük var ve etiket
    // kutusu 'ş' gibi alt uzantılı harfleri kırpıyor
    let uPeak = 0, tauPeak = 0;
    for (let i = 1; i < M; i++) {
        const tau = tauAt(i / M);
        if (tau > tauPeak) { tauPeak = tau; uPeak = i / M; }
    }

    sides.forEach(s => {
        const p = tipOf(s * uPeak);
        const side = sideOf(s * uPeak);
        plan.labels.push({
            main: 'τ', sub: '', rest: ' = ' + tauPeak.toFixed(2) + ' MPa',
            x: p.x + nS.x * side * 7, y: p.y + nS.y * side * 7,
            align: side > 0 ? 'left' : 'right'
        });

        // Köşe etiketi "Tümü" modunda bırakılır: karede eksen ucu etiketiyle
        // üst üste biniyor, üstelik zarfın köşede tabana dönmesi zaten görünüyor
        if (halfOnly) return;
        const c = at(s);
        plan.labels.push({
            main: 'τ', sub: '', rest: ' = 0',
            x: c.x + dS.x * s * 10, y: c.y + dS.y * s * 10,
            align: (dS.x * s) > 0 ? 'left' : 'right'
        });
    });

    return plan;
}

function drawRectStressPlan(plan) {
    const colors = getCanvasColors();
    const color = '#E74C3C';

    ctx.save();

    // 1) Opak zeminler — hepsi, herhangi bir ok çizilmeden önce
    ctx.fillStyle = colors.background;
    plan.branches.forEach(br => {
        if (!br.fill || br.fill.length < 3) return;
        ctx.beginPath();
        ctx.moveTo(br.fill[0].x, br.fill[0].y);
        for (let i = 1; i < br.fill.length; i++) ctx.lineTo(br.fill[i].x, br.fill[i].y);
        ctx.closePath();
        ctx.fill();
    });

    // 2) Taban çizgileri
    ctx.strokeStyle = 'rgba(110,110,110,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    plan.baselines.forEach(([p1, p2]) => {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    });
    ctx.setLineDash([]);

    // 3) Oklar ve zarf
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    plan.branches.forEach(br => {
        ctx.lineWidth = 1.5;
        (br.ordinates || []).forEach(o => {
            drawArrowLine(ctx, o.base.x, o.base.y, o.tip.x, o.tip.y, STRESS_ARROW_HEAD);
        });

        if (br.envelope && br.envelope.length > 1) {
            ctx.lineWidth = 2;
            ctx.beginPath();
            br.envelope.forEach((p, i) => {
                if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
        }
    });

    ctx.restore();

    // 4) Etiketler
    plan.labels.forEach(l => {
        drawSubscriptLabel(l.main, l.sub, l.rest, l.x, l.y, {
            align: l.align,
            color: '#fff',
            box: 'rgba(0,0,0,0.65)'
        });
    });
}

function drawRectStressDistribution() {
    const info = calc.rectInfo;
    if (!info) return;
    if (Math.abs(calc.torsion) < 1e-6) return;

    const tauMaxAbs = Math.abs(calc.tauMax);
    if (tauMaxAbs < 1e-10) return;

    const g = rectStressGeometry(info);
    const withAxes = stressDiagramMode !== 'diagonal';
    const withDiagonal = stressDiagramMode !== 'axes';
    // Üç doğru birden çizilirken her birinden tek lob yeter; tek doğru
    // çizilirken dağılımın ters simetrisi iki lobla gösterilir
    const halfOnly = withAxes && withDiagonal;

    const plans = [];
    if (withAxes) plans.push(planRectAxesStress(info, tauMaxAbs, g, halfOnly));
    if (withDiagonal) plans.push(planRectDiagonalStress(info, tauMaxAbs, g, halfOnly));

    // "Tümü" modunda kollar tek plana katılır; böylece opak zeminler evre 1'de
    // birlikte basılır ve hiçbiri diğerinin oklarını örtmez
    drawRectStressPlan({
        branches: [].concat(...plans.map(p => p.branches)),
        baselines: [].concat(...plans.map(p => p.baselines)),
        labels: [].concat(...plans.map(p => p.labels))
    });
}

function drawStressDistribution() {
    if (rectangles.length > 0) {
        drawRectStressDistribution();
        return;
    }
    if (circles.length === 0) return;
    if (Math.abs(calc.torsion) < 1e-6) return;

    const bands = calc.torsionBands;
    if (!bands || bands.length === 0) return;

    const tauMaxAbs = Math.abs(calc.tauMax);
    if (tauMaxAbs < 1e-10) return;

    const scale = viewState.zoom;
    const cS = gridToScreen(calc.centroidX, calc.centroidY);
    const tSign = calc.torsion >= 0 ? 1 : -1;

    const rMax = bands[bands.length - 1].rOut;
    const rMaxPx = rMax * scale;

    // Diyagram genişliği (görsel ölçek): |τ|max için ~dış yarıçap kadar
    const maxW = Math.max(28, rMaxPx * STRESS_DIAGRAM_REACH);
    const wAt = (tau) => (Math.abs(tau) / tauMaxAbs) * maxW;

    // Düşey çap üzerinde ρ'nun ekran y'si (s: +1 alt yarı, -1 üst yarı)
    const yAt = (r, s) => cS.y + s * r * scale;
    // Teğetsel yön: pozitif burulmada alt yarıda +x, üst yarıda -x
    const xAt = (tau, s) => cS.x + s * tSign * wAt(tau);

    const singleColor = '#E74C3C';
    const multi = bands.length > 1;
    const bandColor = (b) => {
        if (!multi) return singleColor;
        const c = circles[b.index];
        return (c ? shapeColor(c, b.index) : getMaterialColor(b.index)).stroke;
    };

    ctx.save();

    // --- 1. Diyagram zemini ---
    // Referans figürdeki gibi opak zemin: kesit dolgusu arkadan görünmez,
    // dağılım kesitin üstünde ayrı bir blok olarak okunur. Alan, taban (düşey
    // çap) ile zarf arasında kalan bölgedir; halkada boşluk dışarıda kalır.
    ctx.fillStyle = getCanvasColors().background;
    [1, -1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(cS.x, yAt(bands[0].rIn, s));
        ctx.lineTo(cS.x, yAt(rMax, s));
        for (let i = bands.length - 1; i >= 0; i--) {
            ctx.lineTo(xAt(bands[i].tauOut, s), yAt(bands[i].rOut, s));
            ctx.lineTo(xAt(bands[i].tauIn, s), yAt(bands[i].rIn, s));
        }
        ctx.closePath();
        ctx.fill();
    });

    // --- 2. Çap ekseni (taban çizgisi) ---
    ctx.strokeStyle = 'rgba(110,110,110,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(cS.x, yAt(rMax, -1));
    ctx.lineTo(cS.x, yAt(rMax, 1));
    ctx.stroke();
    ctx.setLineDash([]);

    // Çapın iki yarısı: alt (+1) ve üst (-1)
    [1, -1].forEach(s => {
        bands.forEach((b, bi) => {
            const color = bandColor(b);
            ctx.strokeStyle = color;
            ctx.fillStyle = color;

            const yIn = yAt(b.rIn, s);
            const yOut = yAt(b.rOut, s);

            // --- 3. Kayma gerilmesi okları (çaptan zarfa, doğrusal artan) ---
            ctx.lineWidth = 1.5;
            const bandWidth = b.rOut - b.rIn;
            const nArrows = Math.max(3, Math.round((bandWidth / rMax) * 11));
            for (let a = 1; a <= nArrows; a++) {
                const r = b.rIn + bandWidth * (a / nArrows);
                const tau = b.tauIn + (b.tauOut - b.tauIn) * ((r - b.rIn) / bandWidth || 0);
                drawArrowLine(ctx, cS.x, yAt(r, s), xAt(tau, s), yAt(r, s), STRESS_ARROW_HEAD);
            }

            // --- 4. Zarf (bant içinde doğrusal) ---
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(xAt(b.tauIn, s), yIn);
            ctx.lineTo(xAt(b.tauOut, s), yOut);
            ctx.stroke();

            // --- 5. Bant kenar dikmeleri ---
            // İç kenar: içi boş kesitin başlangıcı veya malzeme sınırındaki sıçrama
            ctx.lineWidth = 1.5;
            const prev = bi > 0 ? bands[bi - 1] : null;
            const contiguous = prev && Math.abs(prev.rOut - b.rIn) < 1e-9;
            ctx.beginPath();
            if (contiguous) {
                // Ara yüzde sıçrama: önceki bandın dış gerilmesinden bu bandın iç gerilmesine
                ctx.moveTo(xAt(prev.tauOut, s), yIn);
            } else {
                ctx.moveTo(cS.x, yIn);
            }
            ctx.lineTo(xAt(b.tauIn, s), yIn);
            ctx.stroke();

            // Dış kenar dikmesi (son bant veya sonraki banda bitişik değilse)
            const next = bi < bands.length - 1 ? bands[bi + 1] : null;
            const nextContiguous = next && Math.abs(next.rIn - b.rOut) < 1e-9;
            if (!nextContiguous) {
                ctx.beginPath();
                ctx.moveTo(cS.x, yOut);
                ctx.lineTo(xAt(b.tauOut, s), yOut);
                ctx.stroke();
            }
        });

        // --- 6. Boşlukta zarfın kesikli uzantısı (halka kesitte merkeze doğru) ---
        const first = bands[0];
        if (first.rIn > 1e-9) {
            ctx.strokeStyle = bandColor(first);
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(cS.x, cS.y);
            ctx.lineTo(xAt(first.tauIn, s), yAt(first.rIn, s));
            ctx.stroke();
            ctx.setLineDash([]);
        }
    });

    ctx.restore();

    // --- 7. Etiketler ---
    // τmak, mutlak değeri en büyük bant dış kenarında oluşur; iç malzemenin G'si
    // büyükse kesitin içinde de çıkabilir. Figürdeki gibi çapın iki ucuna yazılır.
    let maxBand = bands[0];
    bands.forEach(b => {
        if (Math.abs(b.tauOut) > Math.abs(maxBand.tauOut)) maxBand = b;
    });

    // Malzeme ara yüzünde τ süreksizdir: aynı yarıçapta iki farklı değer oluşur
    // (içteki malzemenin dış kenarı ve dıştakinin iç kenarı). İkisi de yazılır;
    // üst üste binmesinler diye içteki merkeze, dıştaki dışa doğru kaydırılır.
    const TAU_EPS = 0.005; // MPa — bu farkın altındaki sıçrama gösterimde görünmez
    const TAU_LBL_DY = 9;  // px

    // side: -1 sıçramanın iç malzeme tarafı, +1 dış malzeme tarafı, 0 kayma yok
    const tauLabel = (main, sub, tau, r, s, side = 0) => {
        const dir = s * tSign; // etiket, okların uzandığı yönde dışarıda dursun
        drawSubscriptLabel(main, sub, ' = ' + Math.abs(tau).toFixed(2) + ' MPa',
            xAt(tau, s) + dir * 6, yAt(r, s) + side * s * TAU_LBL_DY, {
                align: dir > 0 ? 'left' : 'right',
                color: '#fff',
                box: 'rgba(0,0,0,0.65)'
            });
    };

    // Bandın dış kenarında sıçrama var mı (sonraki bant bitişik ve τ farklı mı)
    const jumpsAtOuterEdge = (bi) => {
        const b = bands[bi], next = bands[bi + 1];
        return !!next && Math.abs(next.rIn - b.rOut) < 1e-9 &&
            Math.abs(next.tauIn - b.tauOut) > TAU_EPS;
    };

    const maxIdx = bands.indexOf(maxBand);
    const maxSide = jumpsAtOuterEdge(maxIdx) ? -1 : 0;
    [1, -1].forEach(s => tauLabel('τ', 'mak', maxBand.tauOut, maxBand.rOut, s, maxSide));

    // τmin: en içteki malzemenin iç kenarındaki gerilme (içi boş kesitte).
    // Sonuç değeri olduğu için τmak gibi çapın iki ucuna da yazılır.
    const first = bands[0];
    if (first.rIn > 1e-9) {
        [1, -1].forEach(s => tauLabel('τ', 'min', first.tauIn, first.rIn, s));
    }

    // Ara kenarlar: kompozit kesitte bant kenarlarındaki gerilmeler. Uç değer
    // olmadıklarından yalnızca alt yarıya yazılır (kalabalık yapmasın).
    if (multi) {
        bands.forEach((b, bi) => {
            const prev = bands[bi - 1];
            const contiguous = prev && Math.abs(prev.rOut - b.rIn) < 1e-9;
            const jumpIn = contiguous && Math.abs(b.tauIn - prev.tauOut) > TAU_EPS;

            // İç kenar: ara yüzdeki sıçramanın dış malzeme tarafı. Sıçrama yoksa
            // değer önceki bandın dış kenarıyla aynıdır, ikinci kez yazılmaz.
            if (prev && (jumpIn || !contiguous)) {
                tauLabel('τ', '', b.tauIn, b.rIn, 1, jumpIn ? 1 : 0);
            }

            // Dış kenar (τmak zaten yazıldı)
            if (b !== maxBand) {
                tauLabel('τ', '', b.tauOut, b.rOut, 1, jumpsAtOuterEdge(bi) ? -1 : 0);
            }
        });
    }
}

// Burulma momenti (referans figürdeki gibi merkeze yakın, sağ yanı açık
// kırmızı "C" yay). Dönüş yönü kayma gerilmesi oklarıyla aynı olmalıdır:
// τ dağılımı bu momenti dengeler, dolayısıyla ikisi aynı yönde döner.
function drawMomentVector() {
    if (calc.area === 0 || Math.abs(calc.torsion) < 1e-6) return;

    const cx = calc.centroidX;
    const cy = calc.centroidY;

    const sectionSize = Math.max(calc.xMax - calc.xMin, calc.yMax - calc.yMin);
    const radius = sectionSize * MOMENT_ARC_SCALE;
    const scale = viewState.zoom;

    const screenCenter = gridToScreen(cx, cy);
    const screenRadius = radius * scale;

    ctx.strokeStyle = MOMENT_COLOR;
    ctx.lineWidth = MOMENT_LINE_WIDTH;
    ctx.fillStyle = MOMENT_COLOR;

    const tSign = calc.torsion >= 0 ? 1 : -1;

    // Yayın boşluğu, yarıçap ölçü oklarının açı bandını iki yandan paylı
    // kapsar: oklar boşluktan geçer, yayı ve ok ucunu kesmez (referans figür).
    // Pozitif burulmada yay azalan açı yönünde (ekranda saat yönünün tersi)
    // çizilir — böylece dönüş yönü kayma gerilmesi oklarıyla aynı olur.
    const gapLower = RADIUS_LEADER_A1 + MOMENT_GAP_MARGIN;
    const gapUpper = RADIUS_LEADER_A2 - MOMENT_GAP_MARGIN;

    // Pozitif burulmada süpürme açı azalan yönde (ekranda saat yönünün tersi)
    const ccw = tSign > 0;
    const startAngle = ccw ? gapUpper : gapLower;  // yayın başladığı açı
    const tipAngle = ccw ? gapLower : gapUpper;    // ok ucunun tepesi (yayın bittiği açı)

    // Ok ucunun tepesi de tabanı da yay üzerindedir: üçgenin ekseni yayın
    // kirişi olur, yani eğriye teğettir. Yay, üçgenin tabanında biter ki
    // çizgi ok ucunun içinden geçmesin.
    const headSpan = Math.min(MOMENT_ARROW_HEAD / screenRadius, 30 * DEG2RAD);
    const baseAngle = tipAngle + (ccw ? headSpan : -headSpan);

    ctx.beginPath();
    ctx.arc(screenCenter.x, screenCenter.y, screenRadius, startAngle, baseAngle, ccw);
    ctx.stroke();

    const onArc = (a) => ({
        x: screenCenter.x + screenRadius * Math.cos(a),
        y: screenCenter.y + screenRadius * Math.sin(a)
    });
    const tip = onArc(tipAngle);
    const base = onArc(baseAngle);

    const ax = tip.x - base.x, ay = tip.y - base.y;          // ok ekseni (kiriş)
    const aLen = Math.sqrt(ax * ax + ay * ay) || 1;
    const nx = -ay / aLen, ny = ax / aLen;                   // eksene dik birim
    const hw = MOMENT_ARROW_HEAD * 0.38;

    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(base.x + nx * hw, base.y + ny * hw);
    ctx.lineTo(base.x - nx * hw, base.y - ny * hw);
    ctx.closePath();
    ctx.fill();

    // Burulma momenti etiketi (referans figür: Mb). Yayın sol-üst dışına konur;
    // merkezde ağırlık merkezi işareti (G) bulunduğu için oraya yazılmaz.
    const labAng = 205 * DEG2RAD;
    drawSubscriptLabel('M', 'b', '',
        screenCenter.x + Math.cos(labAng) * screenRadius * 1.45,
        screenCenter.y + Math.sin(labAng) * screenRadius * 1.45, {
        align: 'center',
        box: getCanvasColors().labelBg,
        color: MOMENT_COLOR,
        mainFont: 'italic bold 16px "Times New Roman"',
        subFont: 'italic bold 11px "Times New Roman"',
        subDy: 5
    });
}

function drawArrowHeadSimple(x, y, angle) {
    const headLen = 10;
    const headAngle = Math.PI / 6;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
        x - headLen * Math.cos(angle - headAngle),
        y - headLen * Math.sin(angle - headAngle)
    );
    ctx.moveTo(x, y);
    ctx.lineTo(
        x - headLen * Math.cos(angle + headAngle),
        y - headLen * Math.sin(angle + headAngle)
    );
    ctx.stroke();
}

// Düz çizgi + ucunda dolu üçgen ok başı (burulma teğet gerilme okları).
// Üçgen o anki fillStyle ile doldurulur; kısa oklarda uç, ok boyunu aşmasın
// diye kısaltılır.
function drawArrowLine(c, x1, y1, x2, y2, headLen = 5) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 0.5) return;

    const ux = dx / len, uy = dy / len;   // birim yön
    const h = Math.min(headLen, len * 0.7);
    const hw = h * 0.42;                  // üçgen taban yarı genişliği

    // Gövde, üçgenin tabanına kadar çizilir
    const bx = x2 - ux * h, by = y2 - uy * h;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(bx, by);
    c.stroke();

    // Dolu üçgen uç (taban, yöne dik)
    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(bx - uy * hw, by + ux * hw);
    c.lineTo(bx + uy * hw, by - ux * hw);
    c.closePath();
    c.fill();
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
        if (typeof onResize3D === 'function') onResize3D();
    });

    document.addEventListener('mouseup', () => {
        if (isResizingPanel) {
            isResizingPanel = false;
            document.body.classList.remove('resizing');
            resizer.classList.remove('resizing');

            resizeCanvas();
            if (typeof onResize3D === 'function') onResize3D();
        }
    });
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
    drawImage() {}

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

    measureText(text) {
        return { width: text.toString().length * 6, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 };
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
<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}" style="background-color: #fff">
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
                    description: 'SVG Dosyası',
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
            alert('SVG kaydetme sırasında bir hata oluştu: ' + err.message);
        }
    }
}
