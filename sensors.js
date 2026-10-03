'use strict';

/*
 * 金属検知の主センサー: 地磁気センサー (Generic Sensor API)
 * Android Chrome 系でのみ利用可能。生の磁束密度(μT)から合成ベクトルの大きさを出す。
 */
class MagnetometerSensorSource extends EventTarget {
  constructor() {
    super();
    this.mode = 'magnetometer';
    this.label = '地磁気センサー(実測)';
    this.running = false;
  }

  static isSupported() {
    return 'Magnetometer' in window;
  }

  async start() {
    if (!MagnetometerSensorSource.isSupported()) {
      throw new Error('このブラウザは Magnetometer API に対応していません');
    }
    if (navigator.permissions) {
      try {
        const status = await navigator.permissions.query({ name: 'magnetometer' });
        if (status.state === 'denied') {
          throw new Error('磁気センサーの権限が拒否されています');
        }
      } catch (_) {
        // permissions.query が magnetometer 名に対応していない環境は無視して続行
      }
    }
    this.sensor = new window.Magnetometer({ frequency: 30 });
    this.sensor.addEventListener('reading', () => {
      const { x, y, z } = this.sensor;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      this.dispatchEvent(new CustomEvent('reading', { detail: { magnitude, raw: { x, y, z } } }));
    });
    this.sensor.addEventListener('error', (event) => {
      this.dispatchEvent(new CustomEvent('error', { detail: event.error }));
    });
    this.sensor.start();
    this.running = true;
  }

  stop() {
    if (this.sensor) this.sensor.stop();
    this.running = false;
  }
}

/*
 * フォールバック: コンパス方位の揺らぎから推定 (iOS Safari / 非対応端末向け)
 * 生の磁束密度は取得できないため、短時間窓での方位角の変化量を「異常度」として扱う。
 * 歩行や体の回転でも反応するため精度は大きく劣る。
 */
class CompassJitterSource extends EventTarget {
  constructor() {
    super();
    this.mode = 'compass-fallback';
    this.label = 'コンパス揺らぎ(簡易推定)';
    this.running = false;
    this.history = [];
    this.historySize = 8;
  }

  static isSupported() {
    return typeof DeviceOrientationEvent !== 'undefined';
  }

  async start() {
    if (!CompassJitterSource.isSupported()) {
      throw new Error('このブラウザは DeviceOrientationEvent に対応していません');
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        throw new Error('方位センサーの利用が許可されませんでした');
      }
    }
    this._handler = (event) => this._onOrientation(event);
    window.addEventListener('deviceorientation', this._handler, true);
    this.running = true;
  }

  _onOrientation(event) {
    const heading = typeof event.webkitCompassHeading === 'number'
      ? event.webkitCompassHeading
      : event.alpha;
    if (heading === null || heading === undefined) return;

    this.history.push(heading);
    if (this.history.length > this.historySize) this.history.shift();
    if (this.history.length < 3) return;

    let total = 0;
    for (let i = 1; i < this.history.length; i++) {
      let diff = Math.abs(this.history[i] - this.history[i - 1]);
      if (diff > 180) diff = 360 - diff;
      total += diff;
    }
    const jitter = total / (this.history.length - 1);
    this.dispatchEvent(new CustomEvent('reading', { detail: { magnitude: jitter, raw: { heading } } }));
  }

  stop() {
    if (this._handler) window.removeEventListener('deviceorientation', this._handler, true);
    this.running = false;
  }
}

/*
 * 金属検知の主センサーを初期化する。Magnetometer が使えればそれを、
 * 使えなければコンパス揺らぎ方式にフォールバックする。
 */
async function createMetalSensor() {
  if (MagnetometerSensorSource.isSupported()) {
    const mag = new MagnetometerSensorSource();
    try {
      await mag.start();
      return mag;
    } catch (e) {
      console.warn('Magnetometer を利用できませんでした。コンパス方式に切り替えます:', e.message);
    }
  }
  const fallback = new CompassJitterSource();
  await fallback.start();
  return fallback;
}

/*
 * スキャン姿勢ガイド用: 加速度計・ジャイロスコープ (DeviceMotionEvent)
 * 金属そのものは検知しない。水平を保っているか・動きが速すぎないかを判定して
 * 「地面から一定距離を保ってゆっくりスイープする」操作をガイドする。
 */
class MotionGuideSource extends EventTarget {
  constructor() {
    super();
    this.label = '加速度・ジャイロ・方位(スキャン方向トラッキング)';
    this.running = false;
    this.lastAccel = null;
    this.heading = null;
  }

  static isSupported() {
    return typeof DeviceMotionEvent !== 'undefined';
  }

  async start() {
    if (!MotionGuideSource.isSupported()) {
      throw new Error('このブラウザは DeviceMotionEvent に対応していません');
    }
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const result = await DeviceMotionEvent.requestPermission();
      if (result !== 'granted') {
        throw new Error('モーションセンサーの利用が許可されませんでした');
      }
    }
    // 方位(どちらを向けてスキャンしているか)は別イベント(deviceorientation)から取る。
    // 非対応・権限なしでも姿勢ガイド自体は動かしたいので失敗は無視する。
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { await DeviceOrientationEvent.requestPermission(); } catch (_) { /* ignore */ }
    }
    this._handler = (event) => this._onMotion(event);
    this._orientationHandler = (event) => this._onOrientation(event);
    window.addEventListener('devicemotion', this._handler, true);
    window.addEventListener('deviceorientation', this._orientationHandler, true);
    this.running = true;
  }

  _onOrientation(event) {
    // webkitCompassHeading (iOS, 真北基準) があれば優先。なければ absolute な alpha を
    // 画面上を北=0として時計回りの角度に変換する。相対値しか取れない端末では
    // 「開始時の向き」を基準にした相対角度になる(絶対方位ではない)。
    const heading = typeof event.webkitCompassHeading === 'number'
      ? event.webkitCompassHeading
      : (typeof event.alpha === 'number' ? (360 - event.alpha) % 360 : null);
    if (heading === null || heading === undefined) return;
    this.heading = heading;
    this.dispatchEvent(new CustomEvent('heading', { detail: { heading } }));
  }

  _onMotion(event) {
    const rotation = event.rotationRate || {};
    const accel = event.accelerationIncludingGravity || {};

    // 重力ベクトルとの角度から「水平かどうか」を推定
    const { x = 0, y = 0, z = 9.8 } = accel;
    const g = Math.sqrt(x * x + y * y + z * z) || 1;
    const tiltDeg = Math.acos(Math.min(1, Math.abs(z) / g)) * (180 / Math.PI);
    const isLevel = tiltDeg < 25;

    // 回転速度の合成値で「動きが速すぎないか」を判定
    const rotSpeed = Math.sqrt(
      (rotation.alpha || 0) ** 2 + (rotation.beta || 0) ** 2 + (rotation.gamma || 0) ** 2
    );
    const isSlow = rotSpeed < 120;

    this.dispatchEvent(new CustomEvent('guide', {
      detail: { isLevel, isSlow, tiltDeg, rotSpeed }
    }));
  }

  stop() {
    if (this._handler) window.removeEventListener('devicemotion', this._handler, true);
    if (this._orientationHandler) window.removeEventListener('deviceorientation', this._orientationHandler, true);
    this.running = false;
  }
}

/*
 * 補助: 周辺 BLE デバイスの RSSI 揺らぎを参考表示する (Web Bluetooth, Chrome 限定・実験的)
 * 金属検知の原理としては機能しないため、あくまで参考値として扱う。
 */
class BleJitterMonitor extends EventTarget {
  constructor() {
    super();
    this.devices = new Map();
    this.historySize = 8;
    this.scanning = false;
  }

  static isSupported() {
    return 'bluetooth' in navigator && typeof navigator.bluetooth.requestLEScan === 'function';
  }

  async start() {
    if (!BleJitterMonitor.isSupported()) {
      throw new Error('このブラウザは Web Bluetooth の LE スキャンに対応していません');
    }
    this._advHandler = (event) => this._onAdvertisement(event);
    navigator.bluetooth.addEventListener('advertisementreceived', this._advHandler);
    this.scan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true });
    this.scanning = true;
  }

  _onAdvertisement(event) {
    if (typeof event.rssi !== 'number') return;
    const id = event.device.id;
    const arr = this.devices.get(id) || [];
    arr.push(event.rssi);
    if (arr.length > this.historySize) arr.shift();
    this.devices.set(id, arr);

    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    const stddev = Math.sqrt(variance);

    let maxJitter = 0;
    for (const samples of this.devices.values()) {
      if (samples.length < 2) continue;
      const m = samples.reduce((a, b) => a + b, 0) / samples.length;
      const v = samples.reduce((a, b) => a + (b - m) ** 2, 0) / samples.length;
      maxJitter = Math.max(maxJitter, Math.sqrt(v));
    }

    this.dispatchEvent(new CustomEvent('update', {
      detail: { deviceCount: this.devices.size, jitter: stddev, maxJitter }
    }));
  }

  stop() {
    if (this.scan) this.scan.stop();
    if (this._advHandler) navigator.bluetooth.removeEventListener('advertisementreceived', this._advHandler);
    this.scanning = false;
    this.devices.clear();
  }
}
