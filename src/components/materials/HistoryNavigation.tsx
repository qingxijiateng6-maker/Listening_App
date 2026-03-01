import Link from "next/link";

export function HistoryNavigation() {
  return (
    <section className="historyNavigationSection" aria-label="登録履歴への移動">
      <Link href="/materials" className="historyNavigationCard">
        <span className="historyNavigationTitle">登録した動画</span>
        <span className="historyNavigationDescription">
          これまで登録した動画の一覧を開き、保存内容をそのまま確認できます。
        </span>
      </Link>
      <Link href="/expressions" className="historyNavigationCard">
        <span className="historyNavigationTitle">登録した表現</span>
        <span className="historyNavigationDescription">
          自分で登録した表現の一覧ページへ移動します。
        </span>
      </Link>
    </section>
  );
}
