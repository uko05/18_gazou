// script.js
// 画像切り抜き連番保存ツール。
// 指定したW×Hに画像を切り抜いて、フォルダを選択してあれば連番ファイル名で
// 直接そこへ書き込み(File System Access API)、対応ブラウザでなければ
// 通常のダウンロードにフォールバックする。

const targetWidthInput  = document.getElementById('target-width');
const targetHeightInput = document.getElementById('target-height');

const fileInput   = document.getElementById('file-input');
const loadBtn      = document.getElementById('load-btn');
const noImageHint = document.getElementById('no-image-hint');

const cropSection  = document.getElementById('crop-section');
const cropStage    = document.getElementById('crop-stage');
const cropFrame    = document.getElementById('crop-frame');
const cropImg      = document.getElementById('crop-img');
const cropGhostImg = document.getElementById('crop-ghost-img');
const zoomSlider   = document.getElementById('zoom-slider');

const pickFolderBtn      = document.getElementById('pick-folder-btn');
const folderNameDisplay  = document.getElementById('folder-name-display');
const fsapiWarning       = document.getElementById('fsapi-warning');
const filenameInput      = document.getElementById('filename-input');
const extSelect          = document.getElementById('ext-select');
const nextFilenamePreview = document.getElementById('next-filename-preview');
const saveBtn      = document.getElementById('save-btn');
const saveMsg      = document.getElementById('save-msg');

// ===== 画像の状態 =====
let nativeImg = null;
let scale = 1, offsetX = 0, offsetY = 0, minScale = 0.01;
let frameW = 0, frameH = 0, peek = 0;

// ===== フォルダ保存(File System Access API)の状態 =====
let dirHandle = null;
const HAS_FS_API = 'showDirectoryPicker' in window;
// フォルダを選べないブラウザ向けの、このページを開いている間だけのフォールバック連番
// (テンプレート名+拡張子の組み合わせごとに別カウントを持つ)
const fallbackCounts = new Map();

if (!HAS_FS_API) {
  pickFolderBtn.disabled = true;
  pickFolderBtn.textContent = '（このブラウザは非対応）';
  fsapiWarning.classList.remove('hidden');
}

// ===== 入力値の保持(localStorage) =====
// フォルダ選択(dirHandle)は別途IndexedDBで扱う(後述)。ここでは単純な文字列項目のみ。
const LS_KEYS = {
  targetW:  'gazouTool_targetW',
  targetH:  'gazouTool_targetH',
  filename: 'gazouTool_filename',
  ext:      'gazouTool_ext',
};

function restoreSavedInputs() {
  try {
    const w   = localStorage.getItem(LS_KEYS.targetW);
    const h   = localStorage.getItem(LS_KEYS.targetH);
    const fn  = localStorage.getItem(LS_KEYS.filename);
    const ext = localStorage.getItem(LS_KEYS.ext);
    if (w)  targetWidthInput.value  = w;
    if (h)  targetHeightInput.value = h;
    if (fn) filenameInput.value     = fn;
    if (ext && [...extSelect.options].some((o) => o.value === ext)) extSelect.value = ext;
  } catch (e) {
    // プライベートブラウジング等でlocalStorageが使えない場合は諦めて既定値のまま
  }
}

function saveInput(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

restoreSavedInputs();

// ===== 出力サイズ変更 =====
[targetWidthInput, targetHeightInput].forEach((el) => {
  el.addEventListener('change', () => {
    saveInput(el === targetWidthInput ? LS_KEYS.targetW : LS_KEYS.targetH, el.value);
    if (nativeImg) initCropFrame();
  });
});

// ===== 画像読み込み =====
loadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadImageFromDataUrl(reader.result);
  reader.readAsDataURL(file);
  fileInput.value = '';
});

function loadImageFromDataUrl(dataUrl) {
  const img = new Image();
  img.onload = () => {
    nativeImg = img;
    noImageHint.classList.add('hidden');
    cropSection.classList.remove('hidden');
    initCropFrame();
    updateNextFilenamePreview();
  };
  img.src = dataUrl;
}

// ===== 切り抜きフレームの初期化 =====
function computeFrameSize() {
  const targetW = Math.max(1, parseInt(targetWidthInput.value, 10) || 1);
  const targetH = Math.max(1, parseInt(targetHeightInput.value, 10) || 1);
  const PREVIEW_MAX = 420;
  const ratio = Math.min(PREVIEW_MAX / targetW, PREVIEW_MAX / targetH, 1);
  frameW = Math.round(targetW * ratio);
  frameH = Math.round(targetH * ratio);
  // 枠の外側にうっすら見せる「はみ出し」の幅。枠が中央に来るよう
  // ステージのサイズを枠+この分だけ大きくする(crop-stageはflexで中央寄せ)。
  // 正方形に近い枠だとページ幅(mainのmax-width:560px)をはみ出しやすいので上限を設ける。
  peek = Math.min(60, Math.round(Math.min(frameW, frameH) * 0.2));
  cropFrame.style.width  = frameW + 'px';
  cropFrame.style.height = frameH + 'px';
  cropStage.style.width  = (frameW + peek * 2) + 'px';
  cropStage.style.height = (frameH + peek * 2) + 'px';
}

// 画像がフレームを常に埋めるように(すき間が出ないように)最小ズームを決め、
// 初期状態はその最小ズームで中央寄せする。
function initCropFrame() {
  computeFrameSize();
  minScale = Math.max(frameW / nativeImg.width, frameH / nativeImg.height);
  scale = minScale;
  offsetX = (frameW - nativeImg.width  * scale) / 2;
  offsetY = (frameH - nativeImg.height * scale) / 2;
  zoomSlider.min   = minScale.toFixed(4);
  zoomSlider.max   = (minScale * 10).toFixed(4);
  zoomSlider.step  = (minScale / 100).toFixed(6);
  zoomSlider.value = scale;
  applyTransform();
}

// 画像の外側(透明になる領域)が枠内に入らないよう、offsetX/offsetYを
// 「画像がフレームを常に覆っている」範囲にクランプする。
// (minScaleにより画像はフレーム以上のサイズになるので、通常はimgW>=frameW/
// imgH>=frameHだが、念のため逆のケースも中央寄せで吸収しておく)
function clampOffsets() {
  const imgW = nativeImg.width  * scale;
  const imgH = nativeImg.height * scale;
  offsetX = imgW <= frameW ? (frameW - imgW) / 2 : Math.min(0, Math.max(frameW - imgW, offsetX));
  offsetY = imgH <= frameH ? (frameH - imgH) / 2 : Math.min(0, Math.max(frameH - imgH, offsetY));
}

function applyTransform() {
  clampOffsets();
  cropImg.src = nativeImg.src;
  cropImg.style.width  = (nativeImg.width  * scale) + 'px';
  cropImg.style.height = (nativeImg.height * scale) + 'px';
  cropImg.style.left   = offsetX + 'px';
  cropImg.style.top    = offsetY + 'px';

  // ゴースト画像はcrop-imgと全く同じ拡大率・位置だが、crop-stage基準
  // (枠の左上はステージから常にpeek分オフセットしている)で配置する。
  cropGhostImg.src = nativeImg.src;
  cropGhostImg.style.width  = (nativeImg.width  * scale) + 'px';
  cropGhostImg.style.height = (nativeImg.height * scale) + 'px';
  cropGhostImg.style.left   = (peek + offsetX) + 'px';
  cropGhostImg.style.top    = (peek + offsetY) + 'px';
}

function setScale(newScale) {
  const maxScale = +zoomSlider.max || minScale * 10;
  newScale = Math.max(minScale, Math.min(maxScale, newScale));
  const cx = frameW / 2, cy = frameH / 2;
  offsetX = cx - (cx - offsetX) * (newScale / scale);
  offsetY = cy - (cy - offsetY) * (newScale / scale);
  scale = newScale;
  zoomSlider.value = scale;
  applyTransform();
}

// ===== ドラッグで位置移動 =====
let dragging = false, dragStart = null;
cropFrame.addEventListener('pointerdown', (e) => {
  if (!nativeImg) return;
  dragging = true;
  dragStart = { x: e.clientX - offsetX, y: e.clientY - offsetY };
  cropFrame.setPointerCapture(e.pointerId);
});
cropFrame.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  offsetX = e.clientX - dragStart.x;
  offsetY = e.clientY - dragStart.y;
  applyTransform();
});
cropFrame.addEventListener('pointerup', () => { dragging = false; });
cropFrame.addEventListener('pointercancel', () => { dragging = false; });

// ===== ホイール/スライダーでズーム =====
cropFrame.addEventListener('wheel', (e) => {
  if (!nativeImg) return;
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.92 : 1.09;
  setScale(scale * factor);
}, { passive: false });

zoomSlider.addEventListener('input', () => setScale(+zoomSlider.value));

// ===== フォルダ選択の永続化(IndexedDB) =====
// FileSystemDirectoryHandleはstructured-cloneableなのでIndexedDBに直接保存できる。
// ただし許可(permission)はハンドルとは別にブラウザが管理しており、リロード後は
// 'granted'のままのこともあれば'prompt'に戻ることもある。'prompt'の場合は
// requestPermission()にユーザー操作(クリック)が必要なため、自動では再取得できず
// 「フォルダを選択」ボタンを押してもらうタイミングで再取得を試みる(pendingDirHandle)。
const IDB_NAME = 'gazouToolDB', IDB_STORE = 'handles', IDB_KEY = 'dirHandle';
let pendingDirHandle = null;

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandleToDB(handle) {
  try {
    const db = await openHandleDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[gazou] save folder handle failed', e);
  }
}

async function loadDirHandleFromDB() {
  try {
    const db = await openHandleDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[gazou] load folder handle failed', e);
    return null;
  }
}

// ページを開いた時点で前回のフォルダを復元できるか確認する。
// queryPermission()はユーザー操作なしで呼べるので、既に許可済みならボタンを押さず
// 自動復元できる。'prompt'に戻っていた場合は、ボタンを押した時に再許可を試みる。
async function restoreFolderHandle() {
  if (!HAS_FS_API) return;
  const handle = await loadDirHandleFromDB();
  if (!handle) return;
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      dirHandle = handle;
      folderNameDisplay.textContent = `選択中: ${dirHandle.name}`;
    } else {
      pendingDirHandle = handle;
      folderNameDisplay.textContent = `前回のフォルダ「${handle.name}」を使うには、もう一度「フォルダを選択」を押してください`;
    }
    updateNextFilenamePreview();
  } catch (e) {
    console.error('[gazou] folder permission check failed', e);
  }
}

// ===== フォルダ選択 =====
pickFolderBtn.addEventListener('click', async () => {
  if (!HAS_FS_API) return;
  try {
    if (pendingDirHandle) {
      const perm = await pendingDirHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        dirHandle = pendingDirHandle;
        pendingDirHandle = null;
        folderNameDisplay.textContent = `選択中: ${dirHandle.name}`;
        saveMsg.textContent = '';
        updateNextFilenamePreview();
        return;
      }
      pendingDirHandle = null; // 拒否された場合は新規選択に進む
    }
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    folderNameDisplay.textContent = `選択中: ${dirHandle.name}`;
    saveMsg.textContent = '';
    updateNextFilenamePreview();
    await saveDirHandleToDB(dirHandle);
  } catch (e) {
    // ユーザーがキャンセルした場合など。何もしない。
  }
});

restoreFolderHandle();

// ===== 連番ファイル名の管理 =====
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 選択済みフォルダの中を実際に見て、同じテンプレート名+拡張子の最大の番号を探す。
// (前回セッションの続きから連番を再開できるように、フォルダ内を毎回スキャンする)
async function getNextSeqFromFolder(template, ext) {
  let maxN = 0;
  const re = new RegExp(`^${escapeRegExp(template)}_(\\d+)\\.${ext}$`, 'i');
  for await (const name of dirHandle.keys()) {
    const m = name.match(re);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return maxN + 1;
}

function nextFallbackSeq(template, ext) {
  return fallbackCounts.get(`${template}||${ext}`) || 1;
}

function padSeq(n) {
  return String(n).padStart(3, '0');
}

async function updateNextFilenamePreview() {
  const template = filenameInput.value.trim() || 'image';
  const ext = extSelect.value;
  let n;
  if (dirHandle) {
    try {
      n = await getNextSeqFromFolder(template, ext);
    } catch (e) {
      n = 1;
    }
  } else {
    n = nextFallbackSeq(template, ext);
  }
  nextFilenamePreview.textContent = `${template}_${padSeq(n)}.${ext}`;
}

filenameInput.addEventListener('input', () => {
  saveInput(LS_KEYS.filename, filenameInput.value);
  updateNextFilenamePreview();
});
extSelect.addEventListener('change', () => {
  saveInput(LS_KEYS.ext, extSelect.value);
  updateNextFilenamePreview();
});

// ===== 保存 =====
saveBtn.addEventListener('click', async () => {
  if (!nativeImg) return;
  saveBtn.disabled = true;
  saveMsg.textContent = '';
  saveMsg.classList.remove('ok', 'error');

  try {
    const template = filenameInput.value.trim() || 'image';
    const ext = extSelect.value;
    const targetW = Math.max(1, parseInt(targetWidthInput.value, 10) || 1);
    const targetH = Math.max(1, parseInt(targetHeightInput.value, 10) || 1);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    // フレーム内に見えている領域を、そのまま指定サイズへ書き出す
    // (プレビュー用フレームの画面上のピクセルサイズとは独立して計算できる)
    const srcX = -offsetX / scale;
    const srcY = -offsetY / scale;
    const srcW = frameW / scale;
    const srcH = frameH / scale;
    ctx.drawImage(nativeImg, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);

    const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    const quality = (ext === 'jpg' || ext === 'webp') ? 0.92 : undefined;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    if (!blob) throw new Error('画像の書き出しに失敗しました');

    if (dirHandle) {
      const n = await getNextSeqFromFolder(template, ext);
      const filename = `${template}_${padSeq(n)}.${ext}`;
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      saveMsg.textContent = `「${filename}」を保存しました。`;
      saveMsg.classList.add('ok');
    } else {
      const key = `${template}||${ext}`;
      const n = fallbackCounts.get(key) || 1;
      const filename = `${template}_${padSeq(n)}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      fallbackCounts.set(key, n + 1);
      saveMsg.textContent = `「${filename}」としてダウンロードしました。`;
      saveMsg.classList.add('ok');
    }
    await updateNextFilenamePreview();
  } catch (e) {
    console.error('[save] failed', e);
    saveMsg.textContent = '保存に失敗しました。もう一度お試しください。';
    saveMsg.classList.add('error');
  } finally {
    saveBtn.disabled = false;
  }
});
