/* ============================================================
   AR 엔진 — MindAR(이미지 트래킹) + A-Frame 래퍼
   ============================================================ */

import { drawCard, CARD_W, CARD_H } from './arcard.js';
import { colorHex } from './model.js';

/* MindAR/A-Frame 은 전역(window.AFRAME)으로 로드된다. */
const AFRAME = () => window.AFRAME;

let componentsRegistered = false;

/** 엔진 인스턴스를 컴포넌트에서 찾기 위한 레지스트리 */
const registry = new Map();

function registerComponents() {
  if (componentsRegistered || !AFRAME()) return;
  componentsRegistered = true;
  const A = AFRAME();
  const THREE = window.THREE;

  /* ---- 캔버스 텍스처 카드 ---- */
  A.registerComponent('ar-card', {
    schema: {
      engine: { type: 'string' },
      index: { type: 'int', default: 0 },
      width: { type: 'number', default: 1.12 },
    },
    init() {
      const engine = registry.get(this.data.engine);
      if (!engine) return;
      const canvas = engine.cardCanvas(this.data.index);

      const tex = new THREE.CanvasTexture(canvas);
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace ?? tex.colorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;

      const w = this.data.width;
      const h = w * (CARD_H / CARD_W);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }),
      );
      mesh.renderOrder = 10;
      this.el.setObject3D('mesh', mesh);

      this.tex = tex;
      this.mesh = mesh;
      this.t0 = null;
      engine._textures.set(this.data.index, tex);

      // 등장 애니메이션 시작점
      mesh.scale.set(0.6, 0.6, 0.6);
      mesh.material.opacity = 0;
    },
    tick(time) {
      if (!this.mesh) return;
      if (this.t0 === null) this.t0 = time;
      const age = (time - this.t0) / 1000;

      // 팝인 (0.45초)
      const p = Math.min(1, age / 0.45);
      const ease = 1 - Math.pow(1 - p, 3);
      const s = 0.6 + 0.4 * ease + Math.sin(Math.min(p, 1) * Math.PI) * 0.06;
      this.mesh.scale.set(s, s, s);
      this.mesh.material.opacity = ease;

      // 부유
      this.el.object3D.position.y = 0.66 + Math.sin(age * 1.5) * 0.022;
      this.el.object3D.rotation.z = Math.sin(age * 0.9) * 0.012;
    },
    remove() {
      const engine = registry.get(this.data.engine);
      engine?._textures.delete(this.data.index);
      this.tex?.dispose();
      this.mesh?.geometry.dispose();
      this.mesh?.material.dispose();
      this.el.removeObject3D('mesh');
    },
  });

  /* ---- 타겟 위 스캔 링 ---- */
  A.registerComponent('scan-ring', {
    schema: { color: { type: 'color', default: '#43e8d8' } },
    init() {
      const geo = new THREE.RingGeometry(0.52, 0.56, 64);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(this.data.color),
        transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.renderOrder = 5;
      this.el.setObject3D('mesh', ring);
      this.ring = ring;
      this.t0 = null;
    },
    tick(time) {
      if (!this.ring) return;
      if (this.t0 === null) this.t0 = time;
      const age = (time - this.t0) / 1000;
      const s = 1 + Math.sin(age * 2) * 0.05;
      this.ring.scale.set(s, s, 1);
      this.ring.material.opacity = 0.45 + Math.sin(age * 2.4) * 0.28;
      this.ring.rotation.z = age * 0.35;
    },
    remove() {
      this.ring?.geometry.dispose();
      this.ring?.material.dispose();
      this.el.removeObject3D('mesh');
    },
  });

  /* ---- 교사가 올린 AR 이미지 평면 ---- */
  A.registerComponent('ar-photo', {
    schema: { src: { type: 'string' }, width: { type: 'number', default: 1.0 } },
    init() {
      const loader = new THREE.TextureLoader();
      loader.load(this.data.src, tex => {
        if (!this.el) return;
        if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace ?? tex.colorSpace;
        const ratio = (tex.image?.height || 1) / (tex.image?.width || 1);
        const w = this.data.width;
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(w, w * ratio),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }),
        );
        mesh.renderOrder = 9;
        this.el.setObject3D('mesh', mesh);
        this.mesh = mesh;
        this.t0 = null;
      });
    },
    tick(time) {
      if (!this.mesh) return;
      if (this.t0 === null) this.t0 = time;
      const age = (time - this.t0) / 1000;
      const p = Math.min(1, age / 0.4);
      this.mesh.material.opacity = 1 - Math.pow(1 - p, 3);
      this.el.object3D.position.y = Math.sin(age * 1.4) * 0.02;
    },
    remove() {
      this.mesh?.geometry.dispose();
      this.mesh?.material.dispose();
      this.el.removeObject3D('mesh');
    },
  });
}

/* ============================================================
   ArEngine
   ============================================================ */

let engineSeq = 0;

export class ArEngine {
  /**
   * @param {HTMLElement} container 씬을 넣을 컨테이너
   * @param {object} opts { onFound(index), onLost(index), onReady(), onError(err) }
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.key = `arEngine${++engineSeq}`;
    this.scene = null;
    this.running = false;
    this.targetCount = 0;
    this._canvases = new Map();
    this._textures = new Map();
    this._cardData = new Map();
    this._activeTargets = new Set();
    registry.set(this.key, this);
  }

  /** 타겟 인덱스별 캔버스 (컴포넌트가 요청) */
  cardCanvas(index) {
    if (!this._canvases.has(index)) {
      const c = document.createElement('canvas');
      c.width = CARD_W; c.height = CARD_H;
      this._canvases.set(index, c);
      drawCard(c, this._cardData.get(index) || {});
    }
    return this._canvases.get(index);
  }

  /** 카드 내용 갱신 (인식 전에 미리 세팅해 두면 좋다) */
  setCard(index, data) {
    this._cardData.set(index, data);
    const c = this._canvases.get(index);
    if (c) {
      drawCard(c, data);
      const tex = this._textures.get(index);
      if (tex) tex.needsUpdate = true;
    }
  }

  isActive(index) { return this._activeTargets.has(index); }

  /**
   * 씬 생성 + 시작
   * @param {string} mindUrl .mind 파일 URL (blob URL 가능)
   * @param {Array} targets 시나리오 타겟 배열 (색상/AR이미지 참조용)
   */
  async start(mindUrl, targets) {
    registerComponents();
    if (!AFRAME()) throw new Error('A-Frame 로드에 실패했습니다. 네트워크를 확인하세요.');

    this.targetCount = targets.length;

    const scene = document.createElement('a-scene');
    scene.setAttribute('mindar-image', [
      `imageTargetSrc: ${mindUrl}`,
      'autoStart: false',
      'uiLoading: no',
      'uiScanning: no',
      'uiError: no',
      'filterMinCF: 0.0001',
      'filterBeta: 0.005',
      'missTolerance: 8',
      'warmupTolerance: 3',
    ].join('; '));
    scene.setAttribute('vr-mode-ui', 'enabled: false');
    scene.setAttribute('device-orientation-permission-ui', 'enabled: false');
    scene.setAttribute('renderer', 'colorManagement: true; antialias: true; alpha: true; precision: medium');

    const cam = document.createElement('a-camera');
    cam.setAttribute('position', '0 0 0');
    cam.setAttribute('look-controls', 'enabled: false');
    cam.setAttribute('cursor', 'fuse: false; rayOrigin: mouse');
    scene.append(cam);

    targets.forEach((t, i) => {
      const entity = document.createElement('a-entity');
      entity.setAttribute('mindar-image-target', `targetIndex: ${i}`);

      const ring = document.createElement('a-entity');
      ring.setAttribute('scan-ring', `color: ${colorHex(t.ar?.color)}`);
      ring.setAttribute('position', '0 0 0.01');
      entity.append(ring);

      if (t.arImage) {
        const photo = document.createElement('a-entity');
        photo.setAttribute('ar-photo', `src: ${t.arImage}; width: 0.9`);
        photo.setAttribute('position', '0 0 0.05');
        entity.append(photo);
      }

      const card = document.createElement('a-entity');
      card.setAttribute('ar-card', `engine: ${this.key}; index: ${i}; width: 1.12`);
      card.setAttribute('position', '0 0.66 0.12');
      entity.append(card);

      entity.addEventListener('targetFound', () => {
        this._activeTargets.add(i);
        this.opts.onFound?.(i);
      });
      entity.addEventListener('targetLost', () => {
        this._activeTargets.delete(i);
        this.opts.onLost?.(i);
      });

      scene.append(entity);
    });

    this.container.append(scene);
    this.scene = scene;

    await new Promise(res => {
      if (scene.hasLoaded) return res();
      scene.addEventListener('loaded', res, { once: true });
    });

    scene.addEventListener('arError', e => {
      this.opts.onError?.(new Error('AR 초기화에 실패했습니다. 카메라 권한과 HTTPS 접속을 확인하세요.'), e);
    });

    const system = scene.systems['mindar-image-system'];
    if (!system) throw new Error('MindAR 시스템을 찾을 수 없습니다.');

    try {
      await system.start();

      // .mind 가 깨져 있으면 MindAR 은 조용히 실패한다.
      // 내부 msgpack 디코더가 던진 예외는 밖으로 나오지 않고,
      // 카메라만 켜진 채 markerDimensions 가 끝내 채워지지 않는다
      // → 학생 화면에서는 "아무리 비춰도 반응이 없는" 상태가 된다.
      const loaded = await waitUntil(
        () => (system.controller?.markerDimensions?.length ?? 0) > 0, 8000,
      );
      if (!loaded) {
        throw new Error('AR 타겟 데이터를 읽지 못했습니다. 제작 스튜디오에서 다시 컴파일해 주세요.');
      }

      this.running = true;
      // 카메라 영상이 배경에 가려지지 않도록 (play.css 의 .ar-on 규칙)
      document.documentElement.classList.add('ar-on');
      this.opts.onReady?.();
    } catch (err) {
      try { system.stop?.(); } catch { /* 무시 */ }
      // onError 는 씬이 뜬 뒤 비동기로 터지는 arError 전용이다.
      // 여기서까지 부르면 start() 를 await 하는 호출부와 겹쳐 안내가 두 번 뜬다.
      throw normalizeCameraError(err);
    }
  }

  stop() {
    try { this.scene?.systems?.['mindar-image-system']?.stop?.(); } catch { /* 무시 */ }
    document.documentElement.classList.remove('ar-on');
    this.running = false;
  }

  destroy() {
    this.stop();
    try {
      this.scene?.parentNode?.removeChild(this.scene);
      // MindAR 이 body 에 붙이는 비디오 엘리먼트 정리
      document.querySelectorAll('video').forEach(v => {
        if (v.srcObject) {
          v.srcObject.getTracks().forEach(tr => tr.stop());
          v.srcObject = null;
          v.remove();
        }
      });
    } catch { /* 무시 */ }
    registry.delete(this.key);
    this.scene = null;
    this._canvases.clear();
    this._textures.clear();
  }
}

function waitUntil(pred, ms, step = 150) {
  return new Promise(res => {
    const t0 = Date.now();
    const id = setInterval(() => {
      if (pred()) { clearInterval(id); res(true); }
      else if (Date.now() - t0 > ms) { clearInterval(id); res(false); }
    }, step);
  });
}

export function normalizeCameraError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new Error('카메라 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘에서 카메라를 허용해 주세요.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new Error('사용할 수 있는 카메라를 찾지 못했습니다.');
  }
  if (name === 'NotReadableError') {
    return new Error('다른 앱이 카메라를 사용 중입니다. 해당 앱을 종료하고 다시 시도하세요.');
  }
  if (!window.isSecureContext) {
    return new Error('HTTPS 또는 localhost 에서만 카메라를 쓸 수 있습니다.');
  }
  return err instanceof Error ? err : new Error(String(err));
}

/* ============================================================
   MindAR 타겟 컴파일러 (교사용)
   ============================================================ */

/**
 * 이미지들을 .mind 바이너리로 컴파일한다.
 * @param {HTMLImageElement[]} images
 * @param {(pct:number)=>void} onProgress
 * @returns {Promise<ArrayBuffer>}
 */
export async function compileTargets(images, onProgress = () => {}) {
  const MINDAR = window.MINDAR;
  if (!MINDAR?.IMAGE?.Compiler) {
    throw new Error('MindAR 컴파일러를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
  }
  const compiler = new MINDAR.IMAGE.Compiler();
  await compiler.compileImageTargets(images, pct => onProgress(Math.max(0, Math.min(100, pct))));
  const data = await compiler.exportData();

  // exportData() 는 Uint8Array 를 돌려주는데, 그 뒤에 붙은 backing ArrayBuffer 가
  // 실제 데이터보다 훨씬 크다(내부 버퍼를 넉넉히 잡아 두고 subarray 로 잘라 주기 때문).
  // 여기서 .buffer 를 그대로 넘기면 뒤의 여유 바이트까지 딸려 가고,
  // MindAR 의 msgpack 디코더가 "Extra N byte(s) found" 로 거부해서
  // 타겟이 끝내 로드되지 않는다 → 카메라만 켜지고 아무것도 인식되지 않는다.
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return data;
}

/** 외부 스크립트를 한 번만 로드 */
const loaded = new Map();
export function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // 동적 삽입 시 실행 순서 보장
    s.onload = () => res();
    s.onerror = () => rej(new Error(`스크립트 로드 실패: ${src}`));
    document.head.append(s);
  });
  loaded.set(src, p);
  return p;
}

/* 같은 라이브러리를 vendor/ 에 넣어 두고, 없거나 깨졌을 때만 CDN 으로 넘어간다.
   학교 방화벽이 CDN 을 막거나 30대가 동시에 접속해도 수업이 멈추지 않게 하기 위함. */
const VENDOR = {
  aframe: new URL('../vendor/aframe.min.js', import.meta.url).href,
  mindar: new URL('../vendor/mindar-image-aframe.prod.js', import.meta.url).href,
};

export const CDN = {
  aframe: 'https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-master.min.js',
  mindar: 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js',
};

async function ensure(key, probe, label) {
  if (probe()) return;
  try {
    await loadScript(VENDOR[key]);
    if (probe()) return;
  } catch { /* 로컬 번들이 없으면 CDN 으로 */ }
  loaded.delete(VENDOR[key]);
  await loadScript(CDN[key]);
  if (!probe()) throw new Error(`${label} 로드에 실패했습니다. 네트워크를 확인하세요.`);
}

/** 플레이용: A-Frame + MindAR-AFrame */
export async function loadArRuntime() {
  await ensure('aframe', () => window.AFRAME, 'A-Frame');
  await ensure('mindar', () => window.MINDAR?.IMAGE?.Controller, 'MindAR');
}

/** 제작용: 컴파일러.
    mind-ar 1.2.5 의 mindar-image.prod.js 는 ES 모듈이라 <script> 로 넣으면
    파싱 단계에서 죽는데 load 이벤트는 그대로 발생한다 → 성공한 것처럼 보이고
    window.MINDAR 는 끝내 undefined 였다. 같은 패키지의 a-frame 빌드는 IIFE 이고
    Compiler 를 함께 노출하므로 이쪽 하나만 쓴다. (플레이 런타임과 캐시도 공유된다) */
export async function loadCompiler() {
  // 이 빌드는 마지막에 AFRAME.registerComponent 를 호출하므로 A-Frame 을 먼저 올린다.
  // (없으면 MINDAR 를 노출한 직후 ReferenceError 로 죽는다 — 동작은 하지만 콘솔이 더러워진다)
  await ensure('aframe', () => window.AFRAME, 'A-Frame');
  await ensure('mindar', () => window.MINDAR?.IMAGE?.Compiler, 'MindAR 컴파일러');
}
