// --- SCRIPT3D.JS : 3D VİZUALİZASYON ---

// === THREE.JS DEĞİŞKENLERİ ===
let scene, camera, renderer;
let barMesh, edgesMesh;
let axesHelper = null;
let ambientLight, directionalLight, directionalLight2;
let isInitialized = false;

// Kamera kontrolleri
let cameraDistance = 500;
// Kullanıcı tanımlı başlangıç açıları:
let cameraTheta = 112 * Math.PI / 180;   // Yatay açı (112 derece)
let cameraPhi = 80 * Math.PI / 180;       // Dikey açı (80 derece)
let targetX = 0, targetY = 0, targetZ = 0;

// Mouse kontrolü
// Mouse kontrolü
let isDragging3D = false;
let dragMode = 0; // 0: ROTATE (Sol), 1: PAN (Orta), 2: ZOOM (Sağ)
let previousMouseX = 0, previousMouseY = 0;
let startCameraDistance = 500; // Zoom için başlangıç mesafesi

// 3D ayarları
let barLength = 500;
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
    const byPos = new Map();
    const keys = new Array(count);
    for (let i = 0; i < count; i++) {
        const k = pos.getX(i).toFixed(3) + ',' + pos.getY(i).toFixed(3) + ',' + pos.getZ(i).toFixed(3);
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

// Kesiti burulmuş hâline taşır: her kesit ekseni etrafında φ = k·θ'·z kadar
// döner. Dikdörtgen kesitte ayrıca çarpılma vardır (w = k·θ'·ψ) — dairesel
// kesitte ψ ≡ 0 olduğundan kesitler düzlem kalır.
function applyTorsionDeformation(geometry, rectSize) {
    if (!showDeformed) return;
    const rate = torsionTwistRate();
    const k = getDeformScale();
    if (!rate || !k) return;

    const canWarp = rectSize && typeof rectWarpPsi === 'function';
    const pos = geometry.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const phi = k * rate * z;
        const c = Math.cos(phi), s = Math.sin(phi);
        const dz = canWarp ? k * rate * rectWarpPsi(x, y, rectSize.w, rectSize.h) : 0;
        pos.setXYZ(i, x * c - y * s, x * s + y * c, z + dz);
    }

    pos.needsUpdate = true;
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
function addTransverseRings(group, shape, rectSize, material) {
    if (!showTransverse || !shape) return;

    // Şekil değiştirme yoksa ikisi de sıfırdır → kesitler dönmeden dizilir
    const rate = deformationActive() ? torsionTwistRate() : 0;
    const k = deformationActive() ? getDeformScale() : 0;
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
                const dz = (rectSize && typeof rectWarpPsi === 'function')
                    ? k * rate * rectWarpPsi(p.x, p.y, rectSize.w, rectSize.h) : 0;
                return new THREE.Vector3(x * c - y * s, x * s + y * c, z + dz);
            });
            v.push(v[0].clone());   // kapalı kontur
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), material));
        });
    }
}

function addTwistReferenceLines(group, outlinePoints, rectSize, colorHex) {
    if (!deformationActive() || !outlinePoints.length) return;

    const rate = torsionTwistRate();
    const k = getDeformScale();
    const material = new THREE.LineBasicMaterial({ color: colorHex });

    outlinePoints.forEach(p => {
        // Yüzeyle çakışıp z-fighting yapmasın diye çok az dışarı alınır
        const px = p.x * 1.004, py = p.y * 1.004;
        const dz = (rectSize && typeof rectWarpPsi === 'function')
            ? k * rate * rectWarpPsi(p.x, p.y, rectSize.w, rectSize.h) : 0;

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

function updateDeformReadouts() {
    const rate = torsionTwistRate();
    const twistEl = document.getElementById('val3DTwist');
    if (twistEl) twistEl.textContent = (rate * barLength * 180 / Math.PI).toFixed(4);

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
}

// Animasyon değişkenleri
let isAnimating = false;
let animStartTime = 0;
const ANIM_DURATION = 800; // ms
let animStart = { theta: 0, phi: 0, dist: 0 };
let animTarget = { theta: 0, phi: 0, dist: 0 };

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

    // Eksen yardımcısı - Koordinat eksenleri (geometrik merkezde güncellenecek)
    axesHelper = new THREE.AxesHelper(50);
    
    // RENK DEĞİŞİMİ: Kırmızı -> Lacivert, Mavi (Lacivert) -> Kırmızı
    const colors = axesHelper.geometry.attributes.color;
    
    // X Ekseni (Kırmızı idi) -> Lacivert yap (Navy: 0, 0, 0.5)
    colors.setXYZ(0, 0, 0, 0.5);
    colors.setXYZ(1, 0, 0, 0.5);
    
    // Y Ekseni (Yeşil idi) -> Koyu Yeşil yap (0, 0.5, 0)
    colors.setXYZ(2, 0, 0.5, 0);
    colors.setXYZ(3, 0, 0.5, 0);
    
    // Z Ekseni (Mavi/Lacivert idi) -> Kırmızı yap (1, 0, 0)
    colors.setXYZ(4, 1, 0, 0);
    colors.setXYZ(5, 1, 0, 0);
    
    colors.needsUpdate = true;

    // Rotate 180 deg around Z to point X Left and Y Down
    axesHelper.rotation.z = Math.PI;
    axesHelper.position.set(0, 0, 0); // Will be updated in update3DBar
    scene.add(axesHelper);

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
            dir2Int: 0.4
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
            dir2Int: 0.35
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
            dir2Int: 0.3
        };
    }
}

window.update3DTheme = function() {
    if (!isInitialized || !scene) return;
    
    const colors = get3DColors();
    scene.background = new THREE.Color(colors.background);
    
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
    if (axesHelper) {
        const theme = document.documentElement.getAttribute('data-theme');
        const onDark = theme === 'dark' || theme === 'blueprint';
        const cols = axesHelper.geometry.attributes.color;
        if (onDark) {
            // X: Light Blue
            cols.setXYZ(0, 0.2, 0.5, 1.0); cols.setXYZ(1, 0.2, 0.5, 1.0);
            // Y: Light Green
            cols.setXYZ(2, 0.2, 1.0, 0.2); cols.setXYZ(3, 0.2, 1.0, 0.2);
            // Z: Light Red
            cols.setXYZ(4, 1.0, 0.3, 0.3); cols.setXYZ(5, 1.0, 0.3, 0.3);
        } else {
            // X: Navy
            cols.setXYZ(0, 0, 0, 0.5); cols.setXYZ(1, 0, 0, 0.5);
            // Y: Dark Green
            cols.setXYZ(2, 0, 0.5, 0); cols.setXYZ(3, 0, 0.5, 0);
            // Z: Red
            cols.setXYZ(4, 1, 0, 0); cols.setXYZ(5, 1, 0, 0);
        }
        cols.needsUpdate = true;
    }
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
            cameraDistance = Math.max(10, Math.min(10000, cameraDistance));
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
    cameraDistance = Math.max(10, Math.min(10000, cameraDistance));
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
        cameraDistance = Math.max(10, Math.min(10000, cameraDistance));

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

function update3DBar() {
    if (!scene || !isInitialized) return;

    // Eski mesh'leri kaldır
    if (barGroup) {
        scene.remove(barGroup);
        barGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
    if (edgesGroup) {
        scene.remove(edgesGroup);
        edgesGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }

    // Rectangles ve Circles kontrolü
    const hasRectangles = typeof rectangles !== 'undefined' && rectangles.length > 0;
    const hasCircles = typeof circles !== 'undefined' && circles.length > 0;

    if (!hasRectangles && !hasCircles) {
        return;
    }

    // Çubuk uzunluğunu hesapla: En büyük kesit boyutunun 10 katı
    // Rectangles bounding box bul
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

    // 10 katı kuralı
    const calculatedLength = Math.max(sectionWidth, sectionHeight) * 10;

    // Input'u güncelle (Kullanıcı henüz değiştirmediyse veya otomatik hesaplama isteniyorsa)
    // Şimdilik her çizimde güncelliyoruz çünkü geometri değişti
    barLength = calculatedLength;
    if (document.getElementById('tbBarLength')) {
        document.getElementById('tbBarLength').value = Math.round(barLength);
    }

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

    const material = new THREE.MeshPhongMaterial({
        color: colors.bar,
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
            shape.moveTo(rx2, ry1);
            shape.lineTo(rx2, ry2);
            shape.lineTo(rx1, ry2);
            shape.lineTo(rx1, ry1);
            shape.lineTo(rx2, ry1);

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
            // Burulma şekil değiştirmesi (dönme + dikdörtgende çarpılma)
            applyTorsionDeformation(geometry, {
                w: Math.abs(r.x2 - r.x1),
                h: Math.abs(r.y2 - r.y1)
            });

            // Mesh oluştur
            const mesh = new THREE.Mesh(geometry, material.clone());
            barGroup.add(mesh);

            const rw = Math.abs(r.x2 - r.x1), rh = Math.abs(r.y2 - r.y1);

            // Kenarlar: burulmuş gövdede EdgesGeometry üçgen köşegenlerini
            // gösterdiğinden yalnızca şekil değiştirme yokken kullanılır
            if ((showEdges || showWireframe) && !deformationActive()) {
                const edgesGeometry = new THREE.EdgesGeometry(geometry, 15);
                edgesGroup.add(new THREE.LineSegments(edgesGeometry, edgesMaterial.clone()));
            }

            // Enine kesit çizgileri (seçeneğe bağlı, momentten bağımsız)
            addTransverseRings(edgesGroup, shape, { w: rw, h: rh }, edgesMaterial.clone());

            // Burulma referans çizgileri yalnızca köşelerde (kenar ortalarındaki
            // çizgiler kaldırıldı; enine kesit çizgileri zaten yüzeyi tarıyor)
            addTwistReferenceLines(barGroup, [
                { x: rx1, y: ry1 }, { x: rx2, y: ry1 }, { x: rx2, y: ry2 }, { x: rx1, y: ry2 }
            ], { w: rw, h: rh }, colors.edges);
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
                // Dairesel kesit burulmada çarpılmaz: yalnızca kesit dönmesi
                applyTorsionDeformation(geometry, null);

                // Malzeme rengi (script.js paletiyle aynı)
                const meshMaterial = material.clone();
                const edgeMaterial = edgesMaterial.clone();
                if (typeof window.getMaterialColor === 'function') {
                    const idx = (typeof c.colorIdx === 'number') ? c.colorIdx : ci;
                    const matCol = window.getMaterialColor(idx);
                    meshMaterial.color = new THREE.Color(matCol.fill);
                    edgeMaterial.color = new THREE.Color(matCol.stroke);
                }

                const mesh = new THREE.Mesh(geometry, meshMaterial);
                barGroup.add(mesh);

                // Kenarlar yalnızca şekil değiştirme yokken (bkz. dikdörtgen dalı)
                if ((showEdges || showWireframe) && !deformationActive()) {
                    const edgesGeometry = new THREE.EdgesGeometry(geometry, 15);
                    edgesGroup.add(new THREE.LineSegments(edgesGeometry, edgeMaterial));
                }

                // Enine kesit çizgileri (seçeneğe bağlı, momentten bağımsız)
                addTransverseRings(edgesGroup, shape, null, edgeMaterial);

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
                    addTwistReferenceLines(barGroup, pts, null, strokeCol);
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
// === KAMERAYI OTOMATİK AYARLA (HESAPLA VE DÖNDÜR) ===
function getAutoFitDistance() {
    if (!barGroup || !camera) return 500;

    const box = new THREE.Box3().setFromObject(barGroup);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Bounding Sphere Radius approximation (safe for rotation)
    // Using max dimension is simple and safe enough
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // Calculate required distance based on FOV and Aspect Ratio
    const fov = camera.fov * (Math.PI / 180);
    const aspect = camera.aspect;

    // Distance to fit vertically
    const distVertical = maxDim / (2 * Math.tan(fov / 2));

    // Distance to fit horizontally
    const distHorizontal = maxDim / (2 * Math.tan(fov / 2) * aspect);

    // We need the larger distance to ensure fit in both dimensions
    const fitDist = Math.max(distVertical, distHorizontal);

    // User requested "two steps closer", reducing margins significantly.
    // Standard fit is 1.0. Previous was 1.2.
    // Two zoom-in steps (0.8 * 0.8) makes it approx 0.64 * 1.2 ~= 0.75.
    return fitDist * 0.75;
}

function autoFitCamera(animate = true) {
    const targetDist = getAutoFitDistance();

    if (animate) {
        animateCameraTo(cameraTheta, cameraPhi, targetDist);
    } else {
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

            updateCameraPosition();

            if (progress >= 1) {
                isAnimating = false;
            }
        }

        renderer.render(scene, camera);
    }
}

// === GÖRÜNÜMÜ SIFIRLA ===
// === KAMERA ANİMASYONU ===
function animateCameraTo(targetTheta, targetPhi, targetDist) {
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
        dist: cameraDistance
    };

    animTarget = {
        theta: cameraTheta + diffTheta,
        phi: targetPhi,
        dist: targetDist
    };
}

// === GÖRÜNÜMÜ SIFIRLA ===
function reset3DView() {
    const targetTheta = 112 * Math.PI / 180;
    const targetPhi = 80 * Math.PI / 180;
    
    // Obje merkezde ama görsel olarak sağda kaldığı için
    // Kamerayı biraz sağa (ekran koordinatı) kaydırarak objeyi sola alıyoruz.
    // 112 derece bakış açısı için deneme-yanılma ofsetler (Pozitif değer = Hedef sağa kayar = Obje sola kayar):
    targetX = 0; 
    targetY = 0; 
    targetZ = 0;

    // Auto fit distance hesapla
    const targetDist = getAutoFitDistance();

    animateCameraTo(targetTheta, targetPhi, targetDist);
}

// === 3D GÖRÜNÜM TOGGLE ===
function toggle3DView(enabled) {
    const panel3D = document.getElementById('panel-3d');
    const section3DSettings = document.getElementById('section3DSettings');

    if (enabled) {
        document.body.classList.add('view-3d-active');
        panel3D.style.display = 'flex';
        section3DSettings.style.display = 'block';

        // Layout değiştiğinde 2D canvas'ı yeniden boyutlandır ve sığdır
        setTimeout(() => {
            if (typeof resizeCanvas === 'function') {
                resizeCanvas();
            }
            if (typeof fitToScreen === 'function') {
                fitToScreen();
            }
        }, 100);

        // İlk kez başlat
        if (!isInitialized) {
            setTimeout(() => {
                init3D();
                update3DBar();
            }, 150);
        } else {
            onResize3D();
            update3DBar();
        }
    } else {
        document.body.classList.remove('view-3d-active');
        panel3D.style.display = 'none';
        section3DSettings.style.display = 'none';

        // Layout değiştiğinde 2D canvas'ı yeniden boyutlandır
        setTimeout(() => {
            if (typeof resizeCanvas === 'function') {
                resizeCanvas();
            }
        }, 100);
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

    // Bar uzunluğu değişimi
    const tbBarLength = document.getElementById('tbBarLength');
    if (tbBarLength) {
        tbBarLength.addEventListener('change', () => {
            barLength = parseFloat(tbBarLength.value) || 500;
            update3DBar();
        });
    }

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

    // === YENİ: AutoCAD-style Görünüm Kontrolleri ===

    // Üst Görünüm
    const btn3DTop = document.getElementById('btn3DTop');
    if (btn3DTop) {
        btn3DTop.addEventListener('click', () => {
            setView('top');
            updatePresetButtons('btn3DTop');
        });
    }

    // Ön Görünüm
    const btn3DFront = document.getElementById('btn3DFront');
    if (btn3DFront) {
        btn3DFront.addEventListener('click', () => {
            setView('front');
            updatePresetButtons('btn3DFront');
        });
    }

    // Yan Görünüm
    const btn3DSide = document.getElementById('btn3DSide');
    if (btn3DSide) {
        btn3DSide.addEventListener('click', () => {
            setView('side');
            updatePresetButtons('btn3DSide');
        });
    }

    // İzometrik Görünüm
    const btn3DISO = document.getElementById('btn3DISO');
    if (btn3DISO) {
        btn3DISO.addEventListener('click', () => {
            setView('iso');
            updatePresetButtons('btn3DISO');
        });
    }

    // Zoom In
    const btn3DZoomIn = document.getElementById('btn3DZoomIn');
    if (btn3DZoomIn) {
        btn3DZoomIn.addEventListener('click', () => {
            // %20 yakınlaş
            const targetDist = Math.max(10, cameraDistance * 0.8);
            animateCameraTo(cameraTheta, cameraPhi, targetDist);
        });
    }

    // Zoom Out
    const btn3DZoomOut = document.getElementById('btn3DZoomOut');
    if (btn3DZoomOut) {
        btn3DZoomOut.addEventListener('click', () => {
            // %25 uzaklaş
            const targetDist = Math.min(10000, cameraDistance * 1.25);
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
                        child.material.opacity = showWireframe ? 0 : barOpacity;
                    }
                });
            }
        });
    }

    // ViewCube clicks
    document.querySelectorAll('.viewcube-face').forEach(face => {
        face.addEventListener('click', () => {
            const view = face.getAttribute('data-view');
            setView(view);
        });
    });


});

// === GÖRÜNÜM AYARLARI ===
function setView(viewName) {
    let targetTheta, targetPhi;

    switch (viewName) {
        case 'top':
            targetTheta = 0;
            targetPhi = 0.01;  // Tam üstten (0 yapınca gimbal sorunu olabilir diye 0.01)
            break;
        case 'front':
            targetTheta = 0;
            targetPhi = Math.PI / 2;
            break;
        case 'side':
        case 'right':
            targetTheta = Math.PI / 2;
            targetPhi = Math.PI / 2;
            break;
        case 'iso':
        default:
            targetTheta = 112 * Math.PI / 180;
            targetPhi = 80 * Math.PI / 180;
            break;
    }

    // Mesafe aynı kalsın veya auto fit yapılabilir. 
    // Kullanıcı deneyimi için ISO'da auto fit, diğerlerinde mevcut zoom korunabilir veya hepsi auto fit.
    // AutoCAD genelde zoom'u korur ama burada fit yapmak daha iyi görünebilir. 
    // Şimdilik mevcut mesafeyi kullanalım, sadece açıyı değiştirelim.
    // İsteğe göre buraya getAutoFitDistance() eklenebilir.

    animateCameraTo(targetTheta, targetPhi, cameraDistance);
}

// Preset butonlarını güncelle
function updatePresetButtons(activeId) {
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

// === GLOBAL FONKSİYON: script.js'den çağrılacak ===
// Kesit değiştiğinde 3D'yi güncelle
window.update3DVisualization = function () {
    if (isInitialized && document.getElementById('cb3DView')?.checked) {
        update3DBar();
    }
};


