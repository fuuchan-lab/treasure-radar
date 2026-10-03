'use strict';

/*
 * 方位連動レーダー表示。
 * DeviceOrientationEvent から得た「スマホが今どちらを向いているか」を使い、
 * その方向で測定された反応レベルを角度ビンに記録して、実際にスイープした
 * 方角ごとの反応をマッピングする。方位が取得できない端末では、画面上方向
 * 固定の簡易表示にフォールバックする。
 *
 * 注意: 地磁気センサー自体は単一のスカラー強度しか持たず、金属の方向を
 * 直接検知しているわけではない。ここでの「方向」はあくまで「スマホを
 * その方角に向けていた時に強い反応が出た」という記録であり、ユーザーが
 * 広い範囲をスイープして初めて意味を持つ。
 */
class RadarDisplay {
  constructor(canvas, { binCount = 72, fadeMs = 6000 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.binCount = binCount;
    this.fadeMs = fadeMs;
    this.bins = new Array(binCount).fill(null); // { level, color, time }

    this.heading = null; // 現在の向き(度, 0-360)。null ならフォールバック表示
    this.level = 0;
    this.color = '#0ca30c';
    this._sweepFallbackAngle = -Math.PI / 2;
    this._lastTime = null;
    this._running = true;

    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);
    this._resize();
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, rect.width * this.dpr);
    this.canvas.height = Math.max(1, rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setHeading(headingDeg) {
    this.heading = ((headingDeg % 360) + 360) % 360;
  }

  // level: 0-100, color: resolved CSS color (hex)
  setReading(level, color) {
    this.level = Math.max(0, Math.min(100, level));
    if (color) this.color = color;

    if (this.heading !== null) {
      const idx = Math.floor((this.heading / 360) * this.binCount) % this.binCount;
      this.bins[idx] = { level: this.level, color: this.color, time: performance.now() };
    }
  }

  destroy() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resizeHandler);
  }

  reset() {
    this.bins = new Array(this.binCount).fill(null);
    this.heading = null;
    this.level = 0;
  }

  _loop(time) {
    if (!this._running) return;
    if (this._lastTime === null) this._lastTime = time;
    const dt = (time - this._lastTime) / 1000;
    this._lastTime = time;
    this._sweepFallbackAngle += dt * ((Math.PI * 2) / 3.2);
    this._render(time);
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  _headingToCanvasAngle(headingDeg) {
    // heading 0 (スキャン開始時の正面 / 真北) を画面の 12 時方向とし、時計回りに対応させる
    return (headingDeg - 90) * (Math.PI / 180);
  }

  _render(time) {
    const { ctx, width, height } = this;
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.min(width, height) / 2 - 6;

    const gridColor = cssVar('--gridline') || '#e1e0d9';
    const accent = cssVar('--accent') || '#2a78d6';

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (maxR * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy);
    ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR);
    ctx.lineTo(cx, cy + maxR);
    ctx.stroke();

    if (this.heading === null) {
      // フォールバック: 方位が取れないので装飾的な自動スイープ + 固定位置の輝点
      for (let i = 0; i < 14; i++) {
        const a = this._sweepFallbackAngle - i * 0.045;
        const alpha = Math.max(0, 0.22 - i * 0.016);
        ctx.strokeStyle = hexToRgba(accent, alpha);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        ctx.stroke();
      }
      this._drawBlip(cx, cy, maxR, -Math.PI / 2, this.level, this.color, time);
    } else {
      // 各ビンに記録された反応を、その方角の弧として描画(新しいほど濃い)
      const binAngle = (Math.PI * 2) / this.binCount;
      for (let i = 0; i < this.binCount; i++) {
        const bin = this.bins[i];
        if (!bin || bin.level < 10) continue;
        const age = time - bin.time;
        const fade = Math.max(0, 1 - age / this.fadeMs);
        if (fade <= 0) continue;

        const startDeg = (i / this.binCount) * 360;
        const a0 = this._headingToCanvasAngle(startDeg);
        const a1 = a0 + binAngle;
        const r = maxR * 0.1 + maxR * 0.85 * (bin.level / 100);

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a0, a1);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(bin.color, 0.35 * fade);
        ctx.fill();
      }

      // 現在向いている方角を示す針
      const curAngle = this._headingToCanvasAngle(this.heading);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(curAngle) * maxR, cy + Math.sin(curAngle) * maxR);
      ctx.stroke();

      this._drawBlip(cx, cy, maxR, curAngle, this.level, this.color, time);
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = gridColor;
    ctx.fill();
  }

  _drawBlip(cx, cy, maxR, angle, level, color, time) {
    if (level <= 5) return;
    const distRatio = 1 - level / 100;
    const dist = maxR * 0.08 + maxR * 0.82 * distRatio;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;

    const pulse = 1 + 0.25 * Math.sin(time / 180) * (level / 100);
    const r = (5 + (level / 100) * 6) * pulse;

    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(bx, by, r * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(color, 0.18);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}
