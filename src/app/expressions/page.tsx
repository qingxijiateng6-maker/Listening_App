import Link from "next/link";

export default function ExpressionsPage() {
  return (
    <main>
      <section className="historyListSection">
        <div className="historyListHeader">
          <div>
            <h1>登録した表現</h1>
            <p>ユーザーが自分で登録した表現の一覧ページです。</p>
          </div>
        </div>
        <div className="historyEmptyCard">
          <h2>まだ表現はありません</h2>
          <p>「この表現を登録する」機能は後続で実装予定です。</p>
        </div>
        <p className="learningBackLink">
          <Link href="/">トップへ戻る</Link>
        </p>
      </section>
    </main>
  );
}
