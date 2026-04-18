import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Sensors } from './sensors';

/**
 * ダッシュボードコンポーネント
 * * 【設計意図】
 * センサー（RxJSストリーム）を Signals に変換して同期し、
 * Zoneless 環境下でのピンポイントな DOM 更新を実現します。
 * * 【アーキテクチャ】
 * 1. Hierarchical DI:
 * Sensors サービスを providers に登録し、コンポーネントとライフサイクルを同期。
 * 画面遷移時の確実なメモリ解放を担保します。
 * 2. 状態（State）と命令（Action）の分離:
 * 継続的な変化は Signals (toSignal) で同期し、単発のアクションは Promise (.then) で処理。
 * 性質に応じた最適な技術選定を提示します。
 */
@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  providers: [Sensors], // ライフサイクル管理の局所化
})
export class Dashboard {
  private readonly sensorsService = inject(Sensors);

  //--- 永続的な状態（将来的に編集可能にする想定） ---
  plantName = signal('Encephalartos horridus'); // 植物の名前
  nickname = signal('Blue Diamond'); // 植物のニックネーム
  marketValue = signal(850000); // 現行の価値

  // --- リアルタイムな動的状態 ---
  /**
   * RxJS ストリームの Signal 化
   * toSignal を使うことで、非同期データの「最新の値」を宣言的に取得。
   * Zoneless 環境では、Signal の値が更新された瞬間のみ検知され、DOM が最小限に書き換わります。
   */
  humidity = toSignal(this.sensorsService.humidity$, { initialValue: 42 }); // 湿度 (%)
  temperature = toSignal(this.sensorsService.temperature$, { initialValue: 25.4 }); // 温度 (℃)

  // --- UI 状態管理 ---
  isWatering = signal(false); // ボタンの非活性化フラグ
  toast = signal<{ msg: string; type: 'success' | 'error' } | null>(null); // トーストの状態。null なら非表示
  private toastTimerId: any = null; // タイマーIDを保持

  /**
   * 派生状態（Derived State）
   * 湿度の Signal に依存し、閾値を超えた場合に自動で評価を再計算します。
   * Angular 21/22 における「Push（値の発生）」から「Pull（値の同期）」への回帰を体現。
   */
  condition = computed(() => {
    const h = this.humidity();
    if (h < 30) return { label: 'Drought', color: 'text-red-500' };
    if (h > 70) return { label: 'Overwet', color: 'text-blue-500' };
    return { label: 'Optimal', color: 'text-emerald-500' };
  });

  /**
   * ユーザーアクション（給水）
   * 【設計意図】
   * 常に変化する「状態」ではないため、あえて Signal に変換せず、
   * ライフサイクルが自明な Promise (then/finally) で直接ハンドリングしています。
   * これにより、アクションの成否判定とそれに伴う副作用（トースト等）の
   * 実行順序を、命令的なフローとして見通しよく記述しています。
   *
   * 1. 二重送信防止 (isWatering によるガード)
   * 2. 物理デバイスへの副作用実行 (applyWater)
   * 3. 実行結果のフィードバック (toast 表示 & 競合タイマー解除)
   * 4. 非同期処理のクリーンアップ (finally によるフラグ復帰)
   */
  water() {
    if (this.isWatering()) return; // ボタンは disable になるけど念のため
    this.isWatering.set(true); // ボタンを disable 化

    this.sensorsService
      .applyWater()
      .then((result) => {
        // タイマー競合対策：先行するタイマーを破棄し、表示時間を最新に更新
        if (this.toastTimerId) {
          clearTimeout(this.toastTimerId);
        }

        // サービスから返却された詳細な実行結果（成功 or 失敗理由）を通知に反映
        if (result.success) {
          this.toast.set({ msg: 'Success: Hydrated! 💧', type: 'success' });
        } else {
          this.toast.set({ msg: `Error: ${result.error}`, type: 'error' });
        }

        // 指定時間後に通知を自動消去。IDを保持することで次回の実行時にキャンセル可能になる
        this.toastTimerId = setTimeout(() => {
          this.toast.set(null);
          this.toastTimerId = null;
        }, 4000);
      })
      .finally(() => {
        this.isWatering.set(false); // ボタンを able 化
      });
  }

  /**
   * ボタンの状態クラス（Dynamic）
   * FOUC (Flash of Unstyled Content) 対策のため、
   * 静的な骨格スタイルは HTML 側に、動的な表情のみを本 Signal で管理・合成します。
   */
  buttonStateClass = computed(() => {
    return this.isWatering()
      ? 'bg-slate-400 cursor-not-allowed shadow-none transform-none' // 実行中
      : 'bg-sky-500 shadow-lg shadow-sky-200 hover:bg-sky-600 active:scale-95 cursor-pointer'; // 待機中
  });

  /**
   * トーストの動的クラス（表情）
   * 状態（Success/Error）に基づくスタイル定義を TS 側に集約し、テンプレートの宣言的記述を維持します。
   */
  toastClass = computed(() => {
    const t = this.toast();
    if (!t) return '';
    return t.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500';
  });
}
