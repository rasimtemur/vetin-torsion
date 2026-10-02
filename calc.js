// --- CALC.JS : BURULMA HESABI (SAF ÇEKİRDEK) ---
//
// Bu dosya DOM'a, tuvale ve uygulamanın genel durumuna (circles, rectangles, calc,
// girdiler) DOKUNMAZ: her fonksiyon girdisini parametre olarak alır, sonucunu
// döndürür. Böylece Node'da doğrudan yüklenip sınanır (tests/) ve aynı hesap başka
// bir bağlamda (toplu hesap, ikinci kesit) çalıştırılabilir. Arayüz tarafı yalnız
// computeSection() çağırıp sonucu `calc`a kopyalar (script.js → hesaplaCore).
//
// Üç kesit ailesi vardır ve birleştirilemezler:
//   · Dairesel kompozit (eş merkezli halkalar, her biri kendi G'siyle):
//       uygunluk θ′ ortak (kesit düzlem kalır), denge T = θ′·Σ(G_i·Ip_i),
//       gerilme τ_i(ρ) = G_i·θ′·ρ (her bantta doğrusal). Tek malzemede τ = T·ρ/Ip.
//   · TEK dikdörtgen: Saint-Venant, Prandtl gerilme fonksiyonunun kesin serisi.
//   · Birden çok dikdörtgen: ince cidarlı profil (açıkta Σb·t³/3, kapalıda Bredt–Batho).
// Sayısal integrasyon ve tablo interpolasyonu yoktur; her şey kapalı formül ya da
// üstel hızla yakınsayan seridir.
//
// Birimler: uzunluk mm, G GPa (hesapta ×1000 → MPa), moment N·mm, τ MPa, θ′ rad/mm.

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const DEFAULT_G = 80;   // GPa — yeni parçaların varsayılan kayma modülü (çelik)

// === GEOMETRİ YARDIMCILARI ===

function ringArea(c) {
    const ri = c.ri || 0;
    return Math.PI * (c.r * c.r - ri * ri);
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

function checkIntersectionExists(circs) {
    for (let i = 0; i < circs.length; i++) {
        for (let j = i + 1; j < circs.length; j++) {
            if (circlesOverlap(circs[i], circs[j])) return true;
        }
    }
    return false;
}

function isConcentric(circs) {
    if (circs.length < 2) return true;
    const { cx, cy } = circs[0];
    return circs.every(c => Math.abs(c.cx - cx) < 1e-6 && Math.abs(c.cy - cy) < 1e-6);
}

// Malzeme bantları: [{rIn, rOut, G, index}] rOut'a göre artan sıralı
function getSectionBands(circs) {
    return circs
        .map((c, i) => ({
            rIn: Math.max(0, c.ri || 0),
            rOut: c.r,
            G: (typeof c.G === 'number' && c.G > 0) ? c.G : DEFAULT_G,
            index: i
        }))
        .sort((a, b) => a.rOut - b.rOut);
}

// === İNCE CİDARLI PROFİLLER (AÇIK VE KAPALI) ===
//
// Kesit, DİKDÖRTGEN ELEMANLARDAN kurulur; elemanlar birbirine girmez (küt ek).
// Geometri `rectangles` dizisinde tutulur — çizim ve 3B yolları değişmeden
// çalışır. Hazır profillerin parametreleri (`profileDef`) yalnız elemanları
// üretmek içindir; açık/kapalı topolojisi hesapta GEOMETRİDEN çıkarılır
// (rectUnionCells + detectClosedCell), böylece elle kurulan kesit de aynı yoldan geçer.
//
// Neden ayrı bir hesap ailesi:
//   · Açık profilde burulma direnci ince şeritlerin toplamıdır, J = (1/3)Σ b·t³;
//     τ cidar kalınlığı boyunca DOĞRUSALDIR, orta çizgide sıfır, yüzeyde en büyük.
//   · Kapalı kesitte kesme akısı q çevrede sabittir (Bredt–Batho), τ = q/t cidar
//     boyunca sabittir ve aynı dış ölçüde açık kesitten iki-üç mertebe büyük bir
//     J verir. İki formülasyon birleştirilemez.
//
// Ölçüler referans figürdeki gibidir: bf = başlık genişliği, bw = toplam yükseklik,
// tf = başlık kalınlığı, tw = gövde kalınlığı.

// Etiket anahtarı sözlüğe aittir (profileKindLabel, script.js); burada yalnız veri
const PROFILE_KINDS = {
    I:   { labelKey: 'profileI',   closed: false },
    U:   { labelKey: 'profileU',   closed: false },
    Z:   { labelKey: 'profileZ',   closed: false },
    T:   { labelKey: 'profileT',   closed: false },
    L:   { labelKey: 'profileL',   closed: false },
    BOX: { labelKey: 'profileBox', closed: true }
};

const PROFILE_DEFAULTS = { kind: 'I', bf: 100, bw: 200, tf: 10, tw: 7, G: DEFAULT_G };

function profileIsClosed(p) {
    const k = PROFILE_KINDS[p && p.kind];
    return !!(k && k.closed);
}

// Profilin dikdörtgen elemanları (grid koordinatlarında, örtüşmez).
// cx, cy profilin sınırlayıcı kutusunun merkezidir.
function profileRects(p) {
    const { kind, bf: B, bw: H, tf, tw } = p;
    const cx = p.cx || 0, cy = p.cy || 0;
    const R = (x1, y1, x2, y2) => ({
        type: 'rect',
        x1: cx + x1, y1: cy + y1, x2: cx + x2, y2: cy + y2,
        G: p.G, colorIdx: 0
    });
    const bx = B / 2, by = H / 2;

    switch (kind) {
        case 'I':
            return [
                R(-bx, by - tf, bx, by),                 // üst başlık
                R(-bx, -by, bx, -by + tf),               // alt başlık
                R(-tw / 2, -by + tf, tw / 2, by - tf)    // gövde
            ];
        case 'U':
            // Gövde grid +x'te: ekranda x ters çevrildiğinden SOLDA görünür
            return [
                R(bx - tw, -by, bx, by),                 // gövde (tam boy)
                R(-bx, by - tf, bx - tw, by),            // bir başlık
                R(-bx, -by, bx - tw, -by + tf)           // diğer başlık
            ];
        case 'Z':
            return [
                R(-tw / 2, -by, tw / 2, by),             // gövde (ortada, tam boy)
                R(tw / 2, by - tf, tw / 2 + (B - tw), by),          // üst başlık sağa
                R(-tw / 2 - (B - tw), -by, -tw / 2, -by + tf)       // alt başlık sola
            ];
        case 'T':
            return [
                R(-bx, by - tf, bx, by),                 // başlık
                R(-tw / 2, -by, tw / 2, by - tf)         // gövde
            ];
        case 'L':
            // Düşey kol grid +x (ekranda sol), yatay kol grid +y (ekranda alt)
            return [
                R(bx - tw, -by, bx, by),                 // düşey kol
                R(-bx, by - tf, bx - tw, by)             // yatay kol
            ];
        case 'BOX':
            return [
                R(-bx, by - tf, bx, by),                 // üst cidar
                R(-bx, -by, bx, -by + tf),               // alt cidar
                R(-bx, -by + tf, -bx + tw, by - tf),     // sol cidar
                R(bx - tw, -by + tf, bx, by - tf)        // sağ cidar
            ];
        default:
            return [];
    }
}

// Ölçüler tutarlı mı: cidarlar kesitin içine sığmalı ve pozitif olmalı
function profileIsValid(p) {
    if (!p || !PROFILE_KINDS[p.kind]) return false;
    if (!(p.bf > 0 && p.bw > 0 && p.tf > 0 && p.tw > 0)) return false;
    if (p.tw >= p.bf) return false;
    if (p.kind === 'BOX') return (2 * p.tf < p.bw) && (2 * p.tw < p.bf);
    return 2 * p.tf < p.bw;
}


// === ÇOK ELEMANLI KESİT: BİRLEŞİM AYRIŞTIRMASI ===
// Kesit birden çok dikdörtgenden kurulabildiği için (ekleme yoluyla) elemanlar
// ÖRTÜŞEBİLİR. Alan ve atalet momentleri bu yüzden doğrudan toplanamaz; birleşim
// önce ayrık hücrelere ayrıştırılır: bütün x ve y kenarları sıralanır, ortaya
// çıkan ızgaranın her hücresi ya tümüyle içeridedir ya da tümüyle dışarıda.
// Hücreler dikdörtgen olduğundan katkıları kapalı formülle toplanır — sayısal
// integrasyon yok, sonuç KESİN.

function rectUnionCells(rects) {
    const xs = [], ys = [];
    rects.forEach(r => {
        xs.push(Math.min(r.x1, r.x2), Math.max(r.x1, r.x2));
        ys.push(Math.min(r.y1, r.y2), Math.max(r.y1, r.y2));
    });
    const uniq = (a) => {
        const s = a.slice().sort((p, q) => p - q);
        const out = [];
        s.forEach(v => { if (!out.length || Math.abs(v - out[out.length - 1]) > 1e-9) out.push(v); });
        return out;
    };
    const X = uniq(xs), Y = uniq(ys);
    if (X.length < 2 || Y.length < 2) return null;

    const nx = X.length - 1, ny = Y.length - 1;
    const inside = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        const my = (Y[j] + Y[j + 1]) / 2;
        for (let i = 0; i < nx; i++) {
            const mx = (X[i] + X[i + 1]) / 2;
            inside[j * nx + i] = rects.some(r =>
                mx > Math.min(r.x1, r.x2) && mx < Math.max(r.x1, r.x2) &&
                my > Math.min(r.y1, r.y2) && my < Math.max(r.y1, r.y2)) ? 1 : 0;
        }
    }
    return { X, Y, nx, ny, inside };
}

// Birleşimin alan, ağırlık merkezi ve atalet momentleri (örtüşme bir kez sayılır)
function rectUnionProps(cells) {
    let A = 0, Sx = 0, Sy = 0;
    const parts = [];
    for (let j = 0; j < cells.ny; j++) {
        const h = cells.Y[j + 1] - cells.Y[j], cy = (cells.Y[j] + cells.Y[j + 1]) / 2;
        for (let i = 0; i < cells.nx; i++) {
            if (!cells.inside[j * cells.nx + i]) continue;
            const w = cells.X[i + 1] - cells.X[i], cx = (cells.X[i] + cells.X[i + 1]) / 2;
            const a = w * h;
            A += a; Sx += a * cx; Sy += a * cy;
            parts.push({ a, w, h, cx, cy });
        }
    }
    if (A <= 0) return { A: 0, gx: 0, gy: 0, Ix: 0, Iy: 0, Ixy: 0 };

    const gx = Sx / A, gy = Sy / A;
    let Ix = 0, Iy = 0, Ixy = 0;
    parts.forEach(p => {
        const dx = p.cx - gx, dy = p.cy - gy;
        Ix += p.w * p.h * p.h * p.h / 12 + p.a * dy * dy;
        Iy += p.h * p.w * p.w * p.w / 12 + p.a * dx * dx;
        Ixy += p.a * dx * dy;                 // dikdörtgen hücrenin kendi Ixy'si sıfır
    });
    return { A, gx, gy, Ix, Iy, Ixy };
}

// Kesit KAPALI mı: birleşimin çevrelediği bir boşluk var mı? Izgara hücreleri
// üzerinde dışarıdan taşma (flood fill) yapılır; dışarıya ulaşamayan boş hücreler
// bir hücre (cell) oluşturur. Bredt–Batho tek hücreli ve DİKDÖRTGEN boşluk için
// çözüldüğünden başka bir şey çıkarsa açıkça bildirilir.
function detectClosedCell(cells) {
    const { X, Y, nx, ny, inside } = cells;
    const seen = new Uint8Array(nx * ny);
    const stack = [];

    // Kenardaki bütün boş hücreler "dışarı" sayılır
    for (let i = 0; i < nx; i++) {
        [0, ny - 1].forEach(j => { if (!inside[j * nx + i] && !seen[j * nx + i]) { seen[j * nx + i] = 1; stack.push([i, j]); } });
    }
    for (let j = 0; j < ny; j++) {
        [0, nx - 1].forEach(i => { if (!inside[j * nx + i] && !seen[j * nx + i]) { seen[j * nx + i] = 1; stack.push([i, j]); } });
    }
    while (stack.length) {
        const [i, j] = stack.pop();
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dj]) => {
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= nx || b >= ny) return;
            const k = b * nx + a;
            if (inside[k] || seen[k]) return;
            seen[k] = 1; stack.push([a, b]);
        });
    }

    const voidCells = [];
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            if (!inside[j * nx + i] && !seen[j * nx + i]) voidCells.push([i, j]);
        }
    }
    if (!voidCells.length) return null;                  // açık kesit

    let i1 = nx, i2 = -1, j1 = ny, j2 = -1;
    voidCells.forEach(([i, j]) => {
        i1 = Math.min(i1, i); i2 = Math.max(i2, i);
        j1 = Math.min(j1, j); j2 = Math.max(j2, j);
    });
    // Boşluk tam olarak sınırlayıcı kutusunu doldurmuyorsa dikdörtgen değildir
    // (ya da birden çok hücre vardır) → tek hücreli Bredt uygulanamaz
    const full = (i2 - i1 + 1) * (j2 - j1 + 1);
    if (voidCells.length !== full) return { multi: true };

    // Cidar kalınlıkları dış sınırlayıcı kutu ile boşluk arasındaki paylardan okunur;
    // bu ancak birleşim TAM OLARAK "kutu eksi boşluk" ise doğrudur. Kutudan taşan bir
    // kanat/dudak ya da kademeli bir cidar varsa kutunun kenarı artık cidarın dış
    // yüzü değildir: sağ cidara 60 mm'lik bir kanat eklenince o cidar 70 mm kalın
    // sayılıyor, A_m %16, J %38 büyüyordu. Böyle bir kesit (kapalı hücre + açık
    // parçalar) ayrı bir formülasyondur; sessizce yanlış sayı vermek yerine bildirilir.
    for (let k = 0; k < nx * ny; k++) {
        if (!inside[k] && seen[k]) return { irregular: true };
    }

    return { x1: X[i1], x2: X[i2 + 1], y1: Y[j1], y2: Y[j2 + 1] };
}

// Her dikdörtgen eleman bir CİDARDIR: uzunluğu uzun kenarı, kalınlığı kısa kenarı.
// Ek yerleri, o bölgeyi kaplayan elemana ait sayılır (mevcut orta çizgi kuralına
// göre biraz güvenli tarafta kalır); kavis/köşe rijitliği ihmal edilir (η = 1).
function rectWalls(rects) {
    return rects.map(r => {
        const d = rectDims(r);
        return { len: Math.max(d.w, d.h), t: Math.min(d.w, d.h), w: d.w, h: d.h, cx: d.cx, cy: d.cy };
    });
}

// Bütün elemanlar aynı malzemeden mi? Çok malzemeli ince cidarlı profil kapsam
// dışıdır (açıkta ΣG_i·J_i, kapalıda kesme akısı denklemi baştan kurulmalı).
function rectsShareMaterial(rects) {
    if (rects.length < 2) return true;
    const g0 = rects[0].G;
    return rects.every(r => Math.abs((r.G || 0) - (g0 || 0)) < 1e-9);
}

// Açık kesitte iki eleman KALINLIK doğrultusunda bitişik mi (ikisinin de UZUN
// yüzü ortak kenarda)? J = (1/3)Σ b·t³ eleman başına toplandığından aynı cidar
// kalınlıkça bölünürse rijitlik t³'le çöker: 100×10'luk başlık iki 100×5'e
// bölününce L profilin J'si %40 düşüyordu, iki 10×10 kareden kurulan 20×10 dolu
// kesit ise kesin değerden %46 büyük çıkıyordu — aynı geometri, farklı sonuç.
// Uç uca (kısa yüzden) ve T/köşe birleşimleri (birinin kısa yüzü ötekinin uzun
// yüzüne) J'yi doğru toplar, onlara dokunulmaz. Kare elemanda iki yüz de uzundur.
function rectWallsStacked(rects) {
    const eps = 1e-9;
    const box = rects.map(r => ({
        x1: Math.min(r.x1, r.x2), x2: Math.max(r.x1, r.x2),
        y1: Math.min(r.y1, r.y2), y2: Math.max(r.y1, r.y2)
    }));
    for (let i = 0; i < box.length; i++) {
        for (let j = i + 1; j < box.length; j++) {
            const a = box[i], b = box[j];
            const aw = a.x2 - a.x1, ah = a.y2 - a.y1, bw = b.x2 - b.x1, bh = b.y2 - b.y1;
            const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
            const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
            // Düşey ortak kenar: düşey yüz, düşey doğrultuda uzanan elemanın uzun yüzüdür
            const vTouch = oy > eps && (Math.abs(a.x2 - b.x1) < eps || Math.abs(b.x2 - a.x1) < eps);
            if (vTouch && ah >= aw && bh >= bw) return true;
            // Yatay ortak kenar
            const hTouch = ox > eps && (Math.abs(a.y2 - b.y1) < eps || Math.abs(b.y2 - a.y1) < eps);
            if (hTouch && aw >= ah && bw >= bh) return true;
        }
    }
    return false;
}

// Elemanlar örtüşüyor mu (uyarı için; alan/atalet zaten birleşimden geliyor)
function rectElementsOverlap(rects) {
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rectDims(rects[i]), b = rectDims(rects[j]);
            const ox = Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
            const oy = Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
            if (ox > 1e-9 && oy > 1e-9) return true;
        }
    }
    return false;
}

// === ÇOK ELEMANLI KESİTİN ATALET MOMENTLERİ ===
// Elemanlar örtüşebildiğinden birleşim ayrıştırmasından geçilir (bkz. rectUnionProps).
// Z ve L'de Ixy sıfır DEĞİLDİR (simetri ekseni yok).
function hesaplaAtaletProfil(res, rects, cells) {
    const p = cells ? rectUnionProps(cells) : { A: 0, gx: 0, gy: 0, Ix: 0, Iy: 0, Ixy: 0 };

    res.area = p.A;
    res.centroidX = p.gx; res.centroidY = p.gy;
    res.Ix = p.Ix; res.Iy = p.Iy; res.Ixy = p.Ixy;

    if (p.A <= 0) {
        res.xMin = 0; res.xMax = 0; res.yMin = 0; res.yMax = 0;
        return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rects.forEach(r => {
        minX = Math.min(minX, r.x1, r.x2); maxX = Math.max(maxX, r.x1, r.x2);
        minY = Math.min(minY, r.y1, r.y2); maxY = Math.max(maxY, r.y1, r.y2);
    });
    res.xMin = minX; res.xMax = maxX; res.yMin = minY; res.yMax = maxY;

    // Eleman başına değerler ortak ağırlık merkezine göre (Steiner). Toplam hücre
    // ayrıştırmasından gelir; elemanlar örtüşmediğinden (rectOverlap) ikisi aynıdır.
    res.partInertias = rects.map((r, index) => {
        const d = rectDims(r);
        const a = d.w * d.h, dx = d.cx - p.gx, dy = d.cy - p.gy;
        const e = { kind: 'rect', index, area: a,
            Ix: d.w * d.h * d.h * d.h / 12 + a * dy * dy,
            Iy: d.h * d.w * d.w * d.w / 12 + a * dx * dx,
            Ixy: a * dx * dy };
        e.Ip = e.Ix + e.Iy;
        return e;
    });
}

// === ÇOK ELEMANLI (İNCE CİDARLI) KESİTTE BURULMA ===
// Kesit hazır bir profilden gelmiş olabilir ya da kullanıcı elemanları tek tek
// EKLEYEREK kurmuş olabilir — hesap ikisini de aynı yoldan yapar, kaynak yalnızca
// dikdörtgen elemanlardır. Topoloji geometriden çıkarılır: birleşimin çevrelediği
// bir boşluk varsa kesit kapalıdır (Bredt–Batho), yoksa açıktır (Σb·t³/3).
function hesaplaBurulmaProfil(res, rects, torque) {
    const cells = rectUnionCells(rects);
    hesaplaAtaletProfil(res, rects, cells);

    res.sectionType = 'profile';
    res.torsion = torque;

    const walls = rectWalls(rects);
    const G = walls.length
        ? ((typeof rects[0].G === 'number' && rects[0].G > 0) ? rects[0].G : DEFAULT_G)
        : DEFAULT_G;
    const Gmpa = G * 1000;

    const cell = cells ? detectClosedCell(cells) : null;
    const closed = !!(cell && !cell.multi && !cell.irregular);

    let J = 0, Wt = 0, q = 0, Am = 0;
    let tL = 0, tR = 0, tB = 0, tT = 0;
    if (closed) {
        // Orta çizgi halkası: boşluk, komşu cidarların YARISI kadar dışa taşınır.
        // Cidar kalınlıkları dış sınırlayıcı kutu ile boşluk arasındaki paylardır
        // (detectClosedCell birleşimin tam "kutu eksi boşluk" olduğunu doğrular).
        tL = cell.x1 - res.xMin; tR = res.xMax - cell.x2;
        tB = cell.y1 - res.yMin; tT = res.yMax - cell.y2;
        const Wm = (cell.x2 - cell.x1) + (tL + tR) / 2;
        const Hm = (cell.y2 - cell.y1) + (tB + tT) / 2;
        Am = Wm * Hm;
        const ds_t = Wm / tT + Wm / tB + Hm / tL + Hm / tR;
        J = (ds_t > 0) ? 4 * Am * Am / ds_t : 0;
        q = (Am > 0) ? torque / (2 * Am) : 0;
        const tMin = Math.min(tL, tR, tB, tT);
        Wt = 2 * Am * tMin;                       // τmak = T/Wt (en İNCE cidarda)
    } else {
        walls.forEach(w => { J += w.len * Math.pow(w.t, 3); });
        J /= 3;
        const tMax = walls.length ? Math.max(...walls.map(w => w.t)) : 0;
        Wt = (tMax > 0) ? J / tMax : 0;           // τmak = T·tmak/J = T/Wt
    }

    res.Ip = J;                                   // panelde It olarak yazılır
    res.GIp = Gmpa * J;
    const thetaPrime = (Gmpa * J > 1e-9) ? torque / (Gmpa * J) : 0;
    res.thetaPrime = thetaPrime;
    res.thetaDegPerM = thetaPrime * 1000 * RAD2DEG;
    res.Wt = Wt;

    // Kapalıda elemanın ait olduğu CİDARIN kalınlığı (elemanın kendi kısa kenarı
    // değil: cidar kalınlıkça iki elemana bölünmüşse τ = q/t iki kat çıkardı).
    // Köşe bölgesi üst/alt cidara sayılır — BOX'ta da köşeleri başlıklar taşır.
    const wallThickness = (w) => {
        if (w.cy >= cell.y2) return tT;
        if (w.cy <= cell.y1) return tB;
        return (w.cx <= cell.x1) ? tL : tR;
    };

    // Eleman başına gerilme. Açık kesitte τ kalınlık boyunca doğrusaldır ve
    // yüzeyde G·θ′·t olur; kapalıda kesme akısı sabit olduğundan τ = q/t cidar
    // boyunca değişmez.
    const elements = walls.map(w => {
        const across = (w.w <= w.h) ? 'x' : 'y';
        return {
            t: w.t, across, w: w.w, h: w.h,
            cx: w.cx - res.centroidX,             // ağırlık merkezine göre
            cy: w.cy - res.centroidY,
            tau: Math.abs(closed ? q / wallThickness(w) : Gmpa * thetaPrime * w.t)
        };
    });

    let tauMax = 0, tauMin = Infinity;
    elements.forEach(e => {
        if (e.tau > tauMax) tauMax = e.tau;
        if (e.tau < tauMin) tauMin = e.tau;
    });
    res.tauMax = tauMax * Math.sign(torque || 1);
    // Açık kesitte orta çizgide τ = 0'dır; kapalıda en küçük değer en KALIN cidardadır
    res.tauMin = closed ? (isFinite(tauMin) ? tauMin : 0) : 0;

    res.profileInfo = {
        closed, G, Gmpa, J, Wt, q, Am, elements,
        multiCell: !!(cell && cell.multi),
        closedShape: !!(cell && cell.irregular),
        wallStack: !cell && rectWallsStacked(rects)
    };

    res.rhoMax = Math.max(res.xMax - res.centroidX, res.yMax - res.centroidY);
    res.rhoMin = 0;
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

// === SONUÇ NESNESİ ===
// Bütün aileler aynı biçimde sonuç döndürür; arayüz (panel, çizim, 3B) bu alanları
// okur. Her hesap BOŞ bir sonuçtan başlar: eskiden hesap genel `calc`ın üstüne
// yazıyordu ve bir ailenin dokunmadığı alan önceki kesitten kalıyordu (ör. profilde
// I1/I2 bir önceki dikdörtgenin değerini taşıyordu).
function emptyResult() {
    return {
        sectionType: 'empty',   // 'empty' | 'circular' | 'rect' | 'profile'
        errorState: null,       // null | 'mixed' | 'profileDims' | 'profileMaterial' | 'rectOverlap'
                                //   | 'multiCell' | 'closedShape' | 'wallStack' | 'overlap' | 'concentric'
        rectInfo: null,         // tek dikdörtgen: { w, h, a, b, q, alpha, beta, gamma, It, Wt, G,
                                //   tauLong, tauShort, longIsHorizontal, gTheta }
        profileInfo: null,      // profil: { closed, G, Gmpa, J, Wt, q, Am, elements, ... }
        torsionBands: null,     // dairesel: [{rIn, rOut, G, J, Wt, torque, tauIn, tauOut, index}] (rOut artan)
        partInertias: null,     // eleman başına: [{kind: 'circle'|'rect', index, area, Ix, Iy, Ixy, Ip}]
                                //   KESİTİN ortak ağırlık merkezine göre; toplamları Ix/Iy/Ixy'dir

        area: 0,
        centroidX: 0, centroidY: 0,
        Ix: 0, Iy: 0, Ixy: 0,
        I1: 0, I2: 0, phi: 0,   // asal atalet momentleri ve açısı (°)
        xMin: 0, xMax: 0, yMin: 0, yMax: 0,

        torsion: 0,             // uygulanan moment (N·mm)
        Ip: 0,                  // dairede kutupsal atalet momenti; dikdörtgen/profilde It (mm⁴)
        GIp: 0,                 // burulma rijitliği (N·mm²)
        thetaPrime: 0,          // birim dönme (rad/mm)
        thetaDegPerM: 0,        // birim dönme (°/m)
        Wt: 0,                  // burulma mukavemet momenti (mm³)
        tauMax: 0,              // en büyük kayma gerilmesi (MPa, işaretli)
        tauMin: 0,              // en küçük (dairede bant iç kenarları; profilde açıkta 0)
        tauSecond: 0,           // dikdörtgende kısa kenar ortası τ₂ (MPa)
        rhoMax: 0,              // τmak'ın merkeze uzaklığı
        rhoMin: 0               // dairede en içteki iç yarıçap
    };
}

// Asal atalet momentleri — üç aile de aynı bağıntıyla (Mohr)
function setPrincipalMoments(res) {
    const Iavg = (res.Ix + res.Iy) / 2;
    const R = Math.sqrt(Math.pow((res.Ix - res.Iy) / 2, 2) + Math.pow(res.Ixy, 2));
    res.I1 = Iavg + R;
    res.I2 = Iavg - R;
    res.phi = Math.atan2(-2 * res.Ixy, res.Ix - res.Iy) / 2 * RAD2DEG;
}

// === KESİT ÖZELLİKLERİ ===

// Dikdörtgen/kare için kesin formüllerle
function hesaplaAtaletDikdortgen(res, r) {
    const d = rectDims(r);

    res.area = d.w * d.h;
    res.centroidX = d.cx;
    res.centroidY = d.cy;
    res.xMin = d.cx - d.w / 2; res.xMax = d.cx + d.w / 2;
    res.yMin = d.cy - d.h / 2; res.yMax = d.cy + d.h / 2;

    res.Ix = d.w * Math.pow(d.h, 3) / 12;
    res.Iy = d.h * Math.pow(d.w, 3) / 12;
    res.Ixy = 0;
    res.partInertias = [{ kind: 'rect', index: 0, area: res.area,
        Ix: res.Ix, Iy: res.Iy, Ixy: 0, Ip: res.Ix + res.Iy }];
}

// Daire/halka için kesin (analitik) formüllerle
function hesaplaAtaletDaire(res, circs) {
    if (circs.length === 0) return;

    let A = 0, Sx = 0, Sy = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    circs.forEach(c => {
        const Ai = ringArea(c); // π(r² − ri²)
        A += Ai;
        Sx += Ai * c.cx;
        Sy += Ai * c.cy;
        minX = Math.min(minX, c.cx - c.r);
        maxX = Math.max(maxX, c.cx + c.r);
        minY = Math.min(minY, c.cy - c.r);
        maxY = Math.max(maxY, c.cy + c.r);
    });

    res.area = A;
    res.xMin = minX; res.xMax = maxX;
    res.yMin = minY; res.yMax = maxY;

    if (A <= 0) return;

    const gx = Sx / A;
    const gy = Sy / A;
    res.centroidX = gx;
    res.centroidY = gy;

    // Daire/halka için: Ix,c = Iy,c = π/4 (r⁴ − ri⁴), Ixy,c = 0 + paralel eksen taşımaları
    let Ix = 0, Iy = 0, Ixy = 0;
    res.partInertias = circs.map((c, index) => {
        const ri = c.ri || 0;
        const Ai = ringArea(c);
        const Ic = Math.PI / 4 * (Math.pow(c.r, 4) - Math.pow(ri, 4));
        const dx = c.cx - gx;
        const dy = c.cy - gy;
        const p = { kind: 'circle', index, area: Ai,
            Ix: Ic + Ai * dy * dy, Iy: Ic + Ai * dx * dx, Ixy: Ai * dx * dy };
        p.Ip = p.Ix + p.Iy;
        Ix += p.Ix; Iy += p.Iy; Ixy += p.Ixy;
        return p;
    });

    res.Ix = Ix;
    res.Iy = Iy;
    res.Ixy = Ixy;
}

// === DİKDÖRTGEN/KARE KESİTTE BURULMA (SAINT-VENANT) ===
function hesaplaBurulmaDikdortgen(res, r, torque) {
    hesaplaAtaletDikdortgen(res, r);
    res.torsion = torque;
    res.sectionType = 'rect';

    const d = rectDims(r);
    if (res.area <= 0 || d.w <= 0 || d.h <= 0) return;

    const a = Math.max(d.w, d.h);          // uzun kenar
    const b = Math.min(d.w, d.h);          // kısa kenar
    const q = a / b;
    const G = (typeof r.G === 'number' && r.G > 0) ? r.G : DEFAULT_G;
    const Gmpa = G * 1000;                 // GPa → MPa (N/mm²)

    const co = rectTorsionCoeffs(q);
    const It = co.beta * a * b * b * b;    // burulma atalet momenti (mm⁴)
    const Wt = co.alpha * a * b * b;       // burulma mukavemet momenti (mm³)

    const thetaPrime = (Gmpa * It > 1e-9) ? torque / (Gmpa * It) : 0; // rad/mm

    // τ1: uzun kenarın ortasında (mutlak maksimum), τ2: kısa kenarın ortasında
    const tauLong = co.k1 * Gmpa * thetaPrime * b;
    const tauShort = co.gamma * tauLong;

    res.Ip = It;                           // burulma atalet momenti (panelde It)
    res.GIp = Gmpa * It;                   // burulma rijitliği G·It (N·mm²)
    res.thetaPrime = thetaPrime;
    res.thetaDegPerM = thetaPrime * 1000 * RAD2DEG;
    res.Wt = Wt;
    res.tauMax = tauLong;
    res.tauSecond = tauShort;
    res.tauMin = 0;                        // dikdörtgende köşelerde τ = 0

    // Uzun kenar yatay ise (w ≥ h) kenar ortaları düşey eksende, aksi hâlde yatayda
    const longIsHorizontal = d.w >= d.h;

    res.rectInfo = {
        w: d.w, h: d.h, a, b, q,
        alpha: co.alpha, beta: co.beta, gamma: co.gamma,
        It, Wt, G, tauLong, tauShort, longIsHorizontal,
        gTheta: Gmpa * thetaPrime      // rectTauVector çıktısını MPa'ya çevirir
    };

    res.rhoMax = b / 2;                    // τmax'ın merkeze uzaklığı
    res.rhoMin = 0;
}

// === KOMPOZİT (ÇOK MALZEMELİ) DAİRESEL KESİTTE BURULMA ===
function hesaplaBurulma(res, circs, torque) {
    hesaplaAtaletDaire(res, circs);
    // Boş kesit de dairesel aileye düşer (eski davranış: çizim bu durumda
    // dairesel yolun boş hâlini bekler)
    res.sectionType = 'circular';
    res.torsion = torque;

    if (res.area <= 0) return;

    const bands = getSectionBands(circs);

    // Polar atalet momentleri: J_i = π/2 (r_dış⁴ − r_iç⁴)
    let Ip = 0;
    let GIp = 0; // N·mm² (G: GPa → MPa için ×1000)
    bands.forEach(b => {
        b.J = Math.PI / 2 * (Math.pow(b.rOut, 4) - Math.pow(b.rIn, 4));
        Ip += b.J;
        GIp += (b.G * 1000) * b.J;
    });

    res.Ip = Ip;
    res.GIp = GIp;

    // Uygunluk + denge: θ' = T / Σ(G·Ip)
    const thetaPrime = (GIp > 1e-9) ? (torque / GIp) : 0; // rad/mm
    res.thetaPrime = thetaPrime;
    res.thetaDegPerM = thetaPrime * 1000 * RAD2DEG;

    // Her malzeme bandında τ = G·θ'·ρ (doğrusal)
    // Bandın taşıdığı moment payı T_i = G_i·θ′·J_i ve kendi mukavemet momenti
    // Wt_i = J_i/r_dış,i: kompozitte kesitin Wt'si τmax'ı VERMEZ (τ G'ye bağlı),
    // ama her bant kendi payıyla homojen bir halka gibi çalışır, τ_dış,i = T_i/Wt_i
    bands.forEach(b => {
        b.tauIn = (b.G * 1000) * thetaPrime * b.rIn;
        b.tauOut = (b.G * 1000) * thetaPrime * b.rOut;
        b.torque = (b.G * 1000) * thetaPrime * b.J;
        b.Wt = b.rOut > 0 ? b.J / b.rOut : 0;
    });
    res.torsionBands = bands;

    const rMax = bands.length ? bands[bands.length - 1].rOut : 0;
    const rMin = bands.length ? bands[0].rIn : 0;
    res.rhoMax = rMax;
    res.rhoMin = rMin;

    // Genel τmax: bant dış kenarlarındaki en büyük mutlak değer (işaret korunur)
    let tauMax = 0;
    bands.forEach(b => {
        if (Math.abs(b.tauOut) > Math.abs(tauMax)) tauMax = b.tauOut;
    });
    res.tauMax = tauMax;
    // τmin: bantların İÇ kenarlarındaki en küçük |τ| (dolu çekirdekte 0). En içteki
    // bandın iç kenarı olmak zorunda değildir: τ = G_i·θ′·ρ olduğundan iç malzeme
    // rijitse en küçük değer dıştaki bir bandın iç kenarında çıkar (çelik halka +
    // alüminyum kılıfta panel önceden 2.77 yazıyordu, gerçek en küçük 1.35 MPa).
    // Seçim G·r_iç ile yapılır ki moment sıfırken de aynı bant bulunsun.
    let minBand = bands[0];
    bands.forEach(b => { if (b.G * b.rIn < minBand.G * minBand.rIn) minBand = b; });
    res.tauMin = minBand.tauIn;

    // Burulma mukavemet momenti (geometrik): Wt = Ip / ρmax
    res.Wt = rMax > 0 ? Ip / rMax : 0;
}

// === GİRİŞ NOKTASI ===
// section = { circles, rectangles, profileDef }, torque: N·mm. Geçersiz geometride
// errorState dolu, geri kalanı boş bir sonuç döner — sessizce yanlış sayı üretilmez.
function computeSection(section, torque) {
    const circs = section.circles || [];
    const rects = section.rectangles || [];
    const fail = (state) => {
        const e = emptyResult();
        e.errorState = state;
        return e;
    };

    // Dairesel ve dikdörtgen kesit farklı burulma teorileriyle çözülür; aynı
    // kesitte birleştirilemezler (birinde kesit düzlem kalır, diğerinde çarpılır)
    if (rects.length > 0 && circs.length > 0) return fail('mixed');
    if (section.profileDef && !profileIsValid(section.profileDef)) return fail('profileDims');
    if (rects.length > 1 && !rectsShareMaterial(rects)) return fail('profileMaterial');
    // Örtüşen elemanlar REDDEDİLİR. Alan/atalet birleşim ayrıştırmasından geldiği
    // için doğru kalırdı, ama J = (1/3)Σb·t³ ELEMAN başına toplanır ve örtüşen
    // bölge iki kez sayılır (üst üste iki özdeş cidarda J tam iki katına çıkar,
    // ölçüldü). Cidar formülü alan gibi ayrıştırılamaz: J bir orta çizgi
    // integralidir, hücrelere bölünüp toplanamaz. Rastgele dikdörtgen yığınından
    // topoloji çıkarmak zaten kapsam dışı — sessizce yanlış rijitlik vermek yerine
    // hesap durdurulur (bkz. multiCell).
    if (rects.length > 1 && rectElementsOverlap(rects)) return fail('rectOverlap');

    const res = emptyResult();

    // Birden çok dikdörtgen: kesit ekleme yoluyla kurulan ince cidarlı bir
    // profildir. Kesişim/eş merkezlilik denetimleri yalnız dairesel aileye aittir.
    if (rects.length > 1) {
        hesaplaBurulmaProfil(res, rects, torque);
        const info = res.profileInfo;
        if (info.multiCell) return fail('multiCell');
        if (info.closedShape) return fail('closedShape');
        if (info.wallStack) return fail('wallStack');
        setPrincipalMoments(res);
        return res;
    }

    if (checkIntersectionExists(circs)) return fail('overlap');
    if (!isConcentric(circs)) return fail('concentric');

    if (rects.length > 0) {
        hesaplaBurulmaDikdortgen(res, rects[0], torque);
    } else {
        hesaplaBurulma(res, circs, torque);
    }
    setPrincipalMoments(res);
    return res;
}

// === GERİLME ALANI SORGULARI ===
// 2B harita, 3B köşe renkleri ve testler aynı sorgulardan beslenir; hepsi bir
// computeSection() sonucunu parametre olarak alır.

// ρ hangi malzeme bandına düşer. Sınır KESİN sınanamaz: 3B'de dış yüzeyin
// köşeleri tam sınırın üstündedir ve yarıçapı iki kaynaktan aşarlar —
//   · cos/sin ile üretim: hypot(r·cosθ, r·sinθ) birkaç ulp taşar,
//   · geometri konumları FLOAT32 saklanır: r = 60'ta taşma ~1.6e-6'ya çıkar.
// Toleranssız arama bu köşeleri kesit DIŞI sayıyor, τ = 0 veriyor ve silindirin
// yüzeyi kırmızı–mavi çizgili çıkıyordu. Pay Float32 nicelemesinin üstünde,
// gerçek bir cidar/boşluk kalınlığının çok altında seçilir.
const BAND_RADIUS_TOL = 1e-6;          // bağıl
function bandAtRadius(bands, rho) {
    if (!bands || !bands.length) return null;
    const tol = BAND_RADIUS_TOL * Math.max(1, bands[bands.length - 1].rOut);
    for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        if (rho >= b.rIn - tol && rho <= b.rOut + tol) return b;
    }
    return null;
}

// Profil elemanları örtüşmediğinden nokta tek bir elemana düşer (ya da kesit dışıdır)
function profileElementAt(res, xRel, yRel) {
    const info = res.profileInfo;
    if (!info) return null;
    // Kenara tam oturan noktalar (yüzey köşeleri) dışarı düşmesin diye pay bırakılır
    // (aynı Float32 gerekçesi, bkz. bandAtRadius)
    const tol = BAND_RADIUS_TOL * Math.max(1, res.rhoMax || 1);
    for (let i = 0; i < info.elements.length; i++) {
        const e = info.elements[i];
        if (Math.abs(xRel - e.cx) <= e.w / 2 + tol && Math.abs(yRel - e.cy) <= e.h / 2 + tol) return e;
    }
    return null;
}

// Açık profilde τ cidar kalınlığı boyunca DOĞRUSALDIR: orta çizgide sıfır,
// yüzeyde G·θ′·t. Kapalı kesitte kesme akısı sabit olduğundan τ = q/t cidar
// boyunca değişmez — haritada bu fark doğrudan görünür.
function profileShearAt(res, xRel, yRel) {
    const e = profileElementAt(res, xRel, yRel);
    if (!e) return 0;
    if (res.profileInfo.closed) return e.tau;
    const n = (e.across === 'x') ? (xRel - e.cx) : (yRel - e.cy);
    return e.tau * Math.min(1, 2 * Math.abs(n) / e.t);
}

// Kesit merkezine göre (x, y) noktasındaki kayma gerilmesi büyüklüğü (MPa).
// Doku üretimi hız için toplu yollarını kullanır (bant taraması / ayrıştırılmış
// seri); bu tekil sürüm 3B köşe renklendirmesi ve testler içindir.
function shearMagAt(res, x, y) {
    if (res.errorState) return 0;

    if (res.sectionType === 'profile') return profileShearAt(res, x, y);

    if (res.sectionType === 'rect' && res.rectInfo) {
        const t = rectTauVector(x, y, res.rectInfo.w, res.rectInfo.h);
        return Math.abs(res.rectInfo.gTheta) * Math.hypot(t.tx, t.ty);
    }

    const bands = res.torsionBands || [];
    const rho = Math.hypot(x, y);
    const b = bandAtRadius(bands, rho);
    return b ? Math.abs((b.G * 1000) * res.thetaPrime * rho) : 0;
}

// Alanın gerçek uçları (|τ|): renk ölçeğinin 'auto' aralığı. Halkada alt uç 0 değil
// τ_iç'tir; kompozitte tüm bant kenarları taranır.
function sectionFieldRange(res) {
    if (res.sectionType === 'rect') {
        return { vMin: 0, vMax: Math.abs(res.tauMax) };    // köşede ve merkezde τ = 0
    }
    if (res.sectionType === 'profile' && res.profileInfo) {
        const taus = res.profileInfo.elements.map(e => e.tau);
        if (!taus.length) return { vMin: 0, vMax: 0 };
        // Açıkta alan orta çizgide sıfırlanır; kapalıda en küçük değer en kalın cidardadır
        return {
            vMin: res.profileInfo.closed ? Math.min(...taus) : 0,
            vMax: Math.max(...taus)
        };
    }
    const bands = res.torsionBands;
    if (!bands || !bands.length) return { vMin: 0, vMax: 0 };

    let vMin = Infinity, vMax = 0;
    bands.forEach(b => {
        [Math.abs(b.tauIn), Math.abs(b.tauOut)].forEach(v => {
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
        });
    });
    return { vMin: isFinite(vMin) ? vMin : 0, vMax };
}

// Dikdörtgen alanın IZGARADA hızlı hesabı. rectTauVector nokta başına 100 terimli
// iki seri toplar; ızgarada bu ayrıştırılabilir çünkü toplamın her terimi u ile
// v'ye ayrı ayrı bağlıdır:
//     sx = Σ wn·P_n(u)·sin(nπv/h),   sy = Σ wn·Q_n(u)·cos(nπv/h)
// P ve Q yalnız u'ya, trigonometrik çarpanlar yalnız v'ye bağlı → üstel/trig
// çağrı sayısı (Nu·Nv·N) yerine ((Nu+Nv)·N) olur. Toplam matematiksel olarak
// rectTauVector ile AYNIDIR (aynı taşma güvenli e^{-x} biçimi kullanılır);
// örtüşme testle noktasal olarak doğrulanır.
// (u, v) çekirdek yönelimindedir: h ≤ w olmalıdır. |τ| eksen takasında değişmez
// (takas bileşenleri yer değiştirip işaret çevirir), bu yüzden büyüklük için
// çekirdeği doğrudan çağırmak yeterlidir.
function rectTauMagGrid(us, vs, w, h) {
    const Nu = us.length, Nv = vs.length;
    const sx = new Float64Array(Nu * Nv);
    const sy = new Float64Array(Nu * Nv);
    const P = new Float64Array(Nu), Q = new Float64Array(Nu);

    for (let n = 1; n <= RECT_TAU_TERMS; n += 2) {
        const A = n * Math.PI * w / (2 * h);
        const e = 1 + Math.exp(-2 * A);
        const wn = ((((n - 1) / 2) % 2 === 0) ? 1 : -1) / (n * n);

        for (let i = 0; i < Nu; i++) {
            const B = n * Math.PI * us[i] / h;
            const p = Math.exp(B - A), m = Math.exp(-B - A);
            P[i] = wn * (p + m) / e;
            Q[i] = wn * (p - m) / e;
        }
        for (let j = 0; j < Nv; j++) {
            const ang = n * Math.PI * vs[j] / h;
            const sn = Math.sin(ang), cs = Math.cos(ang);
            const row = j * Nu;
            for (let i = 0; i < Nu; i++) {
                sx[row + i] += P[i] * sn;
                sy[row + i] += Q[i] * cs;
            }
        }
    }

    const C = 8 * h / (Math.PI * Math.PI);
    const out = new Float64Array(Nu * Nv);
    for (let j = 0; j < Nv; j++) {
        const row = j * Nu, tv = -2 * vs[j];
        for (let i = 0; i < Nu; i++) {
            out[row + i] = Math.hypot(tv + C * sx[row + i], C * sy[row + i]);
        }
    }
    return out;
}
