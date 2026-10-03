'use strict';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/*
 * 地磁気センサーの生値をリアルタイムの折れ線グラフで表示する。
 * ベースライン(キャリブレーション基準値)を参照線として重ね、
 * 直近サンプルの傾きから「上昇中 / 下降中 / 横ばい」を判定する。
 */
class TrendChart {
  constructor(canvas, { maxPoints = 150 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.data = [];
    this.baseline = null;
    this.dpr = window.devicePixelRatio || 1;
    this._resize();
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, rect.width * this.dpr);
    this.canvas.height = Math.max(1, rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  setBaseline(value) {
    this.baseline = value;
  }

  push(value) {
    this.data.push(value);
    if (this.data.length > this.maxPoints) this.data.shift();
    this.render();
  }

  clear() {
    this.data = [];
    this.baseline = null;
    this.render();
  }

  getTrend() {
    if (this.data.length < 6) return 'flat';
    const n = Math.min(12, this.data.length);
    const recent = this.data.slice(-n);
    const half = Math.floor(n / 2);
    const firstAvg = recent.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondAvg = recent.slice(half).reduce((a, b) => a + b, 0) / (n - half);
    const diff = secondAvg - firstAvg;
    const spread = Math.max(...recent) - Math.min(...recent) || 1;
    const ratio = diff / spread;
    if (ratio > 0.15) return 'rising';
    if (ratio < -0.15) return 'falling';
    return 'flat';
  }

  render() {
    const { ctx, width, height } = this;
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    if (this.data.length < 2) return;

    const padding = 10;
    let min = Math.min(...this.data);
    let max = Math.max(...this.data);
    if (this.baseline !== null) {
      min = Math.min(min, this.baseline);
      max = Math.max(max, this.baseline);
    }
    const range = Math.max(max - min, 0.001);
    const pad = range * 0.25;
    min -= pad;
    max += pad;

    const usableWidth = width - padding * 2;
    const xStep = usableWidth / Math.max(1, this.maxPoints - 1);
    const offset = this.maxPoints - this.data.length;
    const xAt = (i) => padding + (i + offset) * xStep;
    const yAt = (v) => padding + (height - padding * 2) * (1 - (v - min) / (max - min));

    const accent = cssVar('--accent') || '#2a78d6';
    const baselineColor = cssVar('--baseline') || '#c3c2b7';
    const surface = cssVar('--surface-1') || '#fcfcfb';

    if (this.baseline !== null) {
      const y = yAt(this.baseline);
      ctx.strokeStyle = baselineColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    ctx.beginPath();
    this.data.forEach((v, i) => {
      const x = xAt(i);
      const y = yAt(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(this.data.length - 1), height - padding);
    ctx.lineTo(xAt(0), height - padding);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(accent, 0.1);
    ctx.fill();

    ctx.beginPath();
    this.data.forEach((v, i) => {
      const x = xAt(i);
      const y = yAt(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    const lastX = xAt(this.data.length - 1);
    const lastY = yAt(this.data[this.data.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
