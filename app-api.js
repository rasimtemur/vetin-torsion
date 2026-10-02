// --- APP-API.JS : 2B UYGULAMA ↔ 3B GÖRÜNÜM SÖZLEŞMESİ ---
//
// script3d.js, uygulamadan okuduğu HER ŞEYİ bu nesneden alır; genel kapsamdaki
// adlara doğrudan dokunmaz. Eskiden 3B modül script.js'in ~30 adına (calc,
// circles, barLength, fitToScreen, …) kendi başına uzanıyordu: sözleşme hiçbir
// yerde yazılı değildi ve tek güvencesi yükleme sırasıydı — iki dosyanın aynı
// olayı ayrı ayrı dinlediği cb3DView hatası bu yapının ürünüydü. Bir adın 3B'de
// kullanılıp kullanılmadığı artık yalnız buraya bakarak bilinir.
//
// Durum alanları GETTER'dır: circles/rectangles/viewState dosya açılınca yeniden
// atanır, değer kopyalanmış olsaydı 3B eski diziyi görmeye devam ederdi.
//
// Ters yön (2B → 3B) script3d.js sonundaki window.View3D'dir; script.js onu
// call3D() üzerinden çağırır.
//
// Dış kütüphaneler bu sözleşmenin dışındadır: THREE (vendor/three.min.js) ve
// t() (translations.js) her iki taraf için ortak genel adlardır.
//
// Yükleme sırası: calc.js → script.js → draw2d.js → io.js → app-api.js → script3d.js

const TorsionApp = Object.freeze({
    // --- Durum (salt okunur başvurular; nesnelerin kendisi değiştirilebilir) ---
    get calc() { return calc; },                 // son hesap sonucu (calc.js → emptyResult)
    get circles() { return circles; },
    get rectangles() { return rectangles; },
    get viewState() { return viewState; },       // 3B açılıp kapanırken 2B görünümü korunur
    get barLength() { return barLength; },       // mm — bağıl dönmenin de girdisi
    get stressGamma() { return stressGamma; },   // renk eğrisi (3B DOM gradyanı)
    get STRESS_COLORMAP() { return STRESS_COLORMAP; },

    // --- Hesap (calc.js, saf) ---
    rectWarpPsi,

    // --- Kesit ve gerilme alanı ---
    sectionIsEmpty,
    sectionShearMagAt,
    stressFieldRange,
    stressFieldFlat,
    stressColorPos,
    stressColorRGB,
    getMaterialColor,

    // --- Çubuk boyu ve açı gösterimi ---
    syncBarLength,
    formatAngle,
    angleFactor,
    angleUnitLabel,

    // --- 2B düzen (3B açılıp kapanınca tuval yeniden boyutlanır) ---
    resizeCanvas,
    fitToScreen
});
