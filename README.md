# Signal Leaf 🌿

## 📌 コンセプト：「本当に Angular の状態管理は弱いのか？」

本作は、「Angular の状態管理は複雑で外部ライブラリ（NgRx 等）が必須である」という一部の誤解に対する、モダン Angular（Signals × RxJS）を用いた技術的な反証（Proof of Concept）です。

外部のステート管理ライブラリを一切使用せず、Angular の標準機能のみで**堅牢で、メモリセーフで、Zoneless 時代に適応したリアクティブ・アーキテクチャ**が構築できることを実証しています。

## 💡 背景：なぜ Angular の状態管理は「複雑」と言われるのか？

私は一つの仮説を立てています。
「Angular は難しい」とされる要因の多くは、**「情報の性質（Pull型かPush型か）」と「非同期処理（PromiseかRxJSか）」のミスマッチ**、特に以下のような **"過剰な subscribe"** に起因しているのではないでしょうか。

- 本来 Promise で済む単発のデータ取得（Pull型）を、慣習的に RxJS の `subscribe` で記述してしまう。
- その結果、コンポーネント側で命令的な状態更新が増え、手動の購読管理（unsubscribe）漏れによるメモリリークを招く。

本作では、この「過剰な subscribe」を徹底的に排除し、適材適所の技術選定を行うことで、この問題を解消しています。

## ✨ アーキテクチャの要点

### 1. 「時間（RxJS）」と「状態（Signals）」の明確な分離

- **継続的な変化 (RxJS):** センサーデータの疑似ポーリング（`interval`）や入力の流量制御（`debounceTime`）など、時間軸の制御が必要な箇所に限定。
- **最新の状態 (Signals):** `toSignal` を通じてストリームを「常に Pull 可能な状態」へ変換。 これにより、テンプレートやロジック側では `async` パイプや `subscribe` なしで安全に値を参照できます。

### 2. 命令的アクション（Promise）による脱・過剰購読

給水アクション（`applyWater`）のような「一度きりの命令」は、あえて `Promise` で実装しています。
アクションの成否判定やトースト表示といった副作用を命令的なフロー（`then/finally`）で記述することで、不必要な `subscribe` の連鎖を断ち切り、見通しの良いコードを実現しています。

### 3. 宣言的な派生状態（Derived State）

`computed` をフル活用し、検索ワードやセンサー値に連動するフィルタリング処理を純粋関数的に定義しています。
「いつ更新するか」ではなく「どうあるべきか」を記述するだけで、常に整合性の取れた表示を維持します。

### 4. プロデューサーとしての責任とメモリ管理

サービスをコンポーネントレベルの `providers` に登録する Hierarchical DI を採用し、ライフサイクルを完全に同期。
`ngOnDestroy` での `Subject.complete()` やタイマー解除を徹底し、大規模開発でも「塵も積もれば」のメモリリークを許さない設計を実証しています。

## 🚀 主な機能

- **リアルタイム環境ダッシュボード:** 湿度・温度のリアルタイムトラッキング。
- **命令的アクション (Hydration):** 副作用を伴う非同期アクションのシミュレート。
- **スマート検索:** RxJS による 3 秒の流量制御を伴うログフィルタリング。
- **Zoneless Ready:** Signals による高効率な差分レンダリング。

## 🛠️ 技術スタック

- **Framework:** Angular v21 (Modern Signals & Zoneless Architecture)
- **State Management:** Angular Signals API & RxJS (Standard-based reactive flow)
- **Styling:** Tailwind CSS (App-like 100vh layout)

## 💻 Getting Started

### ⚡ Live Demo

環境構築不要で、ブラウザ上ですぐに実際の動作とリアクティブな挙動を確認できます。

[Open in CodeSandbox](https://codesandbox.io/p/github/omochi-mochi2-dev/signal-leaf/main)

### 🛠️ Local Development

手元でコードを動かし、RxJS と Signals の統合アーキテクチャを直接検証したい場合はこちらの手順をご利用ください。

```bash
# 1. リポジトリのクローン
git clone https://github.com/omochi-mochi2-dev/signal-leaf.git
cd リポジトリ名

# 2. 依存関係のインストール
npm ci

# 3. 開発サーバーの起動
npm run start
```

起動後、ブラウザで http://localhost:4200/ にアクセスしてください。
