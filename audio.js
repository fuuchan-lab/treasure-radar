'use strict';

/*
 * 反応レベル(0-100)に応じてビープ音の周波数・間隔を変化させる。
 * 15未満: 無音、15-90: 間欠ビープ(レベルが上がるほど間隔短縮)、90以上: 連続音。
 * AudioContext はユーザー操作(開始ボタン)の中で生成・resume する必要がある。
 */
class ToneFeedback {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.beepTimer = null;
    this.muted = false;
    this.volume = 0.8;
    this.beepOn = false;
  }

  _ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  start() {
    this._ensureContext();
    if (this.osc) return;
    this.osc = this.ctx.createOscillator();
    this.gain = this.ctx.createGain();
    this.osc.type = 'sine';
    this.osc.frequency.value = 300;
    this.gain.gain.value = 0;
    this.osc.connect(this.gain).connect(this.ctx.destination);
    this.osc.start();
  }

  stop() {
    clearInterval(this.beepTimer);
    this.beepTimer = null;
    if (this.osc) {
      this.osc.stop();
      this.osc.disconnect();
      this.osc = null;
    }
    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted && this.gain) {
      this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    }
  }

  update(level) {
    if (!this.osc || !this.gain || this.muted) return;
    const now = this.ctx.currentTime;

    const freq = 300 + (level / 100) * 1100;
    this.osc.frequency.setTargetAtTime(freq, now, 0.05);

    clearInterval(this.beepTimer);
    this.beepTimer = null;

    if (level < 15) {
      this.gain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    if (level >= 90) {
      this.gain.gain.setTargetAtTime(this.volume, now, 0.05);
      return;
    }

    const interval = 600 - (level / 90) * 500;
    this.beepOn = false;
    this.beepTimer = setInterval(() => {
      this.beepOn = !this.beepOn;
      this.gain.gain.setTargetAtTime(this.beepOn ? this.volume : 0, this.ctx.currentTime, 0.02);
    }, interval);
  }
}
