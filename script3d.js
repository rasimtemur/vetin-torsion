// --- SCRIPT3D.JS : 3D VİZUALİZASYON ---

// === THREE.JS DEĞİŞKENLERİ ===
let scene, camera, renderer;
let barMesh, edgesMesh;
let axesHelper = null;       // uç kesitle birlikte dönen eksen takımı
let refAxesHelper = null;    // sabit uçtaki (dönmeyen) eksen takımı — gri
let ambientLight, directionalLight, directionalLight2;
let isInitialized = false;

// Kamera kontrolleri
let cameraDistance = 500;
// Yakınlaştırma sınırları. Üst sınır sabit değildir: çok uzun bir çubuk (giriş 50 m'ye
// izin verir) 10000 birimlik uzaklığa sığmaz; sığdırma gerektiğinde sınırı yükseltir,
// yoksa tekerlekle yapılan ilk yakınlaştırma görüntüyü geri çekiyordu.
const MIN_CAMERA_DIST = 10;
let maxCameraDistance = 10000;
function clampCameraDistance(d) {
    return Math.max(MIN_CAMERA_DIST, Math.min(maxCameraDistance, d));
}
// Varsayılan (izometrik / "3B") bakış açıları — açılış görünümü, "Görünümü
// sıfırla" ve ViewCube'un 3B düğmesi aynı kaynaktan beslenir.
const ISO_THETA = 112 * Math.PI / 180;   // Yatay açı
const ISO_PHI = 80 * Math.PI / 180;      // Dikey açı
let cameraTheta = ISO_THETA;
let cameraPhi = ISO_PHI;
let targetX = 0, targetY = 0, targetZ = 0;

// Mouse kontrolü
// Mouse kontrolü
let isDragging3D = false;
let dragMode = 0; // 0: ROTATE (Sol), 1: PAN (Orta), 2: ZOOM (Sağ)
let previousMouseX = 0, previousMouseY = 0;
let startCameraDistance = 500; // Zoom için başlangıç mesafesi

// 3D ayarları
// barLength / barLengthAuto script.js'te tanımlıdır: çubuk boyu 3B modelin
// uzunluğu olduğu kadar bağıl dönme açısının (φ = θ′·L) da girdisidir, 3B
// kapalıyken de gerekir. Giriş alanları da orada dinlenir (syncBarLength).
let showWireframe = false;
let showEdges = true;
let barOpacity = 0.9;

// Burulma şekil değiştirmesi
let showDeformed = true;
let showTransverse = true;         // enine kesit çizgileri (momentten bağımsız)
let deformScale = 0;               // 0 = otomatik ölçek
const DEFORM_STEPS = 48;           // şekil değiştirmede extrude bölme sayısı

// Otomatik büyütme, uygulanan momente BAĞLI OLMAMALIDIR: aksi hâlde ölçek
// momentle birlikte küçülür ve moment artsa da görüntü hiç değişmez. Bu yüzden
// ölçek, referans bir moment (1 kNm) için sabitlenir; görünen uç dönmesi böylece
// momentle doğru orantılı olur (Φ_görünen = DEFORM_REF_DEG · T[kNm]).
const DEFORM_REF_TORQUE = 1e6;     // Nmm (= 1 kNm)
const DEFORM_REF_DEG = 25;         // referans momentte görünen uç dönmesi
const DEFORM_MAX_DEG = 200;        // çok büyük momentlerde görüntü okunmaz olmasın
let deformScaleClamped = false;

// Çarpılma (warping): kesitin eksen doğrultusunda düzlemden çıkması. Dairesel ve
// halka kesitte ψ ≡ 0'dır (kesit düzlem kalır), yalnız dikdörtgende görülür; bu
// yüzden ayrı bir seçenektir. Gerçek çarpılma kesit boyutunun on binde biri
// mertebesindedir ve uç dönmesiyle AYNI büyütmede çizilirse hiç görünmez —
// kendi büyütme katsayısı vardır. Başlangıçta KAPALIDIR: çubuk önce düz
// prizma olarak görünsün, eyer yüzeyi kullanıcı isteyince gelsin (kutunun
// başlangıç durumu index.html'deki `cb3DWarp` ile aynı olmak zorunda).
let showWarp = false;
let warpScale = 0;                 // 0 = otomatik
const WARP_TARGET_FRAC = 0.08;     // otomatik ölçekte w_max / √(w·h)
const WARP_MAX_FRAC = 0.35;        // görüntü okunmaz olmasın diye üst sınır
const WARP_SEGMENTS = 16;          // uç yüzeydeki ağın kenar başına bölme sayısı
const WARP_LINES = 6;              // yüzeydeki ağ çizgisi sayısı (yön başına)
let warpScaleClamped = false;

// Eksen takımı kol uzunluğu (mm) ve gri takımın çizilmesi için gereken en küçük dönme
const AXES_LENGTH = 50;
const AXES_TWIST_EPS = 1e-4;

// "Tümünü Sığdır" payı: 1.0 tam sığdırmadır, model ekran kenarına değer.
// Küçük bir pay bırakılır ki kenar çizgileri ve eksen uçları kırpılmasın.
const FIT_MARGIN = 1.06;      // rad (~0.006°): altında iki takım zaten üst üste biner

// Gerçek dönme açıları gözle görülemeyecek kadar küçüktür (tipik olarak
// derecenin binde biri); şekil değiştirme, sonlu eleman programlarındaki gibi
// büyütülerek çizilir. Gerçek uç dönmesi panelde ayrıca yazılır.
function torsionTwistRate() {
    if (typeof calc === 'undefined' || !calc) return 0;
    if (calc.errorState) return 0;
    return calc.thetaPrime || 0;   // rad/mm
}

function getDeformScale() {
    deformScaleClamped = false;

    const rate = torsionTwistRate();
    if (Math.abs(rate) * barLength < 1e-15) return 0;
    if (deformScale > 0) return deformScale;

    // Burulma rijitliği: dairesel kesitte Σ(G·Ip), dikdörtgende G·It
    const rigidity = (typeof calc !== 'undefined' && calc) ? calc.GIp : 0;
    if (!(rigidity > 0)) return 0;

    // Referans momentin (momentten bağımsız) ürettiği uç dönmesi
    const refTwist = DEFORM_REF_TORQUE * barLength / rigidity;   // rad
    if (refTwist < 1e-15) return 0;
    let k = (DEFORM_REF_DEG * Math.PI / 180) / refTwist;

    // Üst sınır: görünen dönme çok büyürse model okunmaz hâle gelir
    const visible = Math.abs(rate) * barLength * k;
    const maxVisible = DEFORM_MAX_DEG * Math.PI / 180;
    if (visible > maxVisible) {
        k *= maxVisible / visible;
        deformScaleClamped = true;
    }
    return k;
}

// Şekil değiştirmiş yüzeyde normaller üçgen başına hesaplanırsa yüzey alacalanır:
// burulmuş bir dörtgenin iki üçgeninin normali ayrıştığından üçgenler farklı
// tonda görünür. Normaller, aralarındaki açı eşiği aşmayan komşu yüzeyler
// arasında ortalanır (keskin kenar / crease açısı): burulmuş yüzey pürüzsüz
// olur, dikdörtgenin 90°'lik köşeleri ve kesit-yanal yüzey sınırı keskin kalır.
const DEFORM_CREASE_DEG = 40;

function smoothGeometryNormals(geometry, creaseDeg) {
    const pos = geometry && geometry.attributes && geometry.attributes.position;
    const nrm = geometry && geometry.attributes && geometry.attributes.normal;

    // ExtrudeGeometry indekssizdir; başka bir geometri gelirse güvenli geri dönüş
    if (!pos || !nrm || geometry.index || typeof nrm.setXYZ !== 'function') {
        if (geometry && typeof geometry.computeVertexNormals === 'function') geometry.computeVertexNormals();
        return;
    }

    const count = pos.count;
    const faces = Math.floor(count / 3);
    if (faces < 1) return;

    // 1) Yüzey normalleri
    const fx = new Float64Array(faces), fy = new Float64Array(faces), fz = new Float64Array(faces);
    for (let f = 0; f < faces; f++) {
        const i = f * 3;
        const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
        const bx = pos.getX(i + 1) - ax, by = pos.getY(i + 1) - ay, bz = pos.getZ(i + 1) - az;
        const cx = pos.getX(i + 2) - ax, cy = pos.getY(i + 2) - ay, cz = pos.getZ(i + 2) - az;
        const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        fx[f] = nx / len; fy[f] = ny / len; fz[f] = nz / len;
    }

    // 2) Aynı konumu paylaşan köşelerden komşuluk
    // Anahtar toFixed ile kurulursa köşe başına üç dizgi biçimlemesi gerekir;
    // çarpılma çizilirken ağ on binlerce köşeye çıktığından bu tek başına
    // çizimin yarısını yiyordu. Yuvarlanmış tam sayı aynı gruplamayı verir
    // (üstelik "-0.000" ile "0.000" ayrımını da ortadan kaldırır).
    const byPos = new Map();
    const keys = new Array(count);
    for (let i = 0; i < count; i++) {
        const k = Math.round(pos.getX(i) * 1000) + ',' + Math.round(pos.getY(i) * 1000) +
                  ',' + Math.round(pos.getZ(i) * 1000);
        keys[i] = k;
        let arr = byPos.get(k);
        if (!arr) { arr = []; byPos.set(k, arr); }
        arr.push((i / 3) | 0);
    }

    // 3) Eşiği geçmeyen komşuların normalleri ortalanır
    const cosCrease = Math.cos((creaseDeg || DEFORM_CREASE_DEG) * Math.PI / 180);
    for (let i = 0; i < count; i++) {
        const f = (i / 3) | 0;
        const nb = byPos.get(keys[i]);
        let sx = 0, sy = 0, sz = 0;
        for (let j = 0; j < nb.length; j++) {
            const g = nb[j];
            if (fx[f] * fx[g] + fy[f] * fy[g] + fz[f] * fz[g] >= cosCrease) {
                sx += fx[g]; sy += fy[g]; sz += fz[g];
            }
        }
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        nrm.setXYZ(i, sx / len, sy / len, sz / len);
    }
    nrm.needsUpdate = true;
}

// === ÇARPILMA (WARPING) ===

// Kesit çarpılabilir mi: yalnız tek dikdörtgen. Dairesel ailede ψ ≡ 0'dır.
// Momentten ve hesap hatasından bağımsızdır; arayüzün çarpılma bölümünü
// açıp kapatmak için kullanılır.
function sectionCanWarp() {
    if (typeof rectangles === 'undefined' || rectangles.length !== 1) return false;
    return typeof circles === 'undefined' || circles.length === 0;
}

// Çarpılma hesabı için kesit ölçüleri; kesit çarpılmıyorsa null.
// x0, y0: dikdörtgenin 3B sahnedeki merkezi — sahne kesit ağırlık merkezine göre
// kurulur ve x/y ters çevrilir. ψ tam olarak kesit merkezine göre tanımlıdır;
// hem x hem y'de tek olduğundan çift ters çevirme ψ'yi değiştirmez.
function warpSection() {
    if (!sectionCanWarp()) return null;
    if (typeof calc === 'undefined' || !calc || calc.errorState) return null;
    if (typeof rectWarpPsi !== 'function') return null;

    const r = rectangles[0];
    const w = Math.abs(r.x2 - r.x1), h = Math.abs(r.y2 - r.y1);
    if (!(w > 0) || !(h > 0)) return null;

    const cx = (calc.centroidX || 0), cy = (calc.centroidY || 0);
    return { w, h, x0: cx - (r.x1 + r.x2) / 2, y0: cy - (r.y1 + r.y2) / 2 };
}

// max|ψ|: ölçekleme ve panelde yazılan gerçek çarpılma için gerekir. ψ harmonik
// olduğundan (∇²ψ = 0) en büyük değerini SINIRDA alır; ψ hem x hem y'de tek
// olduğu için iki kenarı taramak yeter. Her çizimde çağrıldığından önbelleklenir.
let warpPeakCache = { w: 0, h: 0, peak: 0 };

function warpPsiPeak(sec) {
    if (!sec) return 0;
    if (warpPeakCache.w === sec.w && warpPeakCache.h === sec.h) return warpPeakCache.peak;

    const N = 64;
    let peak = 0;
    for (let i = 0; i <= N; i++) {
        const x = -sec.w / 2 + sec.w * i / N;
        const y = -sec.h / 2 + sec.h * i / N;
        peak = Math.max(peak,
            Math.abs(rectWarpPsi(x, sec.h / 2, sec.w, sec.h)),
            Math.abs(rectWarpPsi(sec.w / 2, y, sec.w, sec.h)));
    }
    warpPeakCache = { w: sec.w, h: sec.h, peak };
    return peak;
}

// Çarpılmanın otomatik büyütmesi de momentten BAĞIMSIZ olmalıdır (bkz.
// getDeformScale): katsayı, referans momentin (1 kNm) w_max'ini kesit
// boyutunun WARP_TARGET_FRAC katına getirecek şekilde sabitlenir. Görünen
// çarpılma böylece T ile doğru orantılı kalır.
function getWarpScale(sec) {
    warpScaleClamped = false;
    if (!sec) return 0;
    if (warpScale > 0) return warpScale;

    const rigidity = (typeof calc !== 'undefined' && calc) ? calc.GIp : 0;
    const peak = warpPsiPeak(sec);
    if (!(rigidity > 0) || !(peak > 0)) return 0;

    const refRate = DEFORM_REF_TORQUE / rigidity;              // rad/mm (1 kNm'de)
    const size = Math.sqrt(sec.w * sec.h);
    let k = (WARP_TARGET_FRAC * size) / (refRate * peak);

    const visible = Math.abs(torsionTwistRate()) * peak * k;
    const maxVisible = WARP_MAX_FRAC * size;
    if (visible > maxVisible) {
        k *= maxVisible / visible;
        warpScaleClamped = true;
    }
    return k;
}

// Çarpılma çiziliyor mu
function warpActive(sec) {
    const s = (sec === undefined) ? warpSection() : sec;
    return showWarp && !!s && !!torsionTwistRate() && !!getWarpScale(s);
}

// Kesitteki bir noktanın eksenel çarpılma yer değiştirmesini (çizim ölçeğinde)
// veren işlev; çarpılma çizilmiyorsa null döner — çağıranlar dz = 0 kullanır.
// Ölçek ve kesit ölçüleri bir kez kapatıldığından köşe başına yeniden hesaplanmaz.
function warpDisplacer() {
    const sec = warpSection();
    if (!warpActive(sec)) return null;

    const amp = getWarpScale(sec) * torsionTwistRate();
    const w = sec.w, h = sec.h, x0 = sec.x0, y0 = sec.y0;

    // ψ 30 terimli bir seridir; çarpılma z'den bağımsız olduğu için gövdedeki
    // AYNI (x,y) her z bölmesinde yeniden sorulur (on binlerce çağrı). Önbellek
    // olmadan moment sürgüsü her oynadığında çizim gözle görülür şekilde takılır.
    const memo = new Map();
    return (x, y) => {
        const key = x + ',' + y;
        let dz = memo.get(key);
        if (dz === undefined) {
            dz = amp * rectWarpPsi(x - x0, y - y0, w, h);
            memo.set(key, dz);
        }
        return dz;
    };
}

// Kesiti burulmuş hâline taşır: her kesit ekseni etrafında φ = k·θ'·z kadar
// döner. Dikdörtgen kesitte ayrıca çarpılma vardır (w = k_ç·θ'·ψ) — dairesel
// kesitte ψ ≡ 0 olduğundan kesitler düzlem kalır. İki bileşen ayrı seçenek ve
// ayrı büyütmeyle çizildiğinden biri olmadan öteki de gösterilebilir.
// Normal yumuşatma, burulma olsun olmasın HER geometriye uygulanır: ExtrudeGeometry
// indekssiz olduğu için kendi normalleri üçgen başınadır ve daireyi çokgen gösterir.
// Eskiden yumuşatma yalnız şekil değiştirme yolunun sonundaydı; moment sıfırlanınca
// silindir prizmaya dönüyordu.
function applyTorsionDeformation(geometry) {
    const rate = torsionTwistRate();
    const k = getDeformScale();
    const twisting = !!(showDeformed && rate && k);
    const warp = warpDisplacer();

    if (twisting || warp) {
        const pos = geometry.attributes.position;

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const phi = twisting ? k * rate * z : 0;
            const c = Math.cos(phi), s = Math.sin(phi);
            // Çarpılma z'den bağımsızdır (düzgün burulma): her boy lifi kendi
            // ψ'si kadar eksenel ötelenir, kesit boyunca biriken bir etki yoktur.
            const dz = warp ? warp(x, y) : 0;
            pos.setXYZ(i, x * c - y * s, x * s + y * c, z + dz);
        }

        pos.needsUpdate = true;
    }

    // Düz (üçgen başına) normal yerine keskin kenarları koruyan yumuşatma
    smoothGeometryNormals(geometry, DEFORM_CREASE_DEG);
}

// Ölçek üst sınıra dayandı mı (bayrak getDeformScale içinde hesaplanır;
// çağrı sırasına bağlı kalmamak için burada tazelenir)
function isDeformScaleClamped() {
    getDeformScale();
    return deformScaleClamped;
}

// Şekil değiştirme etkin mi (çizimde kaç bölme kullanılacağını belirler)
function deformationActive() {
    return showDeformed && !!torsionTwistRate() && !!getDeformScale();
}

// Burulmayı görünür kılan boy doğruları: şekil değiştirmeden önce çubuk boyunca
// düz olan bu çizgiler burulma sonrası helise dönüşür. Dairesel kesitte dış yüzey
// bir dönel yüzey olduğundan burulunca silueti değişmez — şekil değiştirme ancak
// bu çizgilerle görülebilir. Renk, enkesit kenarlık rengiyle aynıdır.
const DEFORM_RINGS = 24;   // gövde boyunca çizilen enine kesit çizgisi sayısı

// Gövdenin yanal yüzeyinde enine kesit çizgileri. Moment sıfırken de çizilir
// (o durumda dönme ve çarpılma sıfır olduğundan düz kesit konturları çıkar).
// Burulmuş yüzeyde bir dörtgenin iki üçgeninin normalleri farklılaştığından
// EdgesGeometry köşegenleri "kenar" sanıp üçgenleşmeyi gösterir; onun yerine
// gerçek enkesit konturları çubuk boyunca çizilir.
function addTransverseRings(group, shape, material) {
    if (!showTransverse || !shape) return;

    // Şekil değiştirme yoksa ikisi de sıfırdır → kesitler dönmeden dizilir
    const rate = deformationActive() ? torsionTwistRate() : 0;
    const k = deformationActive() ? getDeformScale() : 0;
    const warp = warpDisplacer();
    const extracted = shape.extractPoints(24);

    // Yüzeyle çakışıp z-fighting yapmasın diye kontur çok az kaydırılır:
    // dış kontur dışarı, boşluk konturu (halka içi) boşluğa doğru
    const loops = [{ pts: extracted.shape, scale: 1.003 }];
    (extracted.holes || []).forEach(h => loops.push({ pts: h, scale: 0.997 }));

    for (let i = 0; i <= DEFORM_RINGS; i++) {
        const z = barLength * i / DEFORM_RINGS;
        const phi = k * rate * z;
        const c = Math.cos(phi), s = Math.sin(phi);

        loops.forEach(loop => {
            if (!loop.pts || loop.pts.length < 2) return;
            const v = loop.pts.map(p => {
                const x = p.x * loop.scale, y = p.y * loop.scale;
                const dz = warp ? warp(p.x, p.y) : 0;
                return new THREE.Vector3(x * c - y * s, x * s + y * c, z + dz);
            });
            v.push(v[0].clone());   // kapalı kontur
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), material));
        });
    }
}

function addTwistReferenceLines(group, outlinePoints, colorHex) {
    if (!deformationActive() || !outlinePoints.length) return;

    const rate = torsionTwistRate();
    const k = getDeformScale();
    const warp = warpDisplacer();
    const material = new THREE.LineBasicMaterial({ color: colorHex });

    outlinePoints.forEach(p => {
        // Yüzeyle çakışıp z-fighting yapmasın diye çok az dışarı alınır
        const px = p.x * 1.004, py = p.y * 1.004;
        const dz = warp ? warp(p.x, p.y) : 0;

        const pts = [];
        for (let i = 0; i <= DEFORM_STEPS; i++) {
            const z = barLength * i / DEFORM_STEPS;
            const phi = k * rate * z;
            const c = Math.cos(phi), s = Math.sin(phi);
            pts.push(new THREE.Vector3(px * c - py * s, px * s + py * c, z + dz));
        }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material));
    });
}

// Uç kesitlerdeki çarpılmış yüzey. ExtrudeGeometry'nin kapağı yalnız kesit
// KONTURUNDAN üretilir: dikdörtgende dört köşeden iki üçgen çıkar ve eyer biçimi
// orada hiç görünmez. Çarpılma çizilirken kapaklar gizlenip (bkz. update3DBar)
// yerlerine bölünmüş bu yüzey konur; üstüne, eyeri okunur kılan ağ çizgileri
// çizilir. Düzgün burulmada çarpılma z'den bağımsızdır — iki uçtaki yüzey
// birbirinin aynıdır, aralarındaki tek fark kesitin o kesitteki dönmesidir.
function addWarpFaces(group, sec, surfaceMaterial, lineMaterial, colorAt) {
    const warp = warpDisplacer();
    if (!warp || !sec) return;

    // Uçtaki kesit dönmesi: çizilen gövdeyle AYNI bağıntı (bkz. applyTorsionDeformation)
    const twistRate = deformationActive() ? getDeformScale() * torsionTwistRate() : 0;
    const N = WARP_SEGMENTS;
    const x1 = sec.x0 - sec.w / 2, y1 = sec.y0 - sec.h / 2;
    // Ağ çizgileri yüzeyle çakışıp z-fighting yapmasın diye çok az dışarı alınır
    const eps = 0.01 * Math.sqrt(sec.w * sec.h);

    [{ z: 0, dir: -1 }, { z: barLength, dir: 1 }].forEach(face => {
        const phi = twistRate * face.z;
        const c = Math.cos(phi), s = Math.sin(phi);
        const place = (x, y, out) => new THREE.Vector3(
            x * c - y * s, x * s + y * c, face.z + warp(x, y) + out);

        const coords = [], index = [], cols = [];
        for (let j = 0; j <= N; j++) {
            for (let i = 0; i <= N; i++) {
                const px = x1 + sec.w * i / N, py = y1 + sec.h * j / N;
                const v = place(px, py, 0);
                coords.push(v.x, v.y, v.z);
                // Köşeler döndürülerek konur; konumdan (x,y) geri okunamayacağı
                // için renk burada, ağ kurulurken yazılır
                if (colorAt) { const c = colorAt(-px, -py); cols.push(c[0], c[1], c[2]); }
            }
        }
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                const a = j * (N + 1) + i, b = a + 1, d = a + N + 1, e = d + 1;
                // Normal uçtan dışarı baksın diye sarım yönü uca göre çevrilir
                if (face.dir > 0) index.push(a, b, e, a, e, d);
                else index.push(a, e, b, a, d, e);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
        if (cols.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        geometry.setIndex(index);
        geometry.computeVertexNormals();   // indeksli geometride köşe normali zaten yumuşak
        group.add(new THREE.Mesh(geometry, surfaceMaterial.clone()));

        for (let a = 0; a <= WARP_LINES; a++) {
            const rowY = y1 + sec.h * a / WARP_LINES;
            const colX = x1 + sec.w * a / WARP_LINES;
            const row = [], col = [];
            for (let i = 0; i <= N; i++) {
                row.push(place(x1 + sec.w * i / N, rowY, face.dir * eps));
                col.push(place(colX, y1 + sec.h * i / N, face.dir * eps));
            }
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(row), lineMaterial.clone()));
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(col), lineMaterial.clone()));
        }
    });
}

// === GERİLME HARİTASI (3B) ===
// 2B'deki renk alanının aynısı çubuğun yüzeyine uygulanır: her köşe, kendi
// enkesit konumundaki |τ| değerine göre boyanır. Aynı anahtar (`cbStressMap`)
// iki görünümü birden yönetir; ölçek de ortaktır (`stressFieldRange`).
//
// Renk özniteliği şekil değiştirmeden ÖNCE yazılır: biçim bozulması köşelerin
// KONUMUNU taşır, sırasını değiştirmez — renkler kesitle birlikte döner.
//
// 3B yerel eksenler enkesite göre terslenmiştir (bkz. update3DBar'daki
// `cx - r.x1` biçimi), bu yüzden köşe konumundan enkesit koordinatına geçerken
// işaret çevrilir.

function stressMapActive() {
    const cb = document.getElementById('cbStressMap');
    if (!cb || !cb.checked) return false;
    if (typeof calc === 'undefined' || !calc || calc.errorState) return false;
    return typeof sectionShearMagAt === 'function' && typeof stressColorRGB === 'function';
}

// Ölçek ve önbellek çizim başına bir kez kurulur. Dikdörtgende |τ| 100 terimli
// bir seri olduğundan nokta başına önbelleklenir: aynı (x, y) her z bölmesinde
// yeniden sorulur (warpDisplacer ile aynı gerekçe).
function makeStressColorizer() {
    // Aralık ve rampa eğrisi 2B ile TEK kaynaktan gelir (stressColorPos), yoksa
    // aynı kesit iki panelde farklı renklenirdi
    const range = (typeof stressFieldRange === 'function')
        ? stressFieldRange() : { vMin: 0, vMax: 0 };
    const cache = new Map();

    // Anahtar yuvarlanmış tam sayıdır; ağ on binlerce köşeye çıktığından
    // toFixed'in dizgi biçimlemesi burada ölçülebilir yük olurdu.
    return function colorAt(x, y) {
        const key = Math.round(x * 100) + ',' + Math.round(y * 100);
        let c = cache.get(key);
        if (!c) {
            const v = sectionShearMagAt(x, y);
            const rgb = stressColorRGB(stressColorPos(v, range));
            c = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
            cache.set(key, c);
        }
        return c;
    };
}

function applyStressColors(geometry, colorAt) {
    const pos = geometry && geometry.attributes && geometry.attributes.position;
    if (!pos || !colorAt) return;

    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const c = colorAt(-pos.getX(i), -pos.getY(i));   // yerel → enkesit
        out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

// 3B panelinin renk ölçeği. 2B tuvalinkiyle aynı sayıları gösterir; DOM'da
// durur çünkü WebGL sahnesinin üstünde yazı çizmek gereksiz karmaşık olurdu.
function updateStress3DLegend() {
    const box = document.getElementById('stress3DLegend');
    if (!box) return;

    const on = stressMapActive() && !(typeof sectionIsEmpty === 'function' && sectionIsEmpty());
    box.style.display = on ? 'flex' : 'none';
    if (!on) return;

    // Alan tümüyle sıfırsa (moment yok) gövde tek renktir; ölçek de öyle olmalı.
    // Önbellek bu yüzden düz/renkli durumunu ANAHTAR olarak taşır — sabit bir
    // "boyandı" bayrağı olsaydı moment sıfırlandığında gökkuşağı asılı kalırdı.
    const flat = (typeof stressFieldFlat === 'function') && stressFieldFlat();
    const gam = (typeof stressGamma === 'number') ? stressGamma : 1;
    const mod = flat ? 'flat' : ('ramp' + gam);
    const bar = document.getElementById('stress3DLegendBar');
    if (bar && bar.dataset.painted !== mod) {
        // Skala 2B ile birebir aynı duraklardan kurulur. Rampa eğriliyse durak
        // KONUMLARI kaydırılır: skalada s konumundaki renk, değer ekseninde
        // s^(1/γ) noktasına düşer (renk konumu = t^γ'nin tersi).
        const stops = STRESS_COLORMAP.map(s =>
            'rgb(' + s[1] + ',' + s[2] + ',' + s[3] + ') ' +
            (Math.pow(s[0], 1 / gam) * 100).toFixed(1) + '%');
        const zero = STRESS_COLORMAP[0];
        bar.style.background = flat
            ? 'rgb(' + zero[1] + ',' + zero[2] + ',' + zero[3] + ')'
            : 'linear-gradient(to top, ' + stops.join(', ') + ')';
        bar.dataset.painted = mod;
    }

    const { vMin, vMax } = stressFieldRange();
    const ticks = document.getElementById('stress3DLegendTicks');
    if (!ticks) return;
    ticks.innerHTML = '';
    for (let i = 4; i >= 0; i--) {
        const el = document.createElement('span');
        el.textContent = (vMin + (vMax - vMin) * (i / 4)).toFixed(2);
        ticks.appendChild(el);
    }
}

// Gerilme haritası köşe renkleriyle çizilir; bu yüzden yüzeyde YETERİNCE KÖŞE
// olmak zorundadır. ExtrudeGeometry'nin ürettiği ağ bunu sağlamaz:
//   · yanal yüzey yalnız kontur noktalarından geçer — bölünmemiş bir dikdörtgende
//     bu dört köşedir ve dördünde de τ = 0'dır, yüzey baştan sona tek renge iner;
//   · kapak yalnız KONTURDAN üçgenlenir, kesit İÇİNDE hiç köşe yoktur (dairede
//     bütün kontur noktaları aynı yarıçapta olduğundan kapak tek renk olur).
// Çözüm çarpılmadakiyle aynı: kontur bölünür, kapak gizlenip yerine bölünmüş bir
// yüzey konur. Aşağıdaki kapak üreteci iki kesit ailesini de kapsar.

const STRESS_CAP_RINGS = 14;      // dairede yarıçap boyunca bölme
const STRESS_CAP_SECTORS = 48;    // dairede çevre boyunca bölme
const STRESS_CAP_GRID = 16;       // dikdörtgende kenar başına bölme

// nodes: yerel enkesit koordinatları [{x, y}]
// quads: düğüm indisleriyle dörtgenler [[a, b, c, d]]
// Kapak iki uca da konur; uçtaki kesit dönmesi ve (varsa) çarpılma gövdeyle AYNI
// bağıntıdan gelir (bkz. applyTorsionDeformation).
function addStressCapFaces(group, material, colorAt, nodes, quads) {
    if (!nodes.length || !quads.length) return;
    const twistRate = deformationActive() ? getDeformScale() * torsionTwistRate() : 0;
    const warp = warpDisplacer();

    [{ z: 0, dir: -1 }, { z: barLength, dir: 1 }].forEach(face => {
        const phi = twistRate * face.z;
        const c = Math.cos(phi), s = Math.sin(phi);

        const coords = [], cols = [], index = [];
        nodes.forEach(n => {
            const dz = warp ? warp(n.x, n.y) : 0;
            coords.push(n.x * c - n.y * s, n.x * s + n.y * c, face.z + dz);
            if (colorAt) {
                const col = colorAt(-n.x, -n.y);      // yerel → enkesit
                cols.push(col[0], col[1], col[2]);
            }
        });
        quads.forEach(q => {
            // Normal uçtan dışarı baksın diye sarım yönü uca göre çevrilir
            if (face.dir > 0) index.push(q[0], q[1], q[2], q[0], q[2], q[3]);
            else index.push(q[0], q[2], q[1], q[0], q[3], q[2]);
        });

        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
        if (cols.length) g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        g.setIndex(index);
        g.computeVertexNormals();
        group.add(new THREE.Mesh(g, material.clone()));
    });
}

// Dikdörtgen kapak ağı (yerel köşe sınırlarıyla)
function rectCapMesh(rx1, ry1, rx2, ry2) {
    const N = STRESS_CAP_GRID;
    const nodes = [], quads = [];
    for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
            nodes.push({ x: rx1 + (rx2 - rx1) * i / N, y: ry1 + (ry2 - ry1) * j / N });
        }
    }
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const a = j * (N + 1) + i;
            quads.push([a, a + 1, a + N + 2, a + N + 1]);
        }
    }
    return { nodes, quads };
}

// Dairesel/halka kapak ağı (kutupsal). Dolu kesitte iç yarıçap sıfırdır; merkez
// düğümleri üst üste biner ama üçgenler yozlaşmadığı için ağ sağlamdır.
function circleCapMesh(cx, cy, rIn, rOut) {
    const NR = STRESS_CAP_RINGS, NA = STRESS_CAP_SECTORS;
    const nodes = [], quads = [];
    for (let k = 0; k <= NR; k++) {
        const r = rIn + (rOut - rIn) * k / NR;
        for (let a = 0; a < NA; a++) {
            const ang = 2 * Math.PI * a / NA;
            nodes.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
        }
    }
    for (let k = 0; k < NR; k++) {
        for (let a = 0; a < NA; a++) {
            const a0 = k * NA + a, a1 = k * NA + (a + 1) % NA;
            quads.push([a0, a1, a1 + NA, a0 + NA]);
        }
    }
    return { nodes, quads };
}

function updateDeformReadouts() {
    const rate = torsionTwistRate();
    // Gerçek uç dönmesi = sağ paneldeki bağıl dönme açısı; birimi de ortaktır
    const twistEl = document.getElementById('val3DTwist');
    if (twistEl) twistEl.textContent = formatAngle(rate * barLength * angleFactor());
    const twistUnitEl = document.getElementById('unit3DTwist');
    if (twistUnitEl) twistUnitEl.textContent = angleUnitLabel();

    const scaleEl = document.getElementById('lbl3DDeformScale');
    if (scaleEl) {
        const k = getDeformScale();
        if (!deformationActive()) {
            scaleEl.textContent = '× —';
        } else {
            const num = k >= 100 ? Math.round(k) : k.toFixed(1);
            scaleEl.textContent = (deformScale > 0 ? '×' : '× oto: ') + num +
                (isDeformScaleClamped() ? ' (sınır)' : '');
        }
    }

    updateWarpReadouts();
}

// Çarpılma bölümü: dairesel/halka kesitte ψ ≡ 0 olduğundan seçenek kapatılır ve
// nedeni yazılır — "çalışmıyor" gibi görünmesin, öğrencide karşılığı olsun.
function updateWarpReadouts() {
    const canWarp = sectionCanWarp();
    const sec = warpSection();

    const block = document.getElementById('warp3DControls');
    if (block) block.classList.toggle('controls-disabled', !canWarp);
    const cb = document.getElementById('cb3DWarp');
    if (cb) cb.disabled = !canWarp;
    const hint = document.getElementById('warp3DHint');
    if (hint) hint.style.display = canWarp ? 'none' : 'block';

    // Panelde GERÇEK (büyütmesiz) en büyük eksenel yer değiştirme yazılır:
    // w_max = |θ′|·max|ψ|. Tipik olarak mikron mertebesindedir; çizimdeki eyer
    // bu yüzden kendi katsayısıyla büyütülür.
    const warpEl = document.getElementById('val3DWarp');
    if (warpEl) {
        const wmax = sec ? Math.abs(torsionTwistRate()) * warpPsiPeak(sec) : 0;
        warpEl.textContent = (wmax === 0 || wmax >= 1e-3) ? wmax.toFixed(4) : wmax.toExponential(2);
    }

    const scaleEl = document.getElementById('lbl3DWarpScale');
    if (scaleEl) {
        const k = getWarpScale(sec);
        if (!warpActive(sec)) {
            scaleEl.textContent = '× —';
        } else {
            const num = k >= 100 ? Math.round(k) : k.toFixed(1);
            scaleEl.textContent = (warpScale > 0 ? '×' : '× oto: ') + num +
                (warpScaleClamped ? ' (sınır)' : '');
        }
    }
}

// Animasyon değişkenleri
let isAnimating = false;
let animStartTime = 0;
const ANIM_DURATION = 800; // ms
let animStart = { theta: 0, phi: 0, dist: 0, tx: 0, ty: 0, tz: 0 };
let animTarget = { theta: 0, phi: 0, dist: 0, tx: 0, ty: 0, tz: 0 };

// === BAŞLATMA ===
function init3D() {
    if (isInitialized) return;

    const canvas = document.getElementById('canvas3D');
    const container = document.getElementById('three-container');

    if (!canvas || !container) return;

    // Sahne oluştur - arka plan tek kaynaktan (get3DColors) gelir
    scene = new THREE.Scene();
    scene.background = new THREE.Color(get3DColors().background);

    // Kamera oluştur
    // Ensure dimensions are valid
    let width = container.clientWidth || 1;
    let height = container.clientHeight || 1;
    const aspect = width / height;
    camera = new THREE.PerspectiveCamera(45, aspect, 1, 10000);
    updateCameraPosition();

    // Renderer oluştur
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Işıklandırma
    ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(200, 400, 300);
    scene.add(directionalLight);

    directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight2.position.set(-200, -100, -200);
    scene.add(directionalLight2);
    
    // Uygulama başlangıcındaki tema ayarını yansıt
    window.update3DTheme();

    // Eksen yardımcıları — konumları update3DBar'da uç kesite taşınır.
    // Renk düzeni: X lacivert, Y koyu yeşil, Z kırmızı (AxesHelper'ın kendi
    // kırmızı-yeşil-mavi sırası değil; 2B çizimdeki eksen renkleriyle uyum için).
    axesHelper = new THREE.AxesHelper(AXES_LENGTH);
    applyAxesColors(axesHelper, false);
    // 180° Z dönmesi: X sola, Y aşağı baksın (2B tuvalle aynı yön)
    axesHelper.rotation.z = Math.PI;
    axesHelper.position.set(0, 0, 0);
    scene.add(axesHelper);

    // Sabit uçtaki takım: aynı merkezde, dönmez, gri tonlarda. Burulma açısı iki
    // takım arasındaki fark olarak okunur; bu yüzden ortak merkezde durmalıdır.
    refAxesHelper = new THREE.AxesHelper(AXES_LENGTH);
    applyAxesColors(refAxesHelper, true);
    refAxesHelper.rotation.z = Math.PI;
    refAxesHelper.visible = false;
    scene.add(refAxesHelper);

    // Event listeners
    canvas.addEventListener('mousedown', onMouseDown3D);
    canvas.addEventListener('mousemove', onMouseMove3D);
    canvas.addEventListener('mouseup', onMouseUp3D);
    canvas.addEventListener('mouseleave', onMouseUp3D);
    canvas.addEventListener('wheel', onWheel3D);

    // Sağ tık menüsünü engelle (döndürme için kullanılıyor)
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Orta tuşun otomatik kaydırma imlecini engelle (Chrome/Firefox)
    canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });

    // Touch events for mobile
    canvas.addEventListener('touchstart', onTouchStart3D);
    canvas.addEventListener('touchmove', onTouchMove3D);
    canvas.addEventListener('touchend', onTouchEnd3D);

    // Resize
    window.addEventListener('resize', onResize3D);

    isInitialized = true;

    // ViewCube ana kameraya bağlı olduğu için kamera hazır olduktan sonra kurulur
    initViewCube();

    // İlk render
    update3DBar();
    animate();
}

// === TEMA VE RENK YÖNETİMİ ===
// Renkler script.js'in tuval/malzeme paletiyle eşleşir: aynı kesit iki pencerede
// aynı renkte görünmeli. Ozalit daha önce buraya hiç girmiyordu ("dark" değil
// diye açık temaya düşüyor, mavi kâğıdın yanında beyaz bir 3B sahne çiziyordu).
function get3DColors() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    if (theme === 'dark') {
        return {
            background: 0x0F1419,
            bar: 0x1E3A5F,      // Section fill (dark)
            edges: 0x3B82F6,    // Section stroke (dark)
            ambient: 0x404040,
            ambientInt: 0.8,
            directional: 0xffffff,
            dirInt: 0.8,
            dir2Int: 0.4,
            // ViewCube: yüz dokusu canvas'ta çizildiği için CSS renk dizgileri
            cubeFace: '#1A2333', cubeLine: '#3A4658', cubeText: '#DFE6F0',
            cubeEdge: 0x2F3B4D, cubeRing: 0x3A4658
        };
    } else if (theme === 'blueprint') {
        return {
            background: 0x0A1929,
            bar: 0x10395F,      // Section fill (ozalit)
            edges: 0x7EC8E3,    // Section stroke (ozalit)
            ambient: 0x506B85,
            ambientInt: 0.9,
            directional: 0xCFE6F5,
            dirInt: 0.7,
            dir2Int: 0.35,
            cubeFace: '#0D2647', cubeLine: '#2F5A8F', cubeText: '#DBEEFF',
            cubeEdge: 0x2F5A8F, cubeRing: 0x2F5A8F
        };
    } else {
        return {
            background: 0xFFFFFF,   // 2B tuvalle aynı kâğıt (önce 0xfafafa idi)
            bar: 0xD4E5EE,      // Section fill (light)
            edges: 0x4E94B1,    // Section stroke (light)
            ambient: 0xffffff,
            ambientInt: 0.6,
            directional: 0xffffff,
            dirInt: 0.8,
            dir2Int: 0.3,
            cubeFace: '#E9EAE6', cubeLine: '#A8ADB5', cubeText: '#3A4048',
            cubeEdge: 0x7A8290, cubeRing: 0x55617A
        };
    }
}

// Eksen kolu renkleri [X, Y, Z]. Koyu zeminde (koyu tema ve ozalit) parlak
// tonlara çekilir. Gri takımda (sabit uç) üç ayrı ton kullanılır: renk taşımadığı
// için hangi kolun hangi eksen olduğu ancak tonla ayırt edilir.
function axesPalette(onDark, gray) {
    if (gray) {
        return onDark
            ? [[0.78, 0.78, 0.80], [0.60, 0.60, 0.63], [0.44, 0.44, 0.47]]
            : [[0.35, 0.35, 0.38], [0.52, 0.52, 0.55], [0.68, 0.68, 0.71]];
    }
    return onDark
        ? [[0.2, 0.5, 1.0], [0.2, 1.0, 0.2], [1.0, 0.3, 0.3]]
        : [[0.0, 0.0, 0.5], [0.0, 0.5, 0.0], [1.0, 0.0, 0.0]];
}

function applyAxesColors(helper, gray) {
    if (!helper) return;
    const theme = document.documentElement.getAttribute('data-theme');
    const onDark = theme === 'dark' || theme === 'blueprint';
    const [cx, cy, cz] = axesPalette(onDark, gray);
    const cols = helper.geometry.attributes.color;
    cols.setXYZ(0, cx[0], cx[1], cx[2]); cols.setXYZ(1, cx[0], cx[1], cx[2]);
    cols.setXYZ(2, cy[0], cy[1], cy[2]); cols.setXYZ(3, cy[0], cy[1], cy[2]);
    cols.setXYZ(4, cz[0], cz[1], cz[2]); cols.setXYZ(5, cz[0], cz[1], cz[2]);
    cols.needsUpdate = true;
}

window.update3DTheme = function() {
    if (!isInitialized || !scene) return;
    
    const colors = get3DColors();
    scene.background = new THREE.Color(colors.background);

    // Küp yüzleri canvas dokusuna çizildiği için renk değişimi yeniden kurulmayı gerektirir
    buildViewCube();
    
    if (ambientLight) {
        ambientLight.color.setHex(colors.ambient);
        ambientLight.intensity = colors.ambientInt;
    }
    if (directionalLight) {
        directionalLight.color.setHex(colors.directional);
        directionalLight.intensity = colors.dirInt;
    }
    if (directionalLight2) {
        directionalLight2.color.setHex(colors.directional);
        directionalLight2.intensity = colors.dir2Int;
    }
    
    // Koyu zeminlerde (koyu tema ve ozalit) eksenler parlak tonlara çekilir
    applyAxesColors(axesHelper, false);
    applyAxesColors(refAxesHelper, true);
};

// === KAMERA POZİSYONU ===
function updateCameraPosition() {
    if (!camera) return;

    camera.position.x = targetX + cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
    camera.position.y = targetY + cameraDistance * Math.cos(cameraPhi);
    camera.position.z = targetZ + cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);

    // Gimbal lock sorununu çözmek için up vektörünü ayarla
    // cameraPhi > π olduğunda (alt yarım küre) up vektörünü ters çevir
    if (cameraPhi > Math.PI) {
        camera.up.set(0, -1, 0);
    } else {
        camera.up.set(0, 1, 0);
    }

    camera.lookAt(targetX, targetY, targetZ);

    // Açıları ekranda göster (debug)
    const angleDisplay = document.getElementById('angleDisplay');
    if (angleDisplay) {
        const thetaDeg = (cameraTheta * 180 / Math.PI).toFixed(1);
        const phiDeg = (cameraPhi * 180 / Math.PI).toFixed(1);
        angleDisplay.textContent = `📐 θ: ${thetaDeg}°  φ: ${phiDeg}°`;
    }

    // ViewCube ana kameranın bakış yönünü yansıtır. Sürekli döngüde değil,
    // yalnız kamera değişince çizilir: durağan sahnede küp de durağandır.
    renderViewCube();
}

// === VIEWCUBE (AutoCAD tarzı navigasyon küpü) ===
// Küçük tuvalde KENDİ sahnesi ve ortografik kamerasıyla çizilir; ana sahneye
// eklenmez ki modelin ışığı, opaklığı ve şekil değiştirmesi küpü etkilemesin.
// Yönünü ana kameradan alır; tıklanan yüz kamerayı o yöne döndürür.
let cubeRenderer = null, cubeScene = null, cubeCamera = null, cubeMesh = null;
let cubeReady = false;

// Çubuk +z boyunca extrude edilir, kesit x-y düzlemindedir. Buradan:
//   ÖN/ARKA = ±x (çubuğun boyu görünür), ÜST/ALT = ±y, SAĞ/SOL = ∓z (kesite bakış).
// SAĞ'ın -z olması ÖN görünümünden gelir: kamera +x'teyken ekranın sağı -z yönüdür,
// yani cismin sağ yüzü -z tarafındadır (teknik resimdeki sağ görünüş).
const VIEW_DIRECTIONS = {
    on:   [1, 0, 0],
    arka: [-1, 0, 0],
    ust:  [0, 1, 0],
    alt:  [0, -1, 0],
    sol:  [0, 0, 1],
    sag:  [0, 0, -1]
};

// Tam tepeden bakışta lookAt dejenere olur (bakış yönü camera.up ile çakışır);
// bu yüzden kutba tam oturulmaz. φ→0'da ekran eksenleri yalnız θ'ya bağlı olduğu
// için θ da serbest değildir: ÖN görünümüyle aynı θ (=0) seçilir, böylece ÜST'e
// geçerken çubuk ekranda yatay kalır, sol-sağ yönü değişmez.
const POLE_EPS = 0.01;
const POLE_THETA = 0;

// Bakış yönü (hedeften kameraya birim vektör) → küresel kamera açıları.
function dirToAngles(x, y, z) {
    const len = Math.hypot(x, y, z) || 1;
    const dx = x / len, dy = y / len, dz = z / len;
    if (Math.abs(dy) > 0.999) {
        return { theta: POLE_THETA, phi: dy > 0 ? POLE_EPS : Math.PI - POLE_EPS };
    }
    return {
        theta: Math.atan2(dz, dx),
        phi: Math.acos(Math.min(1, Math.max(-1, dy)))
    };
}

function initViewCube() {
    const canvas = document.getElementById('viewcubeCanvas');
    if (!canvas || cubeRenderer) return;

    cubeRenderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    cubeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    cubeRenderer.setSize(canvas.width, canvas.height);
    // Ortografik: küp bakış açısına göre boyut değiştirmesin, hep aynı büyüklükte dursun
    cubeCamera = new THREE.OrthographicCamera(-2.3, 2.3, 2.3, -2.3, 0.1, 100);

    buildViewCube();
    bindViewCubeEvents(canvas);
}

// Küp sahnesini kurar. Yüz dokuları temaya bağlı olduğu için tema değişiminde
// bu fonksiyon yeniden çağrılır (eski doku/geometriler serbest bırakılır).
function buildViewCube() {
    if (!cubeRenderer) return;

    if (cubeScene) {
        cubeScene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
            }
        });
    }

    const colors = get3DColors();
    cubeScene = new THREE.Scene();

    // Yüz etiketleri canvas dokusuna yazılır: three.js'in doğrudan yazı desteği yok.
    // rotation: BoxGeometry'nin ±y yüzlerindeki doku eşlemesi yazıyı 90° yatırır;
    // ÜST/ALT görünümünde etiket düz okunsun diye dokuda ters yönde döndürülür.
    const faceMaterial = (label, rotation = 0) => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = colors.cubeFace;
        g.fillRect(0, 0, 128, 128);
        g.strokeStyle = colors.cubeLine;
        g.lineWidth = 5;
        g.strokeRect(3, 3, 122, 122);
        g.fillStyle = colors.cubeText;
        g.font = "700 24px 'Segoe UI', sans-serif";
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.save();
        g.translate(64, 67);
        g.rotate(rotation);
        g.fillText(label, 0, 0);
        g.restore();
        const tex = new THREE.CanvasTexture(c);
        tex.anisotropy = 4;
        return new THREE.MeshBasicMaterial({ map: tex });
    };

    // BoxGeometry yüz sırası: +x, -x, +y, -y, +z, -z (bkz. VIEW_DIRECTIONS)
    cubeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.5, 1.5),
        [faceMaterial('ÖN'), faceMaterial('ARKA'), faceMaterial('ÜST', -Math.PI / 2),
         faceMaterial('ALT', Math.PI / 2), faceMaterial('SOL'), faceMaterial('SAĞ')]
    );
    cubeScene.add(cubeMesh);

    cubeScene.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(cubeMesh.geometry),
        new THREE.LineBasicMaterial({ color: colors.cubeEdge })
    ));

    // Küpün altındaki halka: AutoCAD ViewCube'undaki pusula halkasının karşılığı.
    // Yön harfleri (K/G/D/B) konmaz — çubuğun coğrafi bir yönü yok.
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.62, 0.055, 8, 64),
        new THREE.MeshBasicMaterial({ color: colors.cubeRing, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1.05;
    cubeScene.add(ring);

    cubeReady = true;
    renderViewCube();
}

function renderViewCube() {
    if (!cubeReady || !camera) return;

    const camDir = new THREE.Vector3()
        .subVectors(camera.position, new THREE.Vector3(targetX, targetY, targetZ))
        .normalize();
    cubeCamera.position.copy(camDir).multiplyScalar(6);
    cubeCamera.up.copy(camera.up);
    cubeCamera.lookAt(0, 0, 0);
    cubeRenderer.render(cubeScene, cubeCamera);
}

// Küpte tıklama ile sürüklemeyi ayırt eder: 4 pikselden büyük hareket sürükleme
// (serbest döndürme), altı tıklamadır (tıklanan yüze dönülür).
function bindViewCubeEvents(canvas) {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let press = null, dragged = false;

    const pick = (e) => {
        if (!cubeMesh || !cubeCamera) return null;
        const r = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1,
                -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, cubeCamera);
        return raycaster.intersectObject(cubeMesh)[0] || null;
    };

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        if (!isInitialized) return;
        e.preventDefault();
        isAnimating = false;   // kullanıcı müdahalesi süren animasyonu keser
        press = { x: e.clientX, y: e.clientY };
        dragged = false;

        const onMove = (ev) => {
            if (!press) return;
            const dx = ev.clientX - press.x, dy = ev.clientY - press.y;
            if (!dragged && Math.hypot(dx, dy) > 4) dragged = true;
            if (!dragged) return;
            cameraTheta += dx * 0.01;
            cameraPhi = Math.min(Math.max(cameraPhi - dy * 0.01, POLE_EPS), Math.PI - POLE_EPS);
            press = { x: ev.clientX, y: ev.clientY };
            updateCameraPosition();
        };
        const onUp = (ev) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (!dragged) {
                const hit = pick(ev);
                // face.normal nesne uzayındadır; küp döndürülmediği için doğrudan
                // dünya eksenini verir
                if (hit && hit.face) setViewDirection(hit.face.normal);
            }
            press = null;
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    canvas.addEventListener('mousemove', (e) => {
        if (press) return;
        canvas.style.cursor = pick(e) ? 'pointer' : 'grab';
    });
}

// Yalnız bakış yönünü değiştirir; yakınlaştırma ve kaydırma korunur (AutoCAD davranışı).
function setViewDirection(vec) {
    const { theta, phi } = dirToAngles(vec.x, vec.y, vec.z);
    animateCameraTo(theta, phi, cameraDistance);
}



// === MOUSE/TOUCH OLAYLARI ===
// Fare tuşu → sürükleme kipi: sol = taşıma, sağ = döndürme, orta = yakınlaştırma.
// dragMode değerleri (0 döndür, 1 taşı, 2 yakınlaştır) dokunmatik yolla ortak
// olduğu için korunur; değişen yalnızca tuş eşlemesidir.
function onMouseDown3D(e) {
    let mode;
    if (e.button === 0) mode = 1;          // Sol → PAN (taşıma)
    else if (e.button === 2) mode = 0;     // Sağ → ROTATE (döndürme)
    else if (e.button === 1) mode = 2;     // Orta → ZOOM
    else return;                           // yan tuşlar yok sayılır

    // Orta tuş basılı tutulunca tarayıcı otomatik kaydırmayı başlatır;
    // sürükleme onun altında kalır
    if (e.button === 1) e.preventDefault();

    isDragging3D = true;
    previousMouseX = e.clientX;
    previousMouseY = e.clientY;
    dragMode = mode;

    if (mode === 1) e.target.style.cursor = 'move';
    else if (mode === 0) e.target.style.cursor = 'grabbing';
    else {
        startCameraDistance = cameraDistance;
        e.target.style.cursor = 'ns-resize';
    }
}

function onMouseMove3D(e) {
    if (!isAnimating && isDragging3D) {
        const deltaX = e.clientX - previousMouseX;
        const deltaY = e.clientY - previousMouseY;

        if (dragMode === 0) {
            // ROTATE (Sağ Tuş)
            cameraTheta += deltaX * 0.01;
            cameraPhi -= deltaY * 0.01;

            if (cameraPhi < 0) cameraPhi += Math.PI * 2;
            if (cameraPhi > Math.PI * 2) cameraPhi -= Math.PI * 2;
            if (cameraTheta < 0) cameraTheta += Math.PI * 2;
            if (cameraTheta > Math.PI * 2) cameraTheta -= Math.PI * 2;

        } else if (dragMode === 1) {
            // PAN (Sol Tuş)
            // Kamera yönüne göre sağ ve yukarı vektörlerini bul

            // Kamera yön vektörü (normalized değil ama yön doğru)
            // camera.position - target
            const camDir = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(targetX, targetY, targetZ)).normalize();

            // Kamera Up vektörü
            const camUp = camera.up.clone();

            // Kamera Right vektörü (Dir x Up)
            const camRight = new THREE.Vector3().crossVectors(camUp, camDir).normalize();

            // Gerçek Up vektörü (Right x Dir) - Kameranın Y ekseni
            const camRealUp = new THREE.Vector3().crossVectors(camDir, camRight).normalize();

            // Pan faktörü (uzaklığa göre değişmeli)
            const panFactor = cameraDistance * 0.002;

            // Hedef noktayı kaydır (ters yönde, sürükleme hissi için)
            // Sağa sürükleyince (deltaX > 0), görüntü sağa kaysın -> hedef sola kaymalı? Hayır, hedef de sağa kaymalı ki kamera da kaysın.
            // Aslında target'ı ters yönde hareket ettirmeliyiz:
            // Mouse sağa -> target sola (x ekseninde)

            const moveVec = new THREE.Vector3()
                .addScaledVector(camRight, -deltaX * panFactor)
                .addScaledVector(camRealUp, deltaY * panFactor);

            targetX += moveVec.x;
            targetY += moveVec.y;
            targetZ += moveVec.z;

        } else if (dragMode === 2) {
            // ZOOM (Orta Tuş)
            // Yukarı sürükle -> Yakınlaş, Aşağı -> Uzaklaş
            const zoomFactor = 1 + deltaY * 0.005;
            cameraDistance *= zoomFactor;
            cameraDistance = clampCameraDistance(cameraDistance);
        }

        previousMouseX = e.clientX;
        previousMouseY = e.clientY;

        updateCameraPosition();
    }
}

function onMouseUp3D(e) {
    isDragging3D = false;
    if (e.target) e.target.style.cursor = 'grab';
}

function onWheel3D(e) {
    e.preventDefault();
    cameraDistance *= e.deltaY > 0 ? 1.02 : 0.98;
    cameraDistance = clampCameraDistance(cameraDistance);
    updateCameraPosition();
}

// Touch events
let touchStartDistance = 0;

function onTouchStart3D(e) {
    if (e.touches.length === 1) {
        isDragging3D = true;
        previousMouseX = e.touches[0].clientX;
        previousMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        touchStartDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
    }
}

function onTouchMove3D(e) {
    e.preventDefault();

    if (e.touches.length === 1 && isDragging3D) {
        const deltaX = e.touches[0].clientX - previousMouseX;
        const deltaY = e.touches[0].clientY - previousMouseY;

        cameraTheta += deltaX * 0.01;
        cameraPhi -= deltaY * 0.01;

        // 360 derece döndürme serbest
        if (cameraPhi < 0) cameraPhi += Math.PI * 2;
        if (cameraPhi > Math.PI * 2) cameraPhi -= Math.PI * 2;
        if (cameraTheta < 0) cameraTheta += Math.PI * 2;
        if (cameraTheta > Math.PI * 2) cameraTheta -= Math.PI * 2;

        previousMouseX = e.touches[0].clientX;
        previousMouseY = e.touches[0].clientY;

        updateCameraPosition();
    } else if (e.touches.length === 2) {
        const currentDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );

        const delta = touchStartDistance - currentDistance;
        cameraDistance *= 1 + delta * 0.005;
        cameraDistance = clampCameraDistance(cameraDistance);

        touchStartDistance = currentDistance;
        updateCameraPosition();
    }
}

function onTouchEnd3D(e) {
    isDragging3D = false;
}

function onResize3D() {
    if (!renderer || !camera) return;

    const container = document.getElementById('three-container');
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

// === 3D BAR GÜNCELLEME ===
// Mesh grupları için global değişkenler
let barGroup = null;
let edgesGroup = null;

// Kamera yalnızca çubuğun GEOMETRİSİ değiştiğinde yeniden yerleşir. Burulma
// momenti değişince de update3DBar() baştan çalışır; şekil değiştirmiş çubuğun
// sınır kutusu momentle büyüdüğünden otomatik yerleşim, slider her oynadığında
// görüntüyü yakınlaştırıp uzaklaştırıyordu. Bu yüzden moment imzaya girmez —
// kullanıcı isterse "Tümünü Sığdır" düğmesiyle yeniden yerleştirir.
let lastBarGeometryKey = null;

function barGeometryKey() {
    const parts = [];
    if (typeof rectangles !== 'undefined') {
        rectangles.forEach(r => parts.push('R', r.x1, r.y1, r.x2, r.y2));
    }
    if (typeof circles !== 'undefined') {
        circles.forEach(c => parts.push('C', c.cx, c.cy, c.r, c.ri || 0));
    }
    parts.push('L', barLength);
    return parts.join(',');
}

// Çarpılmış uç yüzeyi çizilirken gövde iki malzemeyle kullanılır (kapak + yan
// yüzey), bu yüzden malzeme bir dizi olabilir.
function disposeMaterial(material) {
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    list.forEach(m => { if (m && m.dispose) m.dispose(); });
}

function update3DBar() {
    if (!scene || !isInitialized) return;

    // Eski mesh'leri kaldır
    if (barGroup) {
        scene.remove(barGroup);
        barGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            disposeMaterial(child.material);
        });
    }
    if (edgesGroup) {
        scene.remove(edgesGroup);
        edgesGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            disposeMaterial(child.material);
        });
    }

    // Rectangles ve Circles kontrolü
    const hasRectangles = typeof rectangles !== 'undefined' && rectangles.length > 0;
    const hasCircles = typeof circles !== 'undefined' && circles.length > 0;

    if (!hasRectangles && !hasCircles) {
        updateDeformReadouts();
        return;
    }

    // Çubuk boyu (otomatik moddaysa kesitin 10 katı) script.js'te tazelenir
    if (typeof syncBarLength === 'function') syncBarLength();

    // Kesitin sınırlayıcı kutusu — kamera yerleşimi için
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rectangles.forEach(r => {
        if (r.x1 < minX) minX = r.x1;
        if (r.x2 > maxX) maxX = r.x2;
        if (r.y1 < minY) minY = r.y1;
        if (r.y2 > maxY) maxY = r.y2;
    });

    if (hasCircles) {
        circles.forEach(c => {
            if (c.cx - c.r < minX) minX = c.cx - c.r;
            if (c.cx + c.r > maxX) maxX = c.cx + c.r;
            if (c.cy - c.r < minY) minY = c.cy - c.r;
            if (c.cy + c.r > maxY) maxY = c.cy + c.r;
        });
    }

    // Kesit boyutları
    const sectionWidth = maxX - minX;
    const sectionHeight = maxY - minY;

    // Offset için centroid kullan

    // Offset için centroid kullan
    const cx = typeof calc !== 'undefined' ? calc.centroidX : 0;
    const cy = typeof calc !== 'undefined' ? calc.centroidY : 0;



    // Extrude ayarları — şekil değiştirme çizilecekse gövde boyunca bölünür
    updateDeformReadouts();
    const extrudeSettings = {
        steps: deformationActive() ? DEFORM_STEPS : 1,
        depth: barLength,
        bevelEnabled: false
    };

    const colors = get3DColors();

    // Gerilme haritası açıkken renk köşelerden gelir; malzemenin kendi rengi
    // çarpan olduğu için beyaza alınmalı, yoksa harita çubuk rengiyle boyanır
    const stressColors = stressMapActive();
    const colorAt = stressColors ? makeStressColorizer() : null;
    updateStress3DLegend();

    const material = new THREE.MeshPhongMaterial({
        color: stressColors ? 0xFFFFFF : colors.bar,
        vertexColors: stressColors,
        wireframe: false,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: showWireframe ? 0 : barOpacity
    });

    const edgesMaterial = new THREE.LineBasicMaterial({
        color: colors.edges,
        linewidth: 1
    });

    // Gruplar oluştur
    barGroup = new THREE.Group();
    edgesGroup = new THREE.Group();

    let renderSuccess = false;

    if (!renderSuccess) {

        // Helper: Check if circular hole intersects with rectangle
        // This properly handles full, half, and quarter circles
        function circleIntersectsRect(hole, rect) {
            const hCx = hole.cx;
            const hCy = hole.cy;
            const hR = hole.r;
            const subtype = hole.subtype || 'full';

            const rx1 = Math.min(rect.x1, rect.x2);
            const rx2 = Math.max(rect.x1, rect.x2);
            const ry1 = Math.min(rect.y1, rect.y2);
            const ry2 = Math.max(rect.y1, rect.y2);

            // Calculate bounding box of the circle/wedge based on subtype
            let hx1, hx2, hy1, hy2;

            switch (subtype) {
                case 'full':
                    hx1 = hCx - hR;
                    hx2 = hCx + hR;
                    hy1 = hCy - hR;
                    hy2 = hCy + hR;
                    break;

                case 'half-top':
                    hx1 = hCx - hR;
                    hx2 = hCx + hR;
                    hy1 = hCy;        // Center (bottom of half)
                    hy2 = hCy + hR;   // Top
                    break;

                case 'half-bottom':
                    hx1 = hCx - hR;
                    hx2 = hCx + hR;
                    hy1 = hCy - hR;   // Bottom
                    hy2 = hCy;        // Center (top of half)
                    break;

                case 'half-right':
                    hx1 = hCx;        // Center (left of half)
                    hx2 = hCx + hR;   // Right
                    hy1 = hCy - hR;
                    hy2 = hCy + hR;
                    break;

                case 'half-left':
                    hx1 = hCx - hR;   // Left
                    hx2 = hCx;        // Center (right of half)
                    hy1 = hCy - hR;
                    hy2 = hCy + hR;
                    break;

                case 'quarter-tr':  // Top-Right
                    hx1 = hCx;        // Center (left)
                    hx2 = hCx + hR;   // Right
                    hy1 = hCy;        // Center (bottom)
                    hy2 = hCy + hR;   // Top
                    break;

                case 'quarter-tl':  // Top-Left
                    hx1 = hCx - hR;   // Left
                    hx2 = hCx;        // Center (right)
                    hy1 = hCy;        // Center (bottom)
                    hy2 = hCy + hR;   // Top
                    break;

                case 'quarter-bl':  // Bottom-Left
                    hx1 = hCx - hR;   // Left
                    hx2 = hCx;        // Center (right)
                    hy1 = hCy - hR;   // Bottom
                    hy2 = hCy;        // Center (top)
                    break;

                case 'quarter-br':  // Bottom-Right
                    hx1 = hCx;        // Center (left)
                    hx2 = hCx + hR;   // Right
                    hy1 = hCy - hR;   // Bottom
                    hy2 = hCy;        // Center (top)
                    break;

                default:
                    // Fallback to full circle
                    hx1 = hCx - hR;
                    hx2 = hCx + hR;
                    hy1 = hCy - hR;
                    hy2 = hCy + hR;
            }

            // Check if bounding boxes intersect
            // Two rectangles intersect if they overlap in both x and y
            const xOverlap = (hx1 <= rx2) && (hx2 >= rx1);
            const yOverlap = (hy1 <= ry2) && (hy2 >= ry1);

            return xOverlap && yOverlap;
        }

        // Helper to create hole path
        function createHolePath(h) {
            const path = new THREE.Path();
            // Subtype Inversion & X/Y Inversion
            const localCx = (h.cx !== undefined ? cx - h.cx : cx - (h.x1 + h.x2) / 2);
            const localCy = cy - (h.cy !== undefined ? h.cy : (h.y1 + h.y2) / 2);

            if (h.type === 'rect') {
                // Rectangle hole - CW winding
                // Coord transformation with X/Y Inversion
                const rawX1 = cx - h.x1;
                const rawX2 = cx - h.x2;
                const hx1 = Math.min(rawX1, rawX2);
                const hx2 = Math.max(rawX1, rawX2);
                const rawY1 = cy - h.y1;
                const rawY2 = cy - h.y2;
                const hy1 = Math.min(rawY1, rawY2);
                const hy2 = Math.max(rawY1, rawY2);

                // CW: Top-Left -> Top-Right -> Bottom-Right -> Bottom-Left -> Top-Left ??
                // Standard Grid Y is UP.
                // Screen Y is Down.

                // In Three.js (standard cartesian):
                // (hx1, hy2) Top-Left
                // (hx2, hy2) Top-Right
                // (hx2, hy1) Bottom-Right
                // (hx1, hy1) Bottom-Left

                // Hole must be CW (Chirality preserved)
                // Top-Left -> Top-Right -> Bottom-Right -> Bottom-Left
                path.moveTo(hx1, hy2);
                path.lineTo(hx2, hy2);
                path.lineTo(hx2, hy1);
                path.lineTo(hx1, hy1);
                path.lineTo(hx1, hy2);

            } else {
                // Circle hole
                const subtype = h.subtype || 'full';
                let start = 0, end = Math.PI * 2;

                // Logic: Target Arc must be visually same, but drawn CW.
                // Half-Top: Visual Top Semicircle. 
                // CCW (Solid): 0 -> PI.
                // CW (Hole): PI -> 0.

                switch (subtype) {
                    case 'half-top': start = Math.PI; end = 0; break;
                    case 'half-bottom': start = 0; end = Math.PI; break; // Visual Bottom: 0 -> (-PI) or PI -> 2PI. CCW: PI->2PI. CW: 2PI->PI (0->PI CW goes thru bottom)
                    // Wait. Absarc CW: Start -> End.
                    // 0 -> PI CW: 0 -> Bottom -> PI. Correct.

                    case 'half-right': start = Math.PI / 2; end = -Math.PI / 2; break; // Right side. CCW: -PI/2 -> PI/2. CW: PI/2 -> -PI/2.
                    case 'half-left': start = -Math.PI / 2; end = Math.PI / 2; break; // Left side. CCW: PI/2 -> 3PI/2. CW: 3PI/2 -> PI/2.

                    case 'quarter-tr': start = Math.PI / 2; end = 0; break; // CCW: 0->PI/2. CW: PI/2->0.
                    case 'quarter-tl': start = Math.PI; end = Math.PI / 2; break; // CCW: PI/2->PI. CW: PI->PI/2.
                    case 'quarter-bl': start = 3 * Math.PI / 2; end = Math.PI; break; // CCW: PI->3PI/2. CW: 3PI/2->PI.
                    case 'quarter-br': start = 0; end = 3 * Math.PI / 2; break; // CCW: 3PI/2->2PI. CW: 2PI->3PI/2 (0 -> -PI/2).

                    default: start = 0; end = Math.PI * 2; break;
                }

                if (subtype !== 'full') {
                    path.moveTo(localCx, localCy);
                }
                // Hole CW (true)
                path.absarc(localCx, localCy, h.r, start, end, true);
                if (subtype !== 'full') {
                    path.lineTo(localCx, localCy);
                }
            }
            return path;
        }

        // Çarpılma ψ yalnız DOLU dikdörtgen için çözülmüştür; delik varsa çizilmez
        const warpSec = warpSection();
        const holesPresent = typeof holes !== 'undefined' && holes.length > 0;
        const warpOn = warpActive(warpSec) && !holesPresent;

        // Her dikdörtgen için
        // Her dikdörtgen için
        rectangles.forEach((r, index) => {
            const shape = new THREE.Shape();

            // X-Inversion
            const rawX1 = cx - r.x1;
            const rawX2 = cx - r.x2;
            const rx1 = Math.min(rawX1, rawX2);
            const rx2 = Math.max(rawX1, rawX2);

            // Y-Inversion
            const rawY1 = cy - r.y1;
            const rawY2 = cy - r.y2;
            const ry1 = Math.min(rawY1, rawY2); // Min Y (Bottom)
            const ry2 = Math.max(rawY1, rawY2); // Max Y (Top)

            // Solid must be CCW (Chirality preserved)
            // Bottom-Right -> Top-Right -> Top-Left -> Bottom-Left (CCW)
            // Çarpılma çizilirken kenarlara ara nokta konur: yanal yüzeyin uç
            // profili ψ ile eğrilir, dört köşeyle bu eğri düz çizgiye inerdi
            // (ince ağlı uç yüzeyiyle kenarda açıklık kalırdı).
            // Harita da bölünmüş kontur ister: bölünmemiş dikdörtgenin yanal
            // yüzeyi yalnız dört köşeden geçer, dördünde de τ = 0'dır
            const outlineSeg = (warpOn || stressColors) ? WARP_SEGMENTS : 1;
            const corners = [[rx2, ry1], [rx2, ry2], [rx1, ry2], [rx1, ry1]];
            shape.moveTo(corners[0][0], corners[0][1]);
            for (let e = 0; e < corners.length; e++) {
                const [ax, ay] = corners[e];
                const [bx, by] = corners[(e + 1) % corners.length];
                for (let i = 1; i <= outlineSeg; i++) {
                    shape.lineTo(ax + (bx - ax) * i / outlineSeg, ay + (by - ay) * i / outlineSeg);
                }
            }

            // Holes for Rectangle
            // Only add circle holes that actually intersect this rectangle
            if (typeof holes !== 'undefined') {
                holes.forEach(h => {
                    if (h.type !== 'rect' && circleIntersectsRect(h, r)) {
                        shape.holes.push(createHolePath(h));
                    }
                });
            }

            // Geometri oluştur
            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            // Renkler şekil değiştirmeden ÖNCE: konum taşınır, köşe sırası değil
            if (colorAt) applyStressColors(geometry, colorAt);
            // Burulma şekil değiştirmesi (dönme + dikdörtgende çarpılma)
            applyTorsionDeformation(geometry);

            // Çarpılmış uç yüzeyi ayrıca çizilecekse ExtrudeGeometry'nin kaba
            // kapağı gizlenir: kapak konturdan üretildiği için eyeri gösteremez.
            // ExtrudeGeometry kapakları 0, yanal yüzeyi 1 numaralı gruba koyar;
            // düzen beklenmedikse kapak olduğu gibi bırakılır.
            const sideMaterial = material.clone();
            let meshMaterial = sideMaterial;
            const ownCap = warpOn || stressColors;
            if (ownCap && geometry.groups.length === 2) {
                const capMaterial = material.clone();
                capMaterial.visible = false;
                meshMaterial = [capMaterial, sideMaterial];
            }

            // Mesh oluştur
            const mesh = new THREE.Mesh(geometry, meshMaterial);
            barGroup.add(mesh);

            // Çarpılmış uç kesitleri (yüzey + ağ çizgileri)
            if (warpOn) {
                addWarpFaces(barGroup, warpSec, material, edgesMaterial, colorAt);
            } else if (stressColors) {
                const cap = rectCapMesh(rx1, ry1, rx2, ry2);
                addStressCapFaces(barGroup, material, colorAt, cap.nodes, cap.quads);
            }

            // Kenarlar: şekil değiştirmiş (burulmuş ya da çarpılmış) gövdede
            // EdgesGeometry üçgen köşegenlerini kenar sandığından yalnızca
            // gövde hiç bozulmamışken kullanılır
            if ((showEdges || showWireframe) && !deformationActive() && !warpOn) {
                const edgesGeometry = new THREE.EdgesGeometry(geometry, 15);
                edgesGroup.add(new THREE.LineSegments(edgesGeometry, edgesMaterial.clone()));
            }

            // Enine kesit çizgileri (seçeneğe bağlı, momentten bağımsız)
            addTransverseRings(edgesGroup, shape, edgesMaterial.clone());

            // Burulma referans çizgileri yalnızca köşelerde (kenar ortalarındaki
            // çizgiler kaldırıldı; enine kesit çizgileri zaten yüzeyi tarıyor)
            addTwistReferenceLines(barGroup, [
                { x: rx1, y: ry1 }, { x: rx2, y: ry1 }, { x: rx2, y: ry2 }, { x: rx1, y: ry2 }
            ], colors.edges);
        });

        // Daireler (dolu daire / halka) — malzeme renkleriyle
        if (hasCircles) {
            circles.forEach((c, ci) => {
                const shape = new THREE.Shape();
                // X & Y Inversion
                const localCx = cx - c.cx;
                const localCy = cy - c.cy;
                const r = c.r;

                // Dış çember (dolu, CCW)
                shape.moveTo(localCx + r, localCy);
                shape.absarc(localCx, localCy, r, 0, Math.PI * 2, false);

                // Halka: eş merkezli iç boşluk (CW yönlü delik yolu)
                const ri = (typeof c.ri === 'number') ? c.ri : 0;
                if (ri > 0 && ri < r) {
                    const holePath = new THREE.Path();
                    holePath.moveTo(localCx + ri, localCy);
                    holePath.absarc(localCx, localCy, ri, 0, Math.PI * 2, true);
                    shape.holes.push(holePath);
                }

                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                if (colorAt) applyStressColors(geometry, colorAt);
                // Dairesel kesit burulmada çarpılmaz: yalnızca kesit dönmesi
                applyTorsionDeformation(geometry);

                // Malzeme rengi (script.js paletiyle aynı). Harita açıkken gövde
                // rengi köşelerden gelir, yalnız kenar rengi malzemeden alınır.
                let meshMaterial = material.clone();
                const edgeMaterial = edgesMaterial.clone();
                if (typeof window.getMaterialColor === 'function') {
                    const idx = (typeof c.colorIdx === 'number') ? c.colorIdx : ci;
                    const matCol = window.getMaterialColor(idx);
                    if (!stressColors) meshMaterial.color = new THREE.Color(matCol.fill);
                    edgeMaterial.color = new THREE.Color(matCol.stroke);
                }

                if (stressColors && geometry.groups.length === 2) {
                    // Kapak konturdan üçgenlenir: bütün köşeler aynı yarıçapta
                    // olduğundan kesit içindeki değişimi gösteremez → gizlenir
                    const capMaterial = meshMaterial.clone();
                    capMaterial.visible = false;
                    meshMaterial = [capMaterial, meshMaterial];   // [kapak, yanal yüzey]
                    const cap = circleCapMesh(localCx, localCy, ri > 0 && ri < r ? ri : 0, r);
                    addStressCapFaces(barGroup, material, colorAt, cap.nodes, cap.quads);
                }

                const mesh = new THREE.Mesh(geometry, meshMaterial);
                barGroup.add(mesh);

                // Kenarlar yalnızca şekil değiştirme yokken (bkz. dikdörtgen dalı)
                if ((showEdges || showWireframe) && !deformationActive()) {
                    const edgesGeometry = new THREE.EdgesGeometry(geometry, 15);
                    edgesGroup.add(new THREE.LineSegments(edgesGeometry, edgeMaterial));
                }

                // Enine kesit çizgileri (seçeneğe bağlı, momentten bağımsız)
                addTransverseRings(edgesGroup, shape, edgeMaterial);

                // Burulma referans çizgileri yalnızca en dıştaki (görünen) yüzeye
                const isOutermost = circles.every(o => o.r <= c.r);
                if (isOutermost) {
                    const pts = [];
                    for (let a = 0; a < 8; a++) {
                        const ang = a * Math.PI / 4;
                        pts.push({ x: localCx + r * Math.cos(ang), y: localCy + r * Math.sin(ang) });
                    }
                    const strokeCol = (typeof window.getMaterialColor === 'function')
                        ? window.getMaterialColor((typeof c.colorIdx === 'number') ? c.colorIdx : ci).stroke
                        : colors.edges;
                    addTwistReferenceLines(barGroup, pts, strokeCol);
                }
            });
        }

    }

    // Bounding box hesapla ve merkeze al
    const box = new THREE.Box3().setFromObject(barGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Grupları merkeze al ve döndür
    barGroup.position.set(-center.x, -center.y, -center.z);
    edgesGroup.position.set(-center.x, -center.y, -center.z);

    // Update axes helper position to centroid at front face
    // Bar is centered at (0,0,0), so local (0,0) centroid at front face (Z=barLength)
    // is now at (-center.x, -center.y, barLength - center.z)
    if (axesHelper) {
        // Enkesit düzleminden 0.5 birim (mm) öne al (çakışmayı önlemek için)
        axesHelper.position.set(-center.x, -center.y, barLength - center.z + 0.5);

        // Uç kesit ne kadar döndüyse eksen takımı da o kadar döner. Bağıntı
        // çizilen şekil değiştirmeyle AYNI olmalı (bkz. applyTorsionDeformation):
        // φ(z) = k·θ′·z, uçta z = barLength.
        const endTwist = deformationActive()
            ? getDeformScale() * torsionTwistRate() * barLength
            : 0;
        axesHelper.rotation.z = Math.PI + endTwist;

        if (refAxesHelper) {
            refAxesHelper.position.copy(axesHelper.position);
            // Dönme yokken iki takım birebir üst üste biner (aynı çizgi, aynı
            // derinlik); gri takım yalnız görünür bir burulma varken çizilir.
            refAxesHelper.visible = Math.abs(endTwist) > AXES_TWIST_EPS;
        }
    }

    // Wrapper gruplar oluştur (döndürme yok - çubuk mavi/Z ekseninde uzanır)
    const barWrapper = new THREE.Group();
    barWrapper.add(barGroup);
    // Rotasyon kaldırıldı - çubuk artık Z (mavi) ekseni boyunca uzanır
    scene.add(barWrapper);
    barGroup = barWrapper;

    if (showEdges || showWireframe) {
        const edgesWrapper = new THREE.Group();
        edgesWrapper.add(edgesGroup);
        // Rotasyon kaldırıldı
        scene.add(edgesWrapper);
        edgesGroup = edgesWrapper;
    }

    // Kamerayı yalnızca geometri değiştiyse yerleştir; moment değişiminde
    // görüntü olduğu gibi kalır (bkz. barGeometryKey)
    const geomKey = barGeometryKey();
    if (geomKey !== lastBarGeometryKey) {
        lastBarGeometryKey = geomKey;
        autoFitCamera();
    }
}

// === KAMERAYI OTOMATİK AYARLA ===
// Sahnede görünen her şeyin (çubuk, kenar çizgileri, uç eksen takımları) sınır
// kutusu. Eksen takımı uç kesitin ötesine AXES_LENGTH kadar taştığı için
// "tümü" yalnız çubuk değildir.
function getModelBounds() {
    const box = new THREE.Box3();
    [barGroup, edgesGroup, axesHelper, refAxesHelper].forEach(obj => {
        if (obj && obj.visible !== false && obj.parent) box.union(new THREE.Box3().setFromObject(obj));
    });
    return box.isEmpty() ? null : box;
}

// Sığdırma uzaklığı: kutunun sekiz köşesi kamera eksenlerine izdüşürülür ve her
// köşe için görüş piramidinin içinde kalmayı sağlayan en küçük uzaklık aranır.
// En büyük kenarı (maxDim) tek başına kullanan kestirim üç yerde bozuluyordu:
// kısa çubukta kamera kutunun içine giriyor, çubuk eksenine bakarken (SAĞ/SOL)
// kesit noktaya iniyor, dar pencerede (aspect < 1) model taşıyordu.
function getAutoFitDistance(box, theta = cameraTheta, phi = cameraPhi) {
    if (!camera) return 500;
    const b = box || getModelBounds();
    if (!b) return 500;

    const center = b.getCenter(new THREE.Vector3());

    // Kamera çerçevesi: e = hedeften kameraya birim vektör (bkz. updateCameraPosition)
    const e = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
    ).normalize();
    const up = new THREE.Vector3(0, phi > Math.PI ? -1 : 1, 0);
    let right = new THREE.Vector3().crossVectors(up, e);
    // Kutupta bakış yönü up ile çakışır; ekran eksenleri yalnız θ'dan türetilir
    if (right.lengthSq() < 1e-8) right.set(-Math.sin(theta), 0, Math.cos(theta));
    right.normalize();
    const screenUp = new THREE.Vector3().crossVectors(e, right).normalize();

    // Pay görüş açısından kısılır, uzaklığa çarpılmaz: uzaklığı büyütmek derin
    // bir kutunun yalnız yakın yüzünü orantısız geri iter (çubuğa ekseni boyunca
    // bakılırken kesit ekranın ancak yarısını dolduruyordu).
    const tanV = Math.tan(camera.fov * Math.PI / 360) / FIT_MARGIN;
    const tanH = tanV * camera.aspect;

    // Köşe kameradan D − q·e derinliğinde görünür; |v| ≤ tanV·derinlik koşulu
    // her köşe için bir alt sınır verir, en büyüğü aranan uzaklıktır.
    const corner = new THREE.Vector3();
    let dist = 0;
    for (let i = 0; i < 8; i++) {
        corner.set(
            (i & 1 ? b.max.x : b.min.x) - center.x,
            (i & 2 ? b.max.y : b.min.y) - center.y,
            (i & 4 ? b.max.z : b.min.z) - center.z
        );
        const depthOffset = corner.dot(e);
        const need = Math.max(
            Math.abs(corner.dot(screenUp)) / tanV,
            Math.abs(corner.dot(right)) / tanH
        );
        dist = Math.max(dist, need + depthOffset);
    }

    return dist;
}

// Sığdırma yalnız uzaklığı değil kaydırmayı da sıfırlar: kullanıcı modeli
// kaydırdıktan sonra bakış noktası modelin dışında kalıyor, uzaklık düzelse
// bile model ekranın kenarında (ya da dışında) duruyordu.
function autoFitCamera(animate = true, theta = cameraTheta, phi = cameraPhi) {
    const box = getModelBounds();
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const fitDist = getAutoFitDistance(box, theta, phi);
    maxCameraDistance = Math.max(10000, fitDist * 1.5);
    const targetDist = clampCameraDistance(fitDist);

    // Uzak düzlem modelin arkasında kalırsa çubuk kırpılır (uzun çubukta
    // sığdırma uzaklığı sabit far = 10000'i aşabiliyor).
    if (box) {
        const radius = box.getSize(new THREE.Vector3()).length() / 2;
        const far = Math.max(10000, (targetDist + radius) * 1.5);
        if (camera && camera.far !== far) {
            camera.far = far;
            camera.updateProjectionMatrix();
        }
    }

    if (animate) {
        animateCameraTo(theta, phi, targetDist, center);
    } else {
        isAnimating = false;   // süren animasyon aksi halde bu değerleri geri yazar
        cameraTheta = theta; cameraPhi = phi;
        targetX = center.x; targetY = center.y; targetZ = center.z;
        cameraDistance = targetDist;
        updateCameraPosition();
    }
}

// === ANİMASYON DÖNGÜSÜ ===
function animate() {
    if (!isInitialized) return;

    requestAnimationFrame(animate);

    if (renderer && scene && camera) {
        // Animasyon mantığı
        if (isAnimating) {
            const now = performance.now();
            const elapsed = now - animStartTime;
            let progress = Math.min(elapsed / ANIM_DURATION, 1);

            // Easing: easeOutCubic
            const t = 1 - Math.pow(1 - progress, 3);

            cameraTheta = animStart.theta + (animTarget.theta - animStart.theta) * t;
            cameraPhi = animStart.phi + (animTarget.phi - animStart.phi) * t;
            cameraDistance = animStart.dist + (animTarget.dist - animStart.dist) * t;
            targetX = animStart.tx + (animTarget.tx - animStart.tx) * t;
            targetY = animStart.ty + (animTarget.ty - animStart.ty) * t;
            targetZ = animStart.tz + (animTarget.tz - animStart.tz) * t;

            updateCameraPosition();

            if (progress >= 1) {
                isAnimating = false;
            }
        }

        renderer.render(scene, camera);
    }
}

// === KAMERA ANİMASYONU ===
// targetPoint verilmezse mevcut bakış noktası korunur (yalnız açı/uzaklık animasyonu).
function animateCameraTo(targetTheta, targetPhi, targetDist, targetPoint) {
    isAnimating = true;
    animStartTime = performance.now();

    // Açılar için en kısa yolu bul
    // Mevcut açıları normalize et (0-2PI)
    let currentTheta = cameraTheta % (2 * Math.PI);
    if (currentTheta < 0) currentTheta += 2 * Math.PI;

    let endTheta = targetTheta % (2 * Math.PI);
    if (endTheta < 0) endTheta += 2 * Math.PI;

    // Farkı bul
    let diffTheta = endTheta - currentTheta;
    // En kısa yol kontrolü
    if (diffTheta > Math.PI) diffTheta -= 2 * Math.PI;
    if (diffTheta < -Math.PI) diffTheta += 2 * Math.PI;

    animStart = {
        theta: cameraTheta,
        phi: cameraPhi,
        dist: cameraDistance,
        tx: targetX, ty: targetY, tz: targetZ
    };

    animTarget = {
        theta: cameraTheta + diffTheta,
        phi: targetPhi,
        dist: targetDist,
        tx: targetPoint ? targetPoint.x : targetX,
        ty: targetPoint ? targetPoint.y : targetY,
        tz: targetPoint ? targetPoint.z : targetZ
    };
}

// === GÖRÜNÜMÜ SIFIRLA ===
function reset3DView() {
    // Başlangıç görünüşü: izometrik açılar + o açılara göre sığdırma.
    // Uzaklık eski halinde mevcut açıyla hesaplanıyordu; sığdırma artık bakış
    // yönüne bağlı olduğu için hedef açılar verilmek zorunda.
    autoFitCamera(true, ISO_THETA, ISO_PHI);
}

// === 3B PICTURE-IN-PICTURE (KÜÇÜK ÖNİZLEME) ===
// script.js model yüklenince veya boş kesite ilk eleman eklenince bunu çağırır.
// AYNI panel-3d/canvas3D kullanılır — yalnız CSS ile konum/boyut değişir, ikinci
// bir WebGL bağlamı açılmaz. toggle3DView() panel-3d'ye satır içi display stili
// yazdığından (aşağıda), önce o stil temizlenmeli — yoksa .panel-3d-pip'in
// display:flex kuralı devreye giremez.
function show3DPip() {
    const panel3D = document.getElementById('panel-3d');
    if (!panel3D || document.body.classList.contains('view-3d-active')) return;
    panel3D.style.removeProperty('display');
    panel3D.classList.add('panel-3d-pip');

    // Küçük kutunun boyutu ve EN-BOY ORANI tam görünümünkinden çok farklıdır.
    // `update3DBar()` kamerayı yalnız GEOMETRİ değişince yerleştirir (bkz.
    // `barGeometryKey`), en-boy oranı değişimini izlemez: tam görünümden
    // gelindiğinde kamera oradaki uzaklıkta kalıyor ve çubuk küçük kutuya
    // sığmıyordu. Bu, PiP→tam yönündeki `wasPip` sığdırmasının simetriğidir.
    // Düzen değişimi animasyonsuz oturmalı (animate = false).
    const yerlestir = () => {
        if (!isInitialized) init3D();
        onResize3D();
        update3DBar();
        autoFitCamera(false);
    };
    // Sahne hazırsa SENKRON: ertelenirse WebGL çizim tamponu bir süre bayat kalır
    // ve CSS onu küçük kutuya esneterek bozuk bir kare boyar (2B tarafındaki
    // `sync2DLayout` ile aynı neden).
    if (isInitialized) yerlestir();
    else setTimeout(yerlestir, 50);
}

function hide3DPip() {
    const panel3D = document.getElementById('panel-3d');
    if (panel3D) panel3D.classList.remove('panel-3d-pip');
}

// 3B açılınca 2B panel yarı genişliğe düşer ve fitToScreen() o dar alana göre
// yeniden hesaplanır; kapanınca panel tam genişliğe dönse de hiçbir şey pan/zoom'u
// geri yüklemiyordu, görünüm "yarım panele sığdırılmış" hâlde kalıyordu. Açılmadan
// hemen önceki değerleri burada saklayıp kapanışta geri yüklüyoruz.
let saved2DViewState = null;

// PiP↔tam görünüm arası HIZLI ardışık geçişte (örn. Normal Görünüm'e basılıp
// 3B kurulumu bitmeden Küçük Önizleme'ye basılırsa) önceki çağrının gecikmeli
// setTimeout'u hâlâ bekliyor olabilir; her çağrı bir öncekini iptal eder.
let pendingInit3DTimeout = null;

// Düzen değiştikten SONRA, tarayıcı henüz boyamadan tuvali SENKRON boyutlandırır.
// setTimeout'a ertelenirse tuval bitmap'i ~50 ms (≈3 kare) bayat kalır ve o süre
// boyunca YANLIŞ bir kare boyanır: tuvalin CSS boyutu yoktur (bkz. style.css
// `canvas#mainCanvas`), genişliği panele esner ama YÜKSEKLİĞİ BITMAP'İN en-boy
// oranından türetilir. Panel genişlerken tuval 890×1465 olup çizimi ~2× büyütüp
// aşağı kaydırıyor, daralırken 466×402 olup yukarı sıkıştırıyordu — çizim bir an
// köşede/dev görünüp sonra yerine oturuyordu. getBoundingClientRect() düzeni
// zorla hesaplattığı için yeni boyut aynı tick içinde okunabilir.
//
// Bu iş toggle3DView'in SONUNDA yapılmalıdır: script.js'in kendi 'change'
// dinleyicisi ÖNCE çalışıp sınıfları değiştirir, panelin display'ini ise burası
// yazar — erken ölçülürse kapanışta panel-3d hâlâ görünür olduğundan genişlik
// yanlış çıkar.
function sync2DLayout(refit) {
    if (typeof resizeCanvas === 'function') resizeCanvas();
    if (refit && typeof fitToScreen === 'function') fitToScreen();
}

// === 3D GÖRÜNÜM TOGGLE ===
function toggle3DView(enabled) {
    const panel3D = document.getElementById('panel-3d');
    const section3DSettings = document.getElementById('section3DSettings');
    const wasPip = panel3D.classList.contains('panel-3d-pip');
    panel3D.classList.remove('panel-3d-pip');   // PiP ve tam görünüm birlikte olamaz

    if (pendingInit3DTimeout) { clearTimeout(pendingInit3DTimeout); pendingInit3DTimeout = null; }

    if (enabled) {
        document.body.classList.add('view-3d-active');
        panel3D.style.display = 'flex';
        section3DSettings.style.display = 'block';

        if (typeof viewState !== 'undefined' && !saved2DViewState) {
            saved2DViewState = { zoom: viewState.zoom, panX: viewState.panX, panY: viewState.panY };
        }

        // Panel daraldı: tuvali hemen küçült ve kesiti yeni genişliğe sığdır
        sync2DLayout(true);

        // İlk kez başlat
        if (!isInitialized) {
            pendingInit3DTimeout = setTimeout(() => {
                pendingInit3DTimeout = null;
                init3D();
                update3DBar();
            }, 150);
        } else {
            onResize3D();
            update3DBar();
            // PiP'in küçük kutusundan (çok farklı en-boy oranı) geliniyorsa kamera
            // o dar kutuya göre sığdırılmış kalır: update3DBar() yalnız GEOMETRİ
            // değişince yeniden sığdırır (bkz. barGeometryKey), en-boy oranı
            // değişimini izlemez — burada açıkça tetiklemek gerekiyor.
            if (wasPip) autoFitCamera(false);
        }
    } else {
        document.body.classList.remove('view-3d-active');
        panel3D.style.display = 'none';
        section3DSettings.style.display = 'none';

        // viewState boyutlandırmadan ÖNCE geri yüklenir: resizeCanvas() kendi
        // içinde draw() çağırır, geri yükleme sonraya kalsaydı o çizim eski
        // (yarım panele sığdırılmış) değerlerle yapılırdı. fitToScreen() ile
        // tekrar sığdırmak yerine geri yükleniyor: kullanıcının kendi görünümü
        // bir düzen değişikliğiyle kaybolmamalı.
        if (saved2DViewState && typeof viewState !== 'undefined') {
            viewState.zoom = saved2DViewState.zoom;
            viewState.panX = saved2DViewState.panX;
            viewState.panY = saved2DViewState.panY;
            saved2DViewState = null;
        }

        // Panel genişledi: tuvali hemen büyüt (sığdırma yok, görünüm korunuyor)
        sync2DLayout(false);
    }
}

// === EVENT LİSTENERLAR ===
document.addEventListener('DOMContentLoaded', () => {
    // 3D toggle
    const cb3DView = document.getElementById('cb3DView');
    if (cb3DView) {
        cb3DView.addEventListener('change', () => {
            toggle3DView(cb3DView.checked);
        });
    }

    // Çubuk boyu alanı script.js'te dinlenir (bkz. applyBarLengthInput):
    // aynı değer sağ paneldeki bağıl dönme açısını da besler.

    // Wireframe toggle (tel kafes - köşegen çizgisiz)
    const cb3DWireframe = document.getElementById('cb3DWireframe');
    if (cb3DWireframe) {
        cb3DWireframe.addEventListener('change', () => {
            showWireframe = cb3DWireframe.checked;
            update3DBar();  // Tam yeniden çiz (edges-only yaklaşımı için)
        });
    }

    // Edges toggle
    const cb3DEdges = document.getElementById('cb3DEdges');
    if (cb3DEdges) {
        cb3DEdges.addEventListener('change', () => {
            showEdges = cb3DEdges.checked;
            update3DBar();
        });
    }

    // Enine kesit çizgileri
    const cb3DTransverse = document.getElementById('cb3DTransverse');
    if (cb3DTransverse) {
        showTransverse = cb3DTransverse.checked;
        cb3DTransverse.addEventListener('change', () => {
            showTransverse = cb3DTransverse.checked;
            update3DBar();
        });
    }

    // Şekil değiştirme (burulmuş model)
    const cb3DDeformed = document.getElementById('cb3DDeformed');
    if (cb3DDeformed) {
        showDeformed = cb3DDeformed.checked;
        cb3DDeformed.addEventListener('change', () => {
            showDeformed = cb3DDeformed.checked;
            update3DBar();
        });
    }

    // Çarpılma gösterimi (dairesel/halka kesitte ψ ≡ 0 olduğundan etkisizdir)
    const cb3DWarp = document.getElementById('cb3DWarp');
    if (cb3DWarp) {
        showWarp = cb3DWarp.checked;
        cb3DWarp.addEventListener('change', () => {
            showWarp = cb3DWarp.checked;
            update3DBar();
        });
    }

    // Çarpılma büyütme katsayısı (0 = otomatik); burulmanınkinden ayrıdır
    const tbWarpScale = document.getElementById('tbWarpScale');
    if (tbWarpScale) {
        const applyWarpScale = () => {
            const v = parseFloat(tbWarpScale.value);
            warpScale = (isFinite(v) && v > 0) ? v : 0;
            update3DBar();
        };
        tbWarpScale.addEventListener('change', applyWarpScale);
        tbWarpScale.addEventListener('input', applyWarpScale);
    }

    // Şekil değiştirme büyütme katsayısı (0 = otomatik)
    const tbDeformScale = document.getElementById('tbDeformScale');
    if (tbDeformScale) {
        const applyScale = () => {
            const v = parseFloat(tbDeformScale.value);
            deformScale = (isFinite(v) && v > 0) ? v : 0;
            update3DBar();
        };
        tbDeformScale.addEventListener('change', applyScale);
        tbDeformScale.addEventListener('input', applyScale);
    }

    // Reset view button
    const btn3DReset = document.getElementById('btn3DReset');
    if (btn3DReset) {
        btn3DReset.addEventListener('click', reset3DView);
    }

    const btnReset3DView = document.getElementById('btnReset3DView');
    if (btnReset3DView) {
        btnReset3DView.addEventListener('click', reset3DView);
    }

    // === ViewCube yön düğmeleri (ÖN/ARKA/SOL/SAĞ/ÜST/3B) ===
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => setView(btn.getAttribute('data-view')));
    });

    // Zoom In
    const btn3DZoomIn = document.getElementById('btn3DZoomIn');
    if (btn3DZoomIn) {
        btn3DZoomIn.addEventListener('click', () => {
            // %20 yakınlaş
            const targetDist = clampCameraDistance(cameraDistance * 0.8);
            animateCameraTo(cameraTheta, cameraPhi, targetDist);
        });
    }

    // Zoom Out
    const btn3DZoomOut = document.getElementById('btn3DZoomOut');
    if (btn3DZoomOut) {
        btn3DZoomOut.addEventListener('click', () => {
            // %25 uzaklaş
            const targetDist = clampCameraDistance(cameraDistance * 1.25);
            animateCameraTo(cameraTheta, cameraPhi, targetDist);
        });
    }

    // Fit All
    const btn3DFitAll = document.getElementById('btn3DFitAll');
    if (btn3DFitAll) {
        btn3DFitAll.addEventListener('click', () => autoFitCamera(true));
    }

    // Full Screen Logic
    const toggleFullScreen3D = () => {
        const panel = document.getElementById('panel-3d');
        if (panel) {
            panel.classList.toggle('fullscreen-active');
            onResize3D();
            
            // Animasyonlu geçişi bekle ve sonra fit et
            setTimeout(() => {
                onResize3D();
                if (typeof autoFitCamera === 'function') {
                    autoFitCamera(true);
                }
            }, 300); 
        }
    };

    const btn3DFullScreen = document.getElementById('btn3DFullScreen');
    if (btn3DFullScreen) {
        btn3DFullScreen.addEventListener('click', toggleFullScreen3D);
    }
    
    // Double click on canvas toggles fullscreen
    const canvas3D = document.getElementById('canvas3D');
    if (canvas3D) {
        canvas3D.addEventListener('dblclick', toggleFullScreen3D);
    }

    // PiP tuşları: kapatma yalnız küçük paneli gizler; normal görünüm tuşu tam
    // boyutlu 3B görünümü açar (checkbox'ı işaretleyip mevcut değişim olayını
    // tetikler — script.js'teki dinleyiciyle aynı yolu izlesin diye).
    const btnPip3DClose = document.getElementById('btnPip3DClose');
    if (btnPip3DClose) {
        btnPip3DClose.addEventListener('click', () => hide3DPip());
    }
    const btnPip3DRestore = document.getElementById('btnPip3DRestore');
    if (btnPip3DRestore) {
        btnPip3DRestore.addEventListener('click', () => {
            // panel-3d-pip sınıfı BURADA kaldırılmaz: toggle3DView() kendi içinde
            // kaldırıyor ve bunu "PiP'ten mi geliniyor" (wasPip) sinyali olarak
            // kullanıp kamerayı yeni en-boy oranına göre yeniden sığdırıyor —
            // önceden kaldırılırsa o sinyal kaybolur, çubuk ekrana sığmaz kalırdı.
            const cb = document.getElementById('cb3DView');
            if (cb && !cb.checked) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            }
        });
    }

    // Tersi yön: tam görünümdeyken küçük önizlemeye dön. Checkbox'ı kapatıp aynı
    // 'change' olayını tetikler (toggle3DView(false) panel-3d-pip'i zaten temizler),
    // sonra show3DPip() küçük paneli açar — btnPip3DRestore ile simetrik.
    const btnEnterPip = document.getElementById('btnEnterPip');
    if (btnEnterPip) {
        btnEnterPip.addEventListener('click', () => {
            const cb = document.getElementById('cb3DView');
            if (cb && cb.checked) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
            show3DPip();
        });
    }

    // Opacity Control
    const tbOpacity = document.getElementById('tbOpacity');
    const lblOpacityVal = document.getElementById('lblOpacityVal');
    if (tbOpacity && lblOpacityVal) {
        tbOpacity.addEventListener('input', () => {
            barOpacity = parseInt(tbOpacity.value) / 100;
            lblOpacityVal.textContent = `${tbOpacity.value}%`;

            // Eğer mesh varsa hemen güncelle
            if (barGroup) {
                barGroup.traverse((child) => {
                    if (child.isMesh && child.material) {
                        // Wireframe modundaysa etkileme, değilse opaklığı güncelle
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(m => { m.opacity = showWireframe ? 0 : barOpacity; });
                    }
                });
            }
        });
    }

});

// === GÖRÜNÜM AYARLARI ===
function setView(viewName) {
    if (viewName === '3b') {
        animateCameraTo(ISO_THETA, ISO_PHI, cameraDistance);
        return;
    }
    const dir = VIEW_DIRECTIONS[viewName];
    if (dir) setViewDirection({ x: dir[0], y: dir[1], z: dir[2] });
}

// === GLOBAL FONKSİYON: script.js'den çağrılacak ===
// Kesit değiştiğinde 3D'yi güncelle. Tam görünüm KAPALIYKEN de PiP paneli açık
// olabileceğinden (bkz. show3DPip), yalnız checkbox değil ikisi de sınanır —
// yoksa PiP'teki model kesit değiştikçe güncellenmezdi.
window.update3DVisualization = function () {
    const panel3D = document.getElementById('panel-3d');
    const active = document.getElementById('cb3DView')?.checked || panel3D?.classList.contains('panel-3d-pip');
    if (isInitialized && active) {
        update3DBar();
    }
};


