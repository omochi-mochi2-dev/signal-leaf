import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, startWith, Subject } from 'rxjs';
import { Sensors } from './sensors';

/**
 * ダッシュボードコンポーネント
 * * 【設計意図】
 * センサー（RxJSストリーム）を Signals に変換して同期し、
 * Zoneless 環境下でのピンポイントな DOM 更新を実現します。
 * * 【アーキテクチャ】
 * 1. Hierarchical DI & Lifecycle Sync:
 * Sensors サービスを providers に登録し、コンポーネントとライフサイクルを強制同期。
 * インスタンスの生存期間を画面単位に絞ることで、確実なメモリ解放を担保します。
 * * 2. Reactive Pipeline Integration (RxJS + Signals):
 * 「時間の制御（debounceTime 等）」は RxJS で、「最終的な状態の同期」は Signals で分担。
 * ユーザーの非連続な入力を、計算コストを抑えつつリアクティブに表示へ反映させます。
 * * 3. 決定論的な初期化順序（Hoisting-safe design）:
 * プロパティを「情報の源泉（Source）」→「変換（Transform）」→「派生状態（Derived）」の
 * 順で物理的に配置。JS の巻き上げや初期化順序に依存しない、堅牢な依存関係を構築しています。
 * * 4. 責任あるクリーンアップ（Producer Accountability）:
 * toSignal による自動購読解除に加え、ngOnDestroy で Subject を明示的に complete 処理。
 * オブザーバーリストの完全解放まで責任を持つ、大規模開発に耐えうるメモリ管理を実証します。
 */
@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  providers: [Sensors], // ライフサイクル管理の局所化
})
export class Dashboard implements OnDestroy {
  private readonly sensorsService = inject(Sensors);

  //--- 永続的な状態（将来的に編集可能にする想定） ---
  nodeId = signal('HORRIDUS-001');
  plantName = signal('Encephalartos horridus'); // 植物の名前
  nickname = signal('Blue Diamond'); // 植物のニックネーム
  marketValue = signal(850000); // 現行の価値
  droughtThreshold = signal<number>(30); // 水分量（干ばつ）の閾値
  overwetThreshold = signal<number>(70); // 水分量（多湿）の閾値

  // --- リアルタイムな動的状態 ---
  /**
   * RxJS ストリームの Signal 化
   * toSignal を使うことで、非同期データの「最新の値」を宣言的に取得。
   * Zoneless 環境では、Signal の値が更新された瞬間のみ検知され、DOM が最小限に書き換わります。
   * * 【追記：requireSync の活用】
   * Sensors 側の startWith を信頼し、Dashboard 側での redundant な初期値定義を排除。
   * ストリームの同期的な初動を保証し、型から undefined を消失させます。
   */
  humidity = toSignal(this.sensorsService.humidity$, { requireSync: true }); // 湿度 (%)
  temperature = toSignal(this.sensorsService.temperature$, { requireSync: true }); // 温度 (℃)

  /**
   * 派生状態（Derived State）
   * 湿度の Signal に依存し、閾値を超えた場合に自動で評価を再計算します。
   * Angular 21/22 における「Push（値の発生）」から「Pull（値の同期）」への回帰を体現。
   */
  condition = computed(() => {
    const h = this.humidity();
    if (h < this.droughtThreshold()) return { label: 'Drought', color: 'text-red-500' };
    if (h > this.overwetThreshold()) return { label: 'Overwet', color: 'text-blue-500' };
    return { label: 'Optimal', color: 'text-emerald-500' };
  });

  // 情報のソースと、加工された Signal をセットで置く
  private readonly searchSubject = new Subject<string>();
  /**
   * 検索クエリの Signal
   * 【設計意図】
   * RxJS オペレーターを用いて、ユーザーの入力イベントを「検索ワード」という状態へ昇華させます。
   * 1. debounceTime(3000): 3秒間の静止を待つことで、タイピング中の過剰な再計算を抑制。
   * 2. distinctUntilChanged: 内容に変化がない場合は後続の処理をスキップ。
   * 3. toSignal: 変換された Observable は、Angular のクリーンアップ機構により
   * コンポーネント破棄時に自動で購読解除（unsubscribe）されるため、メモリリークを防止できます。
   */
  readonly searchQuery = toSignal(this.searchSubject.pipe(debounceTime(3000), distinctUntilChanged(), startWith('')), {
    initialValue: '',
  });

  /**
   * フィルタリング済みログ
   * 【アーキテクチャ】
   * 検索ワード（searchQuery）と全ログ（logs）をソースとする派生 Signal です。
   * 依存するいずれかの Signal が更新された際、Lazy（必要時のみ）かつ効率的に再計算を実行します。
   * これにより、HTML 側では常に「今出すべきリスト」だけを宣言的に扱うことが可能になります。
   */
  readonly filteredLogs = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const allLogs = this.sensorsService.logs();
    if (!query) return allLogs;
    return allLogs.filter((log) => log.msg.toLowerCase().includes(query) || log.type.toLowerCase().includes(query));
  });

  // --- UI 状態管理 ---
  isWatering = signal(false); // ボタンの非活性化フラグ
  toast = signal<{ msg: string; type: 'success' | 'error' } | null>(null); // トーストの状態。null なら非表示
  private toastTimerId: any = null; // タイマーIDを保持

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

  /**
   * コンストラクタ
   * 【設計意図】
   * コンポーネントのライフサイクル開始に合わせて、サービスへ必要な設定値（ID、閾値）を注入。
   * 多湿（Overwet）閾値に関しては、センサー側コメントの通り現状アクション（ファン駆動等）が
   * 不能なフェーズであるため、監視初期化の対象からは意図的に除外しています。
   */
  constructor() {
    // コンポーネント生成時に ID と「今必要な」閾値を叩き込む
    this.sensorsService.init(this.nodeId(), this.droughtThreshold());
  }

  /**
   * クリーンアップ
   * 【設計意図】
   * コンポーネントのライフサイクル終了に伴い、管理下のリソースを完全に解放します。
   * * 1. searchSubject.complete():
   * toSignal 側での自動購読解除によりデータ流入は止まるものの、
   * Subject 自体を完結させなければ内部の Observer（購読者）リストが保持され続ける可能性があります。
   * 明示的に complete させることでリストを空にし、
   * 大規模・長寿命なアプリケーションで懸念される「塵も積もれば」のメモリリークを未然に防ぐ作法です。
   * * 2. clearTimeout:
   * ブラウザ API である setTimeout は RxJS や Angular の管理外であるため、
   * 破棄後にサイドエフェクト（トースト表示など）が実行されないよう確実に阻止します。
   */
  ngOnDestroy() {
    this.searchSubject.complete();

    if (this.toastTimerId) {
      clearTimeout(this.toastTimerId);
    }
  }

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
          this.toast.set({ msg: 'Success: Hydrated!', type: 'success' });
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
   * 検索入力ハンドラー
   * 【設計意図】
   * 命令的（Imperative）な DOM イベントをリアクティブなストリームへ変換する「入り口」です。
   * テンプレート側には「イベントの発生」という事実のみを扱わせ、
   * それに対する「時間の制御（debounce）」や「データの抽出（filter）」といった具体的なロジックは
   * クラス内の宣言的（Declarative）なパイプライン（searchQuery, filteredLogs）に一任。
   * これにより、イベントの発生源（View）と状態の加工ロジック（Logic）の関心を分離しています。
   */
  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchSubject.next(value);
  }
}
