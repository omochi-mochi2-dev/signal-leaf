import { Injectable } from '@angular/core';
import { interval, map, scan, startWith } from 'rxjs';

/**
 * センサーデータ生成サービス
 * * 【設計意図】
 * 本サービスは、将来的な IoT デバイス（SwitchBot等）やクラウド側との API 連携を想定し、
 * 定期的なデータ取得を模倣する「疑似ポーリング（Pseudo-polling）」形式で実装しています。
 * * RxJS の interval を用いることで、Zoneless 環境下における非同期データの
 * 継続的な流入と、それに対する Signals のリアクティブな反応を検証・実証します。
 */
@Injectable({
  providedIn: 'root',
})
export class Sensors {
  /**
   * 湿度のストリーム
   * 物理モデル: 自然界の「揮発（Evaporation）」を再現。
   * 外部からの干渉（給水等）がない限り、毎秒 0.05%〜0.15% ずつ単調減少します。
   */
  humidity$ = interval(1000).pipe(
    // 減少量を計算。常にマイナス値を生成することで「乾いていく」挙動を担保。
    map(() => -(Math.random() * 0.1 + 0.05)),
    // scanオペレーターを状態リデューサーとして利用し、累積値を保持（最小値 0%）。
    scan((acc, val) => Math.max(acc + val, 0), 42),
    map((v) => Number(v.toFixed(1))),
    startWith(42),
  );

  /**
   * 温度のストリーム
   * 物理モデル: サーモスタットによる「復元力（Restoration Force）」を再現。
   * 単純なランダムウォークではなく、設定温度（25.4℃）へ引き戻す力を加えることで
   * 長時間稼働しても現実的な数値範囲（ドリフト防止）を維持します。
   */
  temperature$ = interval(1500).pipe(
    scan((current) => {
      const target = 25.4;
      const diff = target - current;
      // 復元係数 0.1: ターゲットとの差の 10% を戻す。
      const restoreForce = diff * 0.1;
      // 環境ノイズ（エアコンの揺らぎ等）を付与。
      const noise = (Math.random() - 0.5) * 0.4;

      return current + restoreForce + noise;
    }, 25.4),
    map((v) => Number(v.toFixed(1))),
    startWith(25.4),
  );
}
