# お宝レーダー (TreasureRadar)

スマホの地磁気センサーを使って地中の金属反応を検知し、レーダー風の画面・グラフ・音で知らせる宝探し補助 PWA(Progressive Web App)です。

🔗 **公開URL: https://fuuchan-lab.github.io/treasure-radar/**(HTTPS配信のため、スマホのセンサー・Bluetooth APIが利用できます)

## 主な機能

- **地磁気センサーによる金属検知**: Android (Chrome系) では Generic Sensor API (`Magnetometer`) の実測値を使用。強磁性体(鉄・ニッケルなど)による地磁気の歪みを検知します。iOS Safari など Magnetometer API 非対応の端末では金属検知機能自体を利用できません(詳細は下記「技術的な制約」参照)。
- **方位連動レーダー表示**: ジャイロ・方位センサーでスマホが向いている方角を推定し、その方角で記録した反応レベルをレーダー画面上にマッピングします。方角そのものはセンサーの直接検知ではなく、推定方位です。
- **スキャン姿勢ガイド**: 加速度計・ジャイロスコープで「水平を保っているか」「動かす速度が適切か」をチェックし、画面上のチップで知らせます。
- **磁場推移グラフ**: 直近の地磁気値をリアルタイムの折れ線グラフで表示し、基準値からの上昇・下降傾向を表示します。
- **音声フィードバック**: 反応レベルに応じてビープ音の周波数・間隔が変化します。Bluetoothヘッドセットを接続している場合は OS が自動的にそちらへ音声を出力します。
- **Bluetooth 補助スキャン(実験的)**: 周辺 BLE デバイスの RSSI 揺らぎを参考表示します。**金属検知の精度には寄与しません**(電磁誘導方式の金属探知機とは原理が異なります)。

## 技術的な制約(必ずお読みください)

- Bluetooth の電波で地中の金属を検知することはできません。本アプリの主軸は地磁気センサーです。
- iOS (Safari) など Magnetometer API に対応していない端末では、**金属検知機能自体を利用できません**。当初はコンパス方位(`DeviceOrientationEvent`)の変化を代替指標として使う簡易モードを実装していましたが、実機検証の結果「基準方位からスマホの向きを変えるだけで反応し、基準方位を向けている間は常に無反応」という、金属の有無と無関係な挙動になることが確認されたため廃止しました。コンパス方位は「ユーザーが今スマホをどちらに向けているか」を表す値であり、ユーザーの回転操作と金属による地磁気の歪みを区別する手段がないという原理的な限界によるものです。
- スマホ単体で「地面からの高さ(cm)」を正確に測ることはできません。水平を保つことをガイドするのみです。
- 非磁性金属(アルミ・金・銀など)は地磁気をほとんど歪めないため、検知が困難です。

## ローカルでの動作確認

センサー系 API (Magnetometer, DeviceOrientationEvent, Web Bluetooth) は **HTTPS または localhost** でのみ動作します。

```bash
npx serve .
```

スマホ実機で試す場合は HTTPS が必要なので、以下のいずれかを使ってトンネリングしてください。

```bash
npx localtunnel --port 3000
# または
ngrok http 3000
```

## GitHub Pages での公開

このリポジトリを GitHub にプッシュし、Settings > Pages でブランチを指定すると HTTPS 付きで公開されます(センサー・Bluetooth API の要件を満たします)。

## 将来の Google Play 公開(TWA)について

PWA のまま Play Store に公開するには [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) または [PWABuilder](https://www.pwabuilder.com/) を使って TWA (Trusted Web Activity)化します。

1. GitHub Pages 等で HTTPS 公開した URL を用意する
2. `manifest.json` が Play ストア要件(アイコン・名前・start_url など)を満たしていることを確認する
3. Bubblewrap CLI で Android プロジェクトを生成し、`assetlinks.json` をサイトの `/.well-known/` 以下に配置してドメイン所有を証明する
4. 生成された AAB を Google Play Console にアップロードする

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面構造 |
| `style.css` | スタイル(ライト/ダーク対応) |
| `sensors.js` | 地磁気センサー・モーション・BLE のセンサー抽象化 |
| `audio.js` | ビープ音フィードバック |
| `chart.js` | 磁場推移の折れ線グラフ |
| `radar.js` | 方位連動レーダー表示 |
| `app.js` | 画面とセンサーを統合するメインロジック |
| `manifest.json` / `sw.js` | PWA 化(インストール・簡易オフラインキャッシュ) |
