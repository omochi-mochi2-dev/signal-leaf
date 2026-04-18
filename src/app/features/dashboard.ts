import { DecimalPipe } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  // 基本データ: Singnals
  plantName = signal('Encephalartos horridus'); // TODO: 後で変える機能作る
  nickname = signal('Blue Diamond'); // TODO: 後で変える機能作る

  // センサーデータ：ここを後で RxJS でプルプル動かします
  humidity = signal(42); // 湿度 (%)
  temperature = signal(25.4); // 温度 (℃)

  // 計算値：computed（Signals の真骨頂）
  // 湿度が 30% を切ると「Drought（干ばつ）」、70% を超えると「Overwet（多湿）」
  condition = computed(() => {
    const h = this.humidity();
    if (h < 30) return { label: 'Drought', color: 'text-red-500' };
    if (h > 70) return { label: 'Overwet', color: 'text-blue-500' };
    return { label: 'Optimal', color: 'text-emerald-500' };
  });

  // 資産価値
  marketValue = signal(850000);

  // メソッド：値を更新する
  water() {
    this.humidity.set(85); // 水をあげると湿度が跳ね上がる
    // この瞬間、condition() も自動的に 'Overwet' に再計算される
  }
}
