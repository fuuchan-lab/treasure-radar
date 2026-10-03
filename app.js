'use strict';

(() => {
  const el = {
    radarCanvas: document.getElementById('radarCanvas'),
    gaugeValue: document.getElementById('gaugeValue'),
    statusBadge: document.getElementById('statusBadge'),
    statusIcon: document.getElementById('statusIcon'),
    statusLabel: document.getElementById('statusLabel'),
    modeText: document.getElementById('modeText'),
    scanGuide: document.getElementById('scanGuide'),
    levelChip: document.getElementById('levelChip'),
    speedChip: document.getElementById('speedChip'),
    startBtn: document.getElementById('startBtn'),
    calibrateBtn: document.getElementById('calibrateBtn'),
    sensitivitySlider: document.getElementById('sensitivitySlider'),
    volumeSlider: document.getElementById('volumeSlider'),
    soundToggle: document.getElementById('soundToggle'),
    bleToggle: document.getElementById('bleToggle'),
    blePanel: document.getElementById('blePanel'),
    bleStatus: document.getElementById('bleStatus'),
    sensorMag: document.getElementById('sensorMag'),
    sensorMagDetail: document.getElementById('sensorMagDetail'),
    sensorMotion: document.getElementById('sensorMotion'),
    sensorMotionDetail: document.getElementById('sensorMotionDetail'),
    sensorBle: document.getElementById('sensorBle'),
    sensorBleDetail: document.getElementById('sensorBleDetail'),
    trendCanvas: document.getElementById('trendCanvas'),
    trendIndicator: document.getElementById('trendIndicator'),
    rawValue: document.getElementById('rawValue'),
    baselineValue: document.getElementById('baselineValue'),
  };

  const radar = new RadarDisplay(el.radarCanvas);
  const trendChart = new TrendChart(el.trendCanvas, { maxPoints: 150 });
  const TREND_LABELS = {
    rising: '▲ 上昇中(接近の可能性)',
    falling: '▼ 下降中',
    flat: '─ 変化なし',
  };

  const state = {
    running: false,
    metalSensor: null,
    motionSource: null,
    bleMonitor: null,
    tone: new ToneFeedback(),
    baseline: null,
    calibrating: false,
    calibrationSamples: [],
    sensitivity: Number(el.sensitivitySlider.value),
    volume: Number(el.volumeSlider.value) / 100,
    soundEnabled: el.soundToggle.checked,
    lastRaw: null,
    bleJitter: 0,
    heading: null,
    isAngular: false,
    unit: '',
  };

  function setSensorState(itemEl, detailEl, stateName, detailText) {
    itemEl.dataset.state = stateName;
    detailEl.textContent = detailText;
  }

  function formatReading(value, isAngular) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return isAngular ? `${value.toFixed(1)}°` : `${value.toFixed(1)} μT`;
  }

  function levelToStatus(level) {
    if (level < 25) return { key: 'idle', label: '反応なし', icon: '⚪', varName: '--baseline' };
    if (level < 50) return { key: 'low', label: '弱い反応', icon: '🟢', varName: '--status-good' };
    if (level < 75) return { key: 'medium', label: '中程度の反応', icon: '🟡', varName: '--status-warning' };
    if (level < 90) return { key: 'high', label: '強い反応', icon: '🟠', varName: '--status-serious' };
    return { key: 'critical', label: '非常に強い反応!', icon: '🔴', varName: '--status-critical' };
  }

  function updateGauge(level) {
    const clamped = Math.max(0, Math.min(100, level));
    el.gaugeValue.textContent = String(Math.round(clamped));

    const status = levelToStatus(clamped);
    el.statusBadge.dataset.status = status.key;
    el.statusIcon.textContent = status.icon;
    el.statusLabel.textContent = status.label;

    radar.setReading(clamped, cssVar(status.varName));

    if (state.soundEnabled) {
      state.tone.update(clamped);
    }
  }

  function computeLevel(rawMagnitude, isAngular) {
    if (state.baseline === null) return 0;
    const deviation = isAngular
      ? angleDiff(rawMagnitude, state.baseline)
      : Math.abs(rawMagnitude - state.baseline);
    const scale = isAngular
      ? Math.max(1, (11 - state.sensitivity) * 0.8)
      : Math.max(1, (11 - state.sensitivity) * 1.5);
    return Math.max(0, Math.min(100, (deviation / scale) * 100));
  }

  function onMetalReading(detail) {
    state.lastRaw = detail.magnitude;
    state.isAngular = !!detail.isAngular;
    state.unit = detail.unit || '';

    if (state.calibrating) {
      state.calibrationSamples.push(detail.magnitude);
      return;
    }

    el.rawValue.textContent = formatReading(detail.magnitude, state.isAngular);

    trendChart.push(detail.magnitude);
    const trend = trendChart.getTrend();
    el.trendIndicator.dataset.trend = trend;
    el.trendIndicator.textContent = TREND_LABELS[trend];

    const level = computeLevel(detail.magnitude, state.isAngular);
    updateGauge(level);
  }

  async function startMetalSensor() {
    const sensor = await createMetalSensor();
    sensor.addEventListener('reading', (e) => onMetalReading(e.detail));
    sensor.addEventListener('error', (e) => {
      console.warn('センサーエラー:', e.detail);
    });
    state.metalSensor = sensor;

    const isHighPrecision = sensor.mode === 'magnetometer';
    setSensorState(el.sensorMag, el.sensorMagDetail, 'active', isHighPrecision ? '高精度' : '簡易');
    el.modeText.textContent = isHighPrecision
      ? '高精度モード: 地磁気センサーの実測値を使用しています。'
      : '簡易モード: このデバイスでは磁力センサーを取得できないため、コンパス方位の揺らぎから推定しています。精度は低めです。';
  }

  async function startMotionGuide() {
    if (!MotionGuideSource.isSupported()) {
      setSensorState(el.sensorMotion, el.sensorMotionDetail, 'unavailable', '非対応');
      return;
    }
    try {
      const motion = new MotionGuideSource();
      motion.addEventListener('guide', (e) => {
        const { isLevel, isSlow } = e.detail;
        el.levelChip.dataset.ok = String(isLevel);
        el.speedChip.dataset.ok = String(isSlow);
      });
      motion.addEventListener('heading', (e) => {
        state.heading = e.detail.heading;
        radar.setHeading(state.heading);
      });
      await motion.start();
      state.motionSource = motion;
      el.scanGuide.hidden = false;
      setSensorState(el.sensorMotion, el.sensorMotionDetail, 'active', '有効');
    } catch (e) {
      setSensorState(el.sensorMotion, el.sensorMotionDetail, 'unavailable', '権限なし');
    }
  }

  async function toggleBle(enabled) {
    if (!enabled) {
      if (state.bleMonitor) {
        state.bleMonitor.stop();
        state.bleMonitor = null;
      }
      el.blePanel.hidden = true;
      setSensorState(el.sensorBle, el.sensorBleDetail, 'pending', '未使用');
      return;
    }

    if (!BleJitterMonitor.isSupported()) {
      el.blePanel.hidden = false;
      el.bleStatus.textContent = 'このブラウザ・OSは Web Bluetooth の LE スキャンに対応していません。';
      setSensorState(el.sensorBle, el.sensorBleDetail, 'unavailable', '非対応');
      el.bleToggle.checked = false;
      return;
    }

    try {
      const monitor = new BleJitterMonitor();
      monitor.addEventListener('update', (e) => {
        const { deviceCount, jitter } = e.detail;
        state.bleJitter = jitter;
        el.bleStatus.textContent = `周辺デバイス: ${deviceCount}件 / RSSI揺らぎ(参考値): ${jitter.toFixed(1)}`;
      });
      await monitor.start();
      state.bleMonitor = monitor;
      el.blePanel.hidden = false;
      el.bleStatus.textContent = 'スキャン中…';
      setSensorState(el.sensorBle, el.sensorBleDetail, 'active', 'スキャン中');
    } catch (e) {
      el.blePanel.hidden = false;
      el.bleStatus.textContent = `スキャンを開始できませんでした: ${e.message}`;
      setSensorState(el.sensorBle, el.sensorBleDetail, 'unavailable', 'エラー');
      el.bleToggle.checked = false;
    }
  }

  async function calibrate() {
    if (!state.metalSensor || state.calibrating) return;
    state.calibrating = true;
    state.calibrationSamples = [];
    el.calibrateBtn.disabled = true;
    el.calibrateBtn.textContent = 'キャリブレーション中…';
    el.modeText.textContent = 'ケースの磁石やマウントを外し、探索時と同じ持ち方で静かに構えてください。3秒間キャリブレーションします。';

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const samples = state.calibrationSamples;
    if (samples.length > 0) {
      state.baseline = state.isAngular
        ? averageAngle(samples)
        : samples.reduce((a, b) => a + b, 0) / samples.length;
    } else if (state.lastRaw !== null) {
      state.baseline = state.lastRaw;
    }
    trendChart.setBaseline(state.baseline);
    radar.reset();
    el.baselineValue.textContent = formatReading(state.baseline, state.isAngular);

    state.calibrating = false;
    el.calibrateBtn.disabled = false;
    el.calibrateBtn.textContent = 'キャリブレーション';
    el.modeText.textContent = 'キャリブレーション完了。スマホを地面と水平に、ゆっくり左右にスイープしてください。';
  }

  async function handleStart() {
    if (state.running) {
      stopAll();
      return;
    }

    el.startBtn.textContent = '初期化中…';
    el.startBtn.disabled = true;

    try {
      state.tone.start();
      await startMetalSensor();
      await startMotionGuide();

      state.running = true;
      el.startBtn.textContent = '探索を停止';
      el.startBtn.dataset.active = 'true';
      el.calibrateBtn.disabled = false;

      await calibrate();
    } catch (e) {
      el.modeText.textContent = `センサーを初期化できませんでした: ${e.message}`;
      setSensorState(el.sensorMag, el.sensorMagDetail, 'unavailable', 'エラー');
    } finally {
      el.startBtn.disabled = false;
    }
  }

  function stopAll() {
    if (state.metalSensor) {
      state.metalSensor.stop();
      state.metalSensor = null;
    }
    if (state.motionSource) {
      state.motionSource.stop();
      state.motionSource = null;
    }
    if (state.bleMonitor) {
      state.bleMonitor.stop();
      state.bleMonitor = null;
    }
    state.tone.stop();
    state.running = false;
    state.baseline = null;
    state.heading = null;

    el.startBtn.textContent = '探索を開始';
    el.startBtn.dataset.active = 'false';
    el.calibrateBtn.disabled = true;
    el.scanGuide.hidden = true;
    el.modeText.textContent = '開始ボタンを押してセンサーを有効にしてください。';
    setSensorState(el.sensorMag, el.sensorMagDetail, 'pending', '未初期化');
    setSensorState(el.sensorMotion, el.sensorMotionDetail, 'pending', '未初期化');
    el.bleToggle.checked = false;
    el.blePanel.hidden = true;
    setSensorState(el.sensorBle, el.sensorBleDetail, 'pending', '未使用');

    trendChart.clear();
    el.trendIndicator.dataset.trend = 'flat';
    el.trendIndicator.textContent = TREND_LABELS.flat;
    el.rawValue.textContent = '—';
    el.baselineValue.textContent = '—';
    radar.reset();
    updateGauge(0);
  }

  el.startBtn.addEventListener('click', handleStart);
  el.calibrateBtn.addEventListener('click', calibrate);

  el.sensitivitySlider.addEventListener('input', (e) => {
    state.sensitivity = Number(e.target.value);
  });

  el.volumeSlider.addEventListener('input', (e) => {
    state.volume = Number(e.target.value) / 100;
    state.tone.setVolume(state.volume);
  });

  el.soundToggle.addEventListener('change', (e) => {
    state.soundEnabled = e.target.checked;
    state.tone.setMuted(!state.soundEnabled);
  });

  el.bleToggle.addEventListener('change', (e) => {
    toggleBle(e.target.checked);
  });

  state.tone.setVolume(state.volume);
  updateGauge(0);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
