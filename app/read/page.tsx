"use client";
import React, { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/db"; // <-- import the client

interface NewsItem {
  id: string | number;
  title: string;
  author?: string;             // not in DB; keep for future
  source?: string;             // from DB: source
  summary: string;             // from DB: summary
  imageUrl?: string;           // from DB: image_url
  publishedAt?: string;        // from DB: published_at
  sourceUrl?: string;          // from DB: source_url
}

const CATEGORIES = [
  "India","Business","Politics","Sports","Technology","Startups","Entertainement",
  "International","Automobile","Science","Travel","Miscallenious","fashion",
  "Education","Health & Fitness",
] as const;

type Category = typeof CATEGORIES[number];

function formatWhen(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", year: "numeric",
  });
}

export default function InshortsStylePage() {
  const [category, setCategory] = useState<Category>("India");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 🔽 Pull straight from Supabase (filtered by category)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        let q = supabaseBrowser
          .from("news_articles")
          .select("*")
          .order("published_at", { ascending: false })
          .limit(20);

        if (category) q = q.eq("category", category);

        const { data, error } = await q;

        if (error) throw new Error(error.message);

        const mapped: NewsItem[] = (data || []).map((row: any) => ({
          id: row.id,
          title: row.title,
          summary: row.summary,
          imageUrl: row.image_url ?? undefined,
          publishedAt: row.published_at ?? undefined,
          sourceUrl: row.source_url ?? undefined,
          source: row.source ?? undefined,
        }));

        if (!cancelled) setItems(mapped);
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setItems([]);
          setError("Failed to load news");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [category]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
          <button
            className="inline-flex items-center justify-center rounded-xl border border-gray-200 p-2 hover:bg-gray-100"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M3.75 5.25a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Zm0 6a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Zm.75 5.25a.75.75 0 0 0 0 1.5h15a.75.75 0 0 0 0-1.5h-15Z" clipRule="evenodd" />
            </svg>
          </button>

          <div className='text-3xl font-bold border border-gray-200 p-1 rounded-md'>Short News</div>
        </div>

        <div className="bg-gradient-to-r from-emerald-500 via-emerald-600 to-emerald-700 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 text-sm sm:text-base flex items-center gap-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/20">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M12 2.25a.75.75 0 0 1 .75.75v17.19l4.72-4.72a.75.75 0 1 1 1.06 1.06l-6 6a.75.75 0 0 1-1.06 0l-6-6a.75.75 0 0 1 1.06-1.06l4.72 4.72V3a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
              </svg>
            </span>
            <p className="font-medium">For the best experience use our app on your smartphone</p>
          </div>
        </div>
      </header>

      {/* Drawer overlay */}
      {drawerOpen && (
        <button
          aria-label="Close menu overlay"
          className="fixed inset-0 z-30 bg-black/40"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Drawer with categories */}
      <aside
        aria-label="Categories menu"
        className={`fixed left-0 top-0 z-40 h-full w-72 max-w-[85vw] transform bg-white shadow-xl border-r border-gray-200 transition-transform duration-300 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold">Menu</span>
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>
        <nav className="py-2 max-h-[calc(100vh-56px)] overflow-auto">
          <ul>
            {CATEGORIES.map((cat) => (
              <li key={cat}>
                <button
                  onClick={() => { setCategory(cat); setDrawerOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 focus:outline-none ${
                    category === cat ? "bg-gray-100 font-semibold" : ""
                  }`}
                >
                  {cat}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Feed */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {loading && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Loading…</div>
        )}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}
        {!loading && items.length === 0 && !error && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">No news found.</div>
        )}

        {items.map((n) => (
          <article key={n.id} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-[280px,1fr] gap-4">
              <div className="relative aspect-[16/9] sm:aspect-auto sm:h-44 overflow-hidden rounded-xl bg-gray-100">
                {n.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.imageUrl} alt={n.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400 text-sm">No image</div>
                )}
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold leading-snug">{n.title}</h2>
                <div className="text-xs text-gray-500">
                  {n.author ? `short by ${n.author}` : "short"}
                  {n.publishedAt ? ` / ${formatWhen(n.publishedAt)}` : null}
                </div>
                <p className="text-sm leading-6 text-gray-700">{n.summary}</p>
                {n.source && (
                  <a
                    href={n.sourceUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm font-medium text-emerald-700 hover:underline"
                  >
                    read more at {n.source}
                  </a>
                )}
              </div>
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}
