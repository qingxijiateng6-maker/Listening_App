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
        <span className="historyNavigationTitle">保存した表現</span>
        <span className="historyNavigationDescription">
          動画で保存した表現を一覧で確認できます。
        </span>
      </Link>
    </section>
  );
}
