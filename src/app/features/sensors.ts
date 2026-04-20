import { Injectable, OnDestroy, signal } from '@angular/core';
import { interval, map, merge, scan, shareReplay, startWith, Subject } from 'rxjs';

export type WaterResult = { success: true } | { success: false; error: string };

// ログの種類を3つに限定する
export type LogType = 'SYSTEM' | 'ACTION' | 'ALERT';

// 1件のログが持つデータのルール（設計図）
export interface LogEntry {
  id: string; // ログの背番号（画面を高速に書き換えるための目印）
  nodeId: string;
  time: Date; // いつ起きたか
  type: LogType; // どの種類のログか
  msg: string; // メッセージ内容
}

/**
 * センサーデータ生成サービス
 * * 【設計意図】
 * 将来的な IoT デバイスやクラウド API 連携を見据え、
 * 継続的な状態変化を模倣する「疑似ポーリング」形式と、
 * 離散的な命令（API）を想定した形式を組み合わせて実装しています。
 * * 【アーキテクチャ】
 * 1. 非同期データフローの原典:
 * interval や Subject を組み合わせ、Zoneless 環境下における継続的な「変化」の源泉となります。
 * * 2. 命令的アクションとログの統合:
 * 物理デバイスへの副作用（水やり等）を Promise で扱い、
 * その結果をログストリームへ還元。成否のフィードバックループをカプセル化しています。
 * * 3. プロデューサーとしてのリソース解放:
 * 自身が発行するストリーム（Subject）に対し、破棄時の完結（complete）を保証。
 * 購読側（Dashboard等）の安全性を下流から支える設計としています。
 */
@Injectable()
export class Sensors implements OnDestroy {
  // 水やりイベントを流し込むための口
  private readonly waterSubject = new Subject<number>();
  // SwitchBot の 1 回の動作（例：5秒散水）で上昇する水分量の推定値
  private readonly WATERING_INCREMENT = 15;
  // 空っぽの配列を入れた「通知ベル付きの箱」、Dashboard から参照できるように readonly で公開
  readonly logs = signal<LogEntry[]>([]);
  // 状態として Node ID を持たせる（Signalにしておくと後で便利）
  private readonly nodeId = signal<string>('UNKNOWN-NODE');
  // 状態として水分量（干ばつ）の閾値を持たせる
  private readonly droughtThreshold = signal<number>(0);
  // 水分量（多湿）は今はどうしようもない（ファンを回す機能とか除湿器機能がない）ので一旦貰わない

  /**
   * 初期化メソッド
   * 【設計意図】
   * 植物ごとの特性（閾値）やデバイスIDを動的に注入します。
   * ログには「現在のアクションに直結する」下限閾値のみを記録し、運用ノイズを削減します。
   */
  init(nodeId: string, droughtThreshold: number) {
    this.nodeId.set(nodeId);
    this.droughtThreshold.set(droughtThreshold);
    this.addLog('SYSTEM', `System online: Drought threshold: ${this.droughtThreshold()}%`);
  }

  // コンポーネントが消える時、このサービスも道連れに破棄されてここが動く
  ngOnDestroy() {
    this.waterSubject.complete(); // 水やりイベントを流し込むための口を完全に閉める
  }

  /**
   * 水分量のストリーム
   * 物理モデル: 自然界の「揮発（Evaporation）」を再現。
   * 外部からの干渉（applyWater）がない限り、毎秒 0.05%〜0.15% ずつ単調減少します。
   * merge された interval 等は、toSignal の自動 unsubscribe によって連鎖的に停止します。
   * * 【追記：DRYリファクタリング】
   * startWith を scan の前に配置することで、初期値を「計算の基点」と「UIの初動値」として一元管理。
   * これにより、scan のシード値と startWith の値の二重管理（不整合のリスク）を解消しています。
   */
  humidity$ = merge(
    // 毎秒 0.05% 〜 0.15% ずつ減っていく（揮発）
    interval(1000).pipe(map(() => -(Math.random() * 0.1 + 0.05))),
    // ボタン押下後の成功時に {WATERING_INCREMENT}% 増加させるイベント
    this.waterSubject.asObservable(),
  ).pipe(
    // 初期値をここで設定することでscanの第二引数の指定を省略
    startWith(35),
    // scan がリデューサーとして全ての増減を現在の累積値に適用
    scan((prev, curr) => {
      // 0% 〜 100% の範囲にクランプ
      const rawNext = Math.min(Math.max(prev + curr, 0), 100);
      // ここで小数点第1位に固定
      const next = Number(rawNext.toFixed(1));

      // 10倍整数比較で、前回の状態と今の状態をシビアにチェック
      const prevIsDrought = prev * 10 < this.droughtThreshold() * 10;
      const nextIsDrought = next * 10 < this.droughtThreshold() * 10;

      // 「前回は平和」かつ「今回は乾燥」の瞬間だけ副作用（ログ）を発動
      if (!prevIsDrought && nextIsDrought) {
        this.addLog('ALERT', `Warning: Drought detected (${next}%). Need water!`);
      }

      // 画面（UI）には純粋な number 型を返す
      return next;
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /**
   * 温度のストリーム
   * 物理モデル: サーモスタットによる「復元力（Restoration Force）」を再現。
   * 単純なランダムウォークではなく、設定温度（25.4℃）へ引き戻す力を加えることで
   * 長時間稼働しても現実的な数値範囲（ドリフト防止）を維持します。
   * interval 等は、toSignal の自動 unsubscribe によって連鎖的に停止します。
   */
  temperature$ = interval(1500).pipe(
    // 初期値をここで設定することでscanの第二引数の指定を省略
    startWith(25.4),
    scan((curr) => {
      const target = 25.4;
      const diff = target - curr;
      // 復元係数 0.1: ターゲットとの差の 10% を戻す
      const restoreForce = diff * 0.1;
      // 環境ノイズ（エアコンの揺らぎ等）を付与
      const noise = (Math.random() - 0.5) * 0.4;

      return curr + restoreForce + noise;
    }),
    map((v) => Number(v.toFixed(1))),
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
      // 失敗ログを保存
      this.addLog('ACTION', `Hydration failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    this.waterSubject.next(this.WATERING_INCREMENT);
    // 成功ログを保存
    this.addLog('ACTION', 'Hydration completed successfully.');
    return { success: true };
  }

  /**
   * 内部ログ記録メソッド
   * ログの正規化（ID・時刻付与）を一括で行い、
   * 配列をイミュータブルに更新（先頭追加）することでSignal を通じて最新の履歴をリアクティブに通知します。
   */
  addLog(type: LogType, msg: string) {
    // update は「今の箱の中身（curr）」を取り出して、新しい中身に差し替える機能
    this.logs.update((curr) => {
      // 新しいログのデータを作る
      const newLog: LogEntry = {
        id: crypto.randomUUID(), // かぶらないランダムなIDを自動生成
        nodeId: this.nodeId(),
        time: new Date(), // 今の時間
        type: type,
        msg: msg,
      };

      // [新しいログ, ...今までのログ全部] という順番に並べ替えて、.slice(0, 50) で上から50個だけ残して古いものを捨てる
      return [newLog, ...curr].slice(0, 50);
    });
  }
}
