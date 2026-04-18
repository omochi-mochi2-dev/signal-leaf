import { Injectable, OnDestroy } from '@angular/core';
import { interval, map, merge, scan, startWith, Subject } from 'rxjs';

export type WaterResult = { success: true } | { success: false; error: string };

/**
 * センサーデータ生成サービス
 * * 【設計意図】
 * 本サービスは、将来的な IoT デバイス（SwitchBot等）やクラウド側との API 連携を想定し、
 * 定期的なデータ取得を模倣する「疑似ポーリング（Pseudo-polling）」形式で実装しています。
 * RxJS の interval を用いることで、Zoneless 環境下における非同期データの
 * 継続的な流入と、それに対する Signals のリアクティブな反応を検証・実証します。
 * * 【メモリ管理・スコープ】
 * 1. スコープの局所化:
 * providedIn: 'root' を避け、コンポーネントの providers に登録することを前提としています。
 * これにより、ダッシュボード画面の破棄と同時に本インスタンスも破棄され、リソースが完全に解放されます。
 * 2. クリーンアップの自動化:
 * Subject 自体は値を蓄積しませんが、ngOnDestroy で明示的に complete() させることで、
 * この Subject を源流とする全ての RxJS ストリームの「蛇口」を確実に閉じ、ゾンビ処理を防止します。
 */
@Injectable()
export class Sensors implements OnDestroy {
  // 水やりイベントを流し込むための口
  private readonly waterSubject = new Subject<number>();
  // SwitchBot の 1 回の動作（例：5秒散水）で上昇する水分量の推定値
  private readonly WATERING_INCREMENT = 15;

  // コンポーネントが消える時、このサービスも道連れに破棄されてここが動く
  ngOnDestroy() {
    this.waterSubject.complete(); // 水やりイベントを流し込むための口を完全に閉める
  }

  /**
   * 水分量のストリーム
   * 物理モデル: 自然界の「揮発（Evaporation）」を再現。
   * 外部からの干渉（applyWater）がない限り、毎秒 0.05%〜0.15% ずつ単調減少します。
   * merge された interval 等は、toSignal の自動 unsubscribe によって連鎖的に停止します。
   */
  humidity$ = merge(
    // 毎秒 0.05% 〜 0.15% ずつ減っていく（揮発）
    interval(1000).pipe(map(() => -(Math.random() * 0.1 + 0.05))),
    // ボタン押下後の成功時に {WATERING_INCREMENT}% 増加させるイベント
    this.waterSubject.asObservable(),
  ).pipe(
    // scan がリデューサーとして全ての増減を現在の累積値に適用
    // 0% 〜 100% の範囲にクランプ
    scan((acc, val) => Math.min(Math.max(acc + val, 0), 100), 42),
    map((v) => Number(v.toFixed(1))),
    startWith(42),
  );

  /**
   * 温度のストリーム
   * 物理モデル: サーモスタットによる「復元力（Restoration Force）」を再現。
   * 単純なランダムウォークではなく、設定温度（25.4℃）へ引き戻す力を加えることで
   * 長時間稼働しても現実的な数値範囲（ドリフト防止）を維持します。
   * interval 等は、toSignal の自動 unsubscribe によって連鎖的に停止します。
   */
  temperature$ = interval(1500).pipe(
    scan((current) => {
      const target = 25.4;
      const diff = target - current;
      // 復元係数 0.1: ターゲットとの差の 10% を戻す
      const restoreForce = diff * 0.1;
      // 環境ノイズ（エアコンの揺らぎ等）を付与
      const noise = (Math.random() - 0.5) * 0.4;

      return current + restoreForce + noise;
    }, 25.4),
    map((v) => Number(v.toFixed(1))),
    startWith(25.4),
  );

  /**
   * 水やりアクション (Action: 単発の命令)
   * SwitchBot 等の外部デバイスへの副作用を伴うため、Observable ではなく
   * ライフサイクルが自明な Promise で実装し、成功時のみ内部状態を更新します。
   */
  async applyWater(): Promise<WaterResult> {
    // 通信を模した待機
    await new Promise((r) => setTimeout(r, 1000));

    // 10%の確率で失敗をシミュレート
    if (Math.random() < 0.1) {
      // 失敗の理由をランダムにシミュレート（IoTのリアリティ）
      const errorMsg = Math.random() > 0.5 ? 'Device Offline: Check connection' : 'Water Empty: Refill the tank';
      return { success: false, error: errorMsg };
    }

    this.waterSubject.next(this.WATERING_INCREMENT);
    return { success: true };
  }
}
