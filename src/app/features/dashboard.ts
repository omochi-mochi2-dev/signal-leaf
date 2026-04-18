import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Sensors } from './sensors';

/**
 * ダッシュボードコンポーネント
 * センサー（RxJSストリーム）を Signals に変換して同期し、
 * Zoneless 環境下でのピンポイントな DOM 更新を実現します。
 */
@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
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

  water() {
    // TODO: 水やりイベントを Service 経由でストリームに merge する予定
    console.log('Give water');
  }
}
