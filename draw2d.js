// --- DRAW2D.JS : 2B ÇİZİM (KESİT, ÖLÇÜLER, GERİLME HARİTASI VE DİYAGRAMLARI) ---
//
// Bütün çizim genel `ctx` üzerinden yapılır. SVG dışa aktarımı (io.js) ctx'i
// geçici olarak bir SVGContext ile değiştirip AYNI draw()'u çalıştırır; bu yüzden
// burada yalnız SVGContext'in de desteklediği çağrılar kullanılır (clip() yoktur,
// bkz. buildStressFieldTexture). Hesap sonucu `calc`tan okunur, hesap yapılmaz —
// gerilme değerleri calc.js'in saf sorgularından gelir.
//
// Yükleme sırası: calc.js → script.js → draw2d.js → io.js → script3d.js.
// script.js'teki durum (circles, rectangles, viewState, calc, ctx) burada okunur.

// === ÇİZİM SABİTLERİ ===

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

        // Renk alanı: kesit dolgusunun üstüne, ok diyagramının altına
        if (controls.cbStressMap && controls.cbStressMap.checked) {
            try { drawStressMap(); } catch (e) { console.error("drawStressMap error:", e); }
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

    // Renk ölçeği tuvalin kenarındadır, kesitten bağımsız — en üstte kalır
    if (shapesExist && controls.cbStressMap && controls.cbStressMap.checked) {
        try { drawStressLegend(); } catch (e) { console.error("drawStressLegend error:", e); }
    }

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

// === ENKESİT GERİLME HARİTASI (RENK ALANI) ===
// Kayma gerilmesi dağılımı, ok diyagramı yerine kesitin HER NOKTASINDAKİ
// büyüklüğü renkle veren bir alan olarak da gösterilebilir: en küçük gerilme
// mavi, en büyük kırmızı.
//
// Alan ekran değil GRID koordinatlarında bir doku (texture) olarak üretilir ve
// ekrana ölçeklenerek basılır; böylece kaydırma/yakınlaştırma yeniden hesap
// gerektirmez. Doku MOMENTTEN BAĞIMSIZDIR: τ ile τmak birlikte T ile orantılı
// olduğundan normalize alan değişmez, T yalnızca ölçek çubuğunun sayılarını
// değiştirir. Bu yüzden önbellek anahtarı yalnızca geometri ve G'lerdir.

// Referans figürdeki skala: mavi → camgöbeği → (yeşil) → sarı → kırmızı. Bu dört
// durak klasik "jet" skalasının uçları kırpılmış hâlidir; camgöbeği ile sarı
// arasındaki doğrusal ara değer yeşili kendiliğinden verir.
const STRESS_COLORMAP = [
    [0,       0,   0, 255],
    [1 / 3,   0, 255, 255],
    [2 / 3, 255, 255,   0],
    [1,     255,   0,   0]
];

function stressColorRGB(t) {
    const u = isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
    for (let i = 1; i < STRESS_COLORMAP.length; i++) {
        const a = STRESS_COLORMAP[i - 1], b = STRESS_COLORMAP[i];
        if (u <= b[0]) {
            const f = (b[0] - a[0] > 0) ? (u - a[0]) / (b[0] - a[0]) : 0;
            return [
                Math.round(a[1] + (b[1] - a[1]) * f),
                Math.round(a[2] + (b[2] - a[2]) * f),
                Math.round(a[3] + (b[3] - a[3]) * f)
            ];
        }
    }
    const last = STRESS_COLORMAP[STRESS_COLORMAP.length - 1];
    return [last[1], last[2], last[3]];
}

function stressColorCSS(t) {
    const c = stressColorRGB(t);
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
}

// Skalanın uçları. τ her bantta ρ ile doğrusal olduğundan dairesel kesitte en
// küçük ve en büyük değerler daima BANT KENARLARINDADIR. Panelin τmin'i (yalnız
// en içteki kenar) burada yetmez: içteki malzeme çok rijitse alanın en küçüğü
// dıştaki bandın iç kenarına düşer.
// === RENK ÖLÇEĞİ AYARLARI ===
// Ölçek modu, haritanın hangi ARALIĞA oturacağını belirler:
//   'auto'  → kesitin KENDİ uçları (τmin..τmak). Dağılımın BİÇİMİ okunur; τ ile
//             τmak birlikte ölçeklendiğinden renkler momentten bağımsızdır.
//   'fixed' → 0..τ_ref (kullanıcının girdiği referans, örn. emniyet gerilmesi).
//             Renkler gerilmenin MUTLAK şiddetini gösterir: moment büyüdükçe
//             kesit maviden kırmızıya döner, τ_ref aşılınca kırmızıda doyar.
// Gama ise rampanın EĞRİSİDİR (aralığı değil): t → t^γ. γ<1 düşük gerilme
// bölgesindeki farkları, γ>1 yüksek gerilme bölgesindekileri ayırt eder.
const STRESS_SCALE_KEY = 'torsionStressScale';
const STRESS_GAMMA_MIN = 0.2, STRESS_GAMMA_MAX = 5;
const STRESS_SPAN_EPS = 1e-12;
let stressScaleMode = 'auto';
let stressRefTau = 100;          // MPa — yalnız 'fixed' modda kullanılır
let stressGamma = 1;

// Harita 2B tuvali, ölçek çubuğunu ve 3B gövdeyi birlikte besler: ölçek ayarı
// değişince üçü de yenilenmeli
function redrawStressScale() {
    draw();
    call3D('update');
    call3D('updateStressLegend');
}

// Referans üst sınır yalnız sabit ölçekte anlamlıdır; otomatik moddayken alan gizlenir
function markStressScale() {
    document.querySelectorAll('[data-stress-scale]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-stress-scale') === stressScaleMode);
    });
    const row = document.getElementById('stressRefRow');
    if (row) row.style.display = (stressScaleMode === 'fixed') ? 'flex' : 'none';
}

function setStressScaleMode(mode) {
    stressScaleMode = (mode === 'fixed') ? 'fixed' : 'auto';
    markStressScale();
    saveStressScale();
    redrawStressScale();
}

function saveStressScale() {
    prefSet(STRESS_SCALE_KEY,
        JSON.stringify({ mode: stressScaleMode, ref: stressRefTau, gamma: stressGamma }));
}

function initStressScale() {
    try {
        const s = JSON.parse(prefGet(STRESS_SCALE_KEY) || 'null');
        if (s) {
            if (s.mode === 'fixed' || s.mode === 'auto') stressScaleMode = s.mode;
            if (isFinite(s.ref) && s.ref > 0) stressRefTau = s.ref;
            if (isFinite(s.gamma) && s.gamma > 0) {
                stressGamma = Math.max(STRESS_GAMMA_MIN, Math.min(STRESS_GAMMA_MAX, s.gamma));
            }
        }
    } catch (e) { /* bozuk kayıt: varsayılanlarla devam */ }
    const tbRef = document.getElementById('tbStressRef');
    if (tbRef) tbRef.value = stressRefTau;
    const tbGamma = document.getElementById('tbStressGamma');
    if (tbGamma) tbGamma.value = stressGamma;
    markStressScale();
    updateStressScaleRow();
}

// Ölçek denetimleri yalnız harita açıkken anlamlıdır
function updateStressScaleRow() {
    const row = document.getElementById('stressScaleRow');
    if (!row) return;
    const on = controls.cbStressMap && controls.cbStressMap.checked;
    row.style.display = on ? 'block' : 'none';
}

// Değer uzayında normalize edilmiş t'ye rampa eğrisini uygular. Ölçek çubuğu da
// bunu kullanır ki çubuk, haritadaki gerçek renk dağılımını göstersin.
function stressRampPos(t) {
    const c = t < 0 ? 0 : (t > 1 ? 1 : t);
    return stressGamma === 1 ? c : Math.pow(c, stressGamma);
}

// Ham |τ| → renk skalasındaki konum (0..1). Harita, ölçek çubuğu ve 3B köşe
// renkleri TEK bu yoldan beslenir; üçü hiçbir zaman ayrışmasın diye.
function stressColorPos(v, range) {
    const r = range || stressFieldRange();
    const span = r.vMax - r.vMin;
    return stressRampPos(span > STRESS_SPAN_EPS ? (v - r.vMin) / span : 0);
}

function stressFieldRange() {
    // Sabit ölçekte aralık kesitten değil kullanıcının referansından gelir;
    // aşağıdaki bütün tüketiciler (doku, çubuk, 3B) kendiliğinden uyar
    if (stressScaleMode === 'fixed') {
        return { vMin: 0, vMax: Math.max(0, stressRefTau) };
    }
    return sectionFieldRange(calc);   // kesitin gerçek uçları (calc.js)
}

// Kesit merkezine göre (x, y) noktasındaki |τ| (MPa) — güncel kesit için; sorgunun
// kendisi calc.js'tedir (shearMagAt). 3B köşe renklendirmesi bunu kullanır.
function sectionShearMagAt(x, y) {
    return shearMagAt(calc, x, y);
}

// Alan tümüyle sıfır mı (moment sıfır, ya da kapalı kesitte bütün cidarlarda aynı
// τ)? Böyle bir alanda haritalanacak bir değişim yoktur: harita da ölçek de tek
// renge iner. Sabit ölçekte aralık kesitten gelmediği için bu durum oluşmaz —
// orada τ = 0 zaten skalanın mavi ucuna düşer.
function stressFieldFlat() {
    const { vMin, vMax } = stressFieldRange();
    return !(vMax - vMin > STRESS_SPAN_EPS);
}

// Dokunun yeniden üretilmesini gerektiren tek şey geometri ve malzemelerdir —
// doku NORMALİZE olduğundan momentten bağımsızdır. Tek istisna alanın tümüyle
// SIFIR olması: o durumda harita tek renge iner ve bu, renkli dokuyla aynı
// önbellek gözünü paylaşamaz. Bayrak anahtara girmezse moment sıfırlandığında
// eski renkli doku basılmaya devam ediyor, 2B gökkuşağı gösterirken 3B (köşe
// renkleri canlı hesaplanır) doğru şekilde tek renk kalıyordu.
function stressFieldKey() {
    const parts = [calc.sectionType, stressFieldFlat() ? 'z' : 'v', stressGamma];
    // 'auto' modda alan normalize olduğundan momentten BAĞIMSIZDIR; 'fixed' modda
    // üst sınır sabit olduğu için moment doğrudan renkleri değiştirir ve anahtara
    // girmek zorundadır (τmak momentle doğru orantılıdır, vekil olarak yeter).
    if (stressScaleMode === 'fixed') parts.push('f', stressRefTau, calc.tauMax);
    circles.forEach(c => parts.push('c', c.cx, c.cy, c.r, c.ri || 0, c.G));
    rectangles.forEach(r => parts.push('r', r.x1, r.y1, r.x2, r.y2, r.G));
    return parts.join('|');
}

// Dokunun uzun kenarındaki texel sayısı. Dikdörtgende her texel iki seri toplamı
// demektir; simetri sayesinde yalnız bir çeyrek hesaplanır (aşağıya bak).
const STRESS_MAP_TEXELS = 256;

let stressFieldCache = null;

// Normalize (0..1) alanı RGBA dokuya yazar. Kesit dışında alfa = 0'dır: ekrana
// basarken kırpma (clip) gerekmez — SVGContext'te clip desteklenmediğinden bu şart.
function buildStressFieldTexture() {
    const x0 = calc.xMin, x1 = calc.xMax, y0 = calc.yMin, y1 = calc.yMax;
    const wGrid = x1 - x0, hGrid = y1 - y0;
    if (!(wGrid > 0) || !(hGrid > 0)) return null;

    const long = Math.max(wGrid, hGrid);
    let NX = Math.max(2, Math.round(STRESS_MAP_TEXELS * wGrid / long));
    let NY = Math.max(2, Math.round(STRESS_MAP_TEXELS * hGrid / long));
    NX += NX % 2; NY += NY % 2;              // çeyrek simetrisi için çift olmalı

    const range = stressFieldRange();

    // Doku EKRAN yönünde üretilir: gridToScreen x'i ters çevirdiğinden texel i
    // artarken grid x AZALIR. Böylece ekrana basarken ayna dönüşümü gerekmez.
    const dx = wGrid / NX, dy = hGrid / NY;
    const gxOf = (i) => x1 - (i + 0.5) * dx;
    const gyOf = (j) => y0 + (j + 0.5) * dy;

    const img = new ImageData(NX, NY);
    const px = img.data;

    const put = (i, j, v, inside) => {
        const o = (j * NX + i) * 4;
        if (!inside) { px[o + 3] = 0; return; }
        const c = stressColorRGB(stressColorPos(v, range));
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    };

    if (calc.sectionType === 'rect' && calc.rectInfo) {
        const info = calc.rectInfo;
        const cx = calc.centroidX, cy = calc.centroidY;
        const gT = Math.abs(info.gTheta);

        // |τ| iki merkez ekseninde de simetriktir: τx(x,−y) = −τx(x,y) ve
        // τy(x,−y) = τy(x,y) olduğundan büyüklük değişmez (y ekseni için de aynı).
        // Bu yüzden yalnız bir çeyrek hesaplanır, kalanı yansıtılır (4× hız).
        const qx = NX / 2, qy = NY / 2;
        const xs = new Float64Array(qx), ys = new Float64Array(qy);
        for (let i = 0; i < qx; i++) xs[i] = gxOf(i) - cx;
        for (let j = 0; j < qy; j++) ys[j] = gyOf(j) - cy;

        // Çekirdek seri h ≤ w ister; kısa kenar düşeyse eksenler takas edilir.
        // |τ| takastan etkilenmez (bkz. rectTauVector), yalnız indis düzeni değişir.
        const swap = info.h > info.w;
        const M = swap ? rectTauMagGrid(ys, xs, info.h, info.w)
                       : rectTauMagGrid(xs, ys, info.w, info.h);
        const quad = new Float64Array(qx * qy);
        for (let j = 0; j < qy; j++) {
            for (let i = 0; i < qx; i++) {
                quad[j * qx + i] = gT * (swap ? M[i * qy + j] : M[j * qx + i]);
            }
        }
        // Doku kutusu dikdörtgenin kendisidir: her texel kesit içindedir
        for (let j = 0; j < NY; j++) {
            const mj = Math.min(j, NY - 1 - j);
            for (let i = 0; i < NX; i++) {
                const mi = Math.min(i, NX - 1 - i);
                put(i, j, quad[mj * qx + mi], true);
            }
        }
    } else if (calc.sectionType === 'profile') {
        const cx = calc.centroidX, cy = calc.centroidY;
        for (let j = 0; j < NY; j++) {
            const y = gyOf(j) - cy;
            for (let i = 0; i < NX; i++) {
                const x = gxOf(i) - cx;
                const e = profileElementAt(calc, x, y);
                put(i, j, e ? profileShearAt(calc, x, y) : 0, !!e);
            }
        }
    } else {
        const bands = calc.torsionBands || [];
        const cx = calc.centroidX, cy = calc.centroidY;
        const th = Math.abs(calc.thetaPrime);
        for (let j = 0; j < NY; j++) {
            const y = gyOf(j) - cy;
            for (let i = 0; i < NX; i++) {
                const x = gxOf(i) - cx;
                const rho = Math.hypot(x, y);
                // Bantlar eş merkezli ve ayrıktır; aralarındaki boşluk kesit değildir
                const b = bandAtRadius(bands, rho);
                put(i, j, b ? (b.G * 1000) * th * rho : 0, !!b);
            }
        }
    }

    const tex = document.createElement('canvas');
    tex.width = NX; tex.height = NY;
    tex.getContext('2d').putImageData(img, 0, 0);
    return { tex, x0, x1, y0, y1 };
}

function getStressFieldTexture() {
    const key = stressFieldKey();
    if (stressFieldCache && stressFieldCache.key === key) return stressFieldCache.data;
    stressFieldCache = { key, data: buildStressFieldTexture() };
    return stressFieldCache.data;
}

function drawStressMap() {
    if (calc.errorState || sectionIsEmpty()) return;
    const field = getStressFieldTexture();
    if (!field) return;

    // Doku ekran yönünde üretildiği için sol-üst köşe (x1, y0)'a karşılık gelir
    const a = gridToScreen(field.x1, field.y0);
    const b = gridToScreen(field.x0, field.y1);
    const w = b.x - a.x, h = b.y - a.y;
    if (!(w > 0) || !(h > 0)) return;

    ctx.drawImage(field.tex, a.x, a.y, w, h);

    // Harita dolguyu örttüğünden kontur yeniden çizilir
    ctx.lineWidth = 1.5;
    circles.forEach((c, i) => {
        ctx.strokeStyle = shapeColor(c, i).stroke;
        defineShapePath(ctx, c);
        ctx.stroke();
    });
    rectangles.forEach((r, i) => {
        ctx.strokeStyle = shapeColor(r, i).stroke;
        defineShapePath(ctx, r);
        ctx.stroke();
    });
}

// Renk ölçeği (referans figürdeki düşey çubuk). İnce dilimlerle çizilir; hem
// canvas hem SVGContext fillRect desteklediğinden dışa aktarımda da görünür.
const LEGEND_SLICES = 96;

function drawStressLegend() {
    if (calc.errorState || sectionIsEmpty()) return;
    const { vMin, vMax } = stressFieldRange();
    const colors = getCanvasColors();

    const barW = 16;
    const barH = Math.max(120, Math.min(260, canvas.height * 0.45));
    const barX = canvas.width - 74;
    const barY = (canvas.height - barH) / 2;
    if (barX < 60) return;                       // dar tuvalde ölçek çizilmez

    ctx.save();

    const TICKS = 5;
    const tickText = (i) => (vMin + (vMax - vMin) * (i / (TICKS - 1))).toFixed(2);

    // Geniş bir kesit ölçeğin altına girebilir; yazılar okunur kalsın diye
    // etiketlerdeki gibi opak bir zemin serilir
    ctx.font = '11px Arial';
    let labelW = 0;
    for (let i = 0; i < TICKS; i++) {
        labelW = Math.max(labelW, ctx.measureText(tickText(i)).width);
    }
    ctx.fillStyle = colors.labelBg;
    ctx.fillRect(barX - 7, barY - 26, barW + 20 + labelW, barH + 36);

    // Üstte en büyük (kırmızı), altta en küçük (mavi). Alan tümüyle sıfırsa
    // (moment yok) haritanın kendisi tek renktir; ölçek de öyle olmalı, yoksa
    // hepsi 0.00 yazan bir gökkuşağı gösterirdi.
    // Dilim rengi rampa eğrisinden geçirilir: çubuk, haritadaki GERÇEK renk
    // dağılımını göstermeli (γ ≠ 1'de ortadaki renk ortadaki değere düşmez).
    // Etiketler değer uzayında doğrusal kalır, eğrilik böylece okunur olur.
    const flat = stressFieldFlat();
    const sliceH = barH / LEGEND_SLICES;
    for (let i = 0; i < LEGEND_SLICES; i++) {
        ctx.fillStyle = stressColorCSS(flat ? 0 : stressRampPos(1 - (i + 0.5) / LEGEND_SLICES));
        // Dilimler arasında saç teli boşluk kalmasın diye bir piksel bindirilir
        ctx.fillRect(barX, barY + i * sliceH, barW, sliceH + 1);
    }

    ctx.strokeStyle = colors.textColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.fillStyle = colors.textColor;
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < TICKS; i++) {
        const y = barY + barH * (1 - i / (TICKS - 1));
        ctx.beginPath();
        ctx.moveTo(barX + barW, y);
        ctx.lineTo(barX + barW + 4, y);
        ctx.stroke();
        ctx.fillText(tickText(i), barX + barW + 7, y);
    }

    ctx.textBaseline = 'alphabetic';
    ctx.font = 'italic 12px "Times New Roman"';
    ctx.fillText('τ (MPa)', barX, barY - 11);   // üst değerle çakışmayacak pay

    ctx.restore();
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
    // Profilde ordinat diyagramı çizilmez: diyagram tek bir doğru üzerinde
    // tanımlıdır, profilde dağılım cidar cidar ayrıdır. Gösterimi harita yapar.
    if (calc.sectionType === 'profile') return;
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
    // Etiketin ARKA PLANI YOKTUR (kullanıcı isteği): yay dışına düştüğü için
    // örtmesi gereken bir şey yok, opak kutu ise ızgarada leke gibi duruyordu.
    const labAng = 205 * DEG2RAD;
    drawSubscriptLabel('M', 'b', '',
        screenCenter.x + Math.cos(labAng) * screenRadius * 1.45,
        screenCenter.y + Math.sin(labAng) * screenRadius * 1.45, {
        align: 'center',
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
