/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/db";
import Image from "next/image";
import { Loader } from "lucide-react";
import Link from "next/link";

type PreferredCountry = "mauritius" | "uae" | "india";

type UserProfile = {
  id: string;
  preferred_country?: PreferredCountry | null;
};

interface NewsItem {
  id: string | number;
  title: string;
  author?: string;
  source?: string;
  summary: string[];
  imageUrl?: string;
  publishedAt?: string;
  sourceUrl?: string;
}

const CATEGORIES = [
  "All",
  "Business",
  "Politics",
  "Sports",
  "Technology",
  "Startups",
  "Entertainement",
  "International",
  "Automobile",
  "Science",
  "Travel",
  "Miscallenious",
  "fashion",
  "Education",
  "Health & Fitness",
] as const;

const COUNTRY_OPTIONS: Array<{
  value: PreferredCountry;
  label: string;
  table: "news_articles" | "uae_news" | "indian_news";
}> = [
  { value: "mauritius", label: "Mauritius", table: "news_articles" },
  { value: "uae", label: "UAE", table: "uae_news" },
  { value: "india", label: "India", table: "indian_news" },
];

const GUEST_COUNTRY_KEY = "brefnews_guest_country";
const GUEST_PROMPTED_KEY = "brefnews_guest_prompted";

type Category = (typeof CATEGORIES)[number];

function sanitizePublishedNoise(text: string) {
  return (text || "")
    .replace(
      /\bpublished\b[\s\S]{0,120}?\bby\b[\s\S]{0,80}?(?=(published\b|publi[eé]\b|[.!?]|$))/gi,
      " "
    )
    .replace(
      /\bpubli[eé]\b[\s\S]{0,120}?\bpar\b[\s\S]{0,80}?(?=(published\b|publi[eé]\b|[.!?]|$))/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSummaryForDisplay(input: string) {
  const clean = sanitizePublishedNoise(input);
  if (!clean) return [];

  const normalizeBulletItems = (items: string[]) => {
    const merged: string[] = [];
    let carry = "";

    for (const rawItem of items) {
      const item = `${carry} ${rawItem}`.trim();
      carry = "";
      if (!item) continue;

      const isFragment =
        item.length <= 6 ||
        /^(mr|mrs|ms|dr|prof|shri|smt)\.$/i.test(item) ||
        /^[a-z]\.$/i.test(item);

      if (isFragment) {
        carry = item;
        continue;
      }

      merged.push(item);
    }

    if (carry && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${carry}`.trim();
    }

    return merged;
  };

  if (clean.includes("•")) {
    return normalizeBulletItems(
      clean
      .split(/(?:\r?\n)+|(?=•)/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^•\s*/, "").replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
    );
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25)
    .slice(0, 5);

  if (sentences.length === 0) return [clean];
  const fourOrFive = sentences.slice(0, Math.max(4, Math.min(5, sentences.length)));
  return normalizeBulletItems(fourOrFive);
}

function formatWhen(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getTableForCountry(country: PreferredCountry) {
  return COUNTRY_OPTIONS.find((option) => option.value === country)?.table ?? "news_articles";
}

export default function InshortsStylePage() {
  const [category, setCategory] = useState<Category>("All");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [country, setCountry] = useState<PreferredCountry | null>(null);
  const [countryReady, setCountryReady] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [savingCountry, setSavingCountry] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);

  const fetchProfileCountry = useCallback(async (currentUserId: string) => {
    const { data, error: profileError } = await supabaseBrowser
      .from("user_profiles")
      .select("id, preferred_country")
      .eq("id", currentUserId)
      .maybeSingle();

    if (profileError) {
      throw new Error(profileError.message);
    }

    return data as UserProfile | null;
  }, []);

  const bootstrapCountryPreference = useCallback(async () => {
    setError(null);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabaseBrowser.auth.getSession();

      if (sessionError) throw sessionError;

      const authUser = session?.user ?? null;
      if (authUser) {
        setIsLoggedIn(true);
        setUserId(authUser.id);
        const profile = await fetchProfileCountry(authUser.id);
        if (profile?.preferred_country) {
          setCountry(profile.preferred_country);
          setCountryPickerOpen(false);
        } else {
          setCountryPickerOpen(true);
        }
      } else {
        setIsLoggedIn(false);
        setUserId(null);
        const guestCountry = window.localStorage.getItem(GUEST_COUNTRY_KEY) as PreferredCountry | null;
        const promptedThisSession = window.sessionStorage.getItem(GUEST_PROMPTED_KEY) === "true";

        if (guestCountry && ["mauritius", "uae", "india"].includes(guestCountry)) {
          setCountry(guestCountry);
        }

        if (!promptedThisSession || !guestCountry) {
          setCountryPickerOpen(true);
          window.sessionStorage.setItem(GUEST_PROMPTED_KEY, "true");
        }
      }
    } catch (e: any) {
      console.error("Preference bootstrap error", e);
      const guestCountry = window.localStorage.getItem(GUEST_COUNTRY_KEY) as PreferredCountry | null;
      const promptedThisSession = window.sessionStorage.getItem(GUEST_PROMPTED_KEY) === "true";

      setIsLoggedIn(false);
      setUserId(null);
      setCountry(guestCountry && ["mauritius", "uae", "india"].includes(guestCountry) ? guestCountry : null);
      if (!promptedThisSession || !guestCountry) {
        setCountryPickerOpen(true);
        window.sessionStorage.setItem(GUEST_PROMPTED_KEY, "true");
      }
    } finally {
      setCountryReady(true);
    }
  }, [fetchProfileCountry]);

  useEffect(() => {
    bootstrapCountryPreference();

    const {
      data: { subscription },
    } = supabaseBrowser.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setIsLoggedIn(true);
        setUserId(session.user.id);
        try {
          const profile = await fetchProfileCountry(session.user.id);
          if (profile?.preferred_country) {
            setCountry(profile.preferred_country);
            setCountryPickerOpen(false);
          } else {
            setCountryPickerOpen(true);
          }
        } catch (e: any) {
          setError(e?.message || "Failed to load preference");
        } finally {
          setCountryReady(true);
        }
      } else {
        setIsLoggedIn(false);
        setUserId(null);
        const guestCountry = window.localStorage.getItem(GUEST_COUNTRY_KEY) as PreferredCountry | null;
        setCountry(guestCountry && ["mauritius", "uae", "india"].includes(guestCountry) ? guestCountry : null);
        setCountryReady(true);
      }
    });

    return () => subscription.unsubscribe();
  }, [bootstrapCountryPreference, fetchProfileCountry]);

  async function saveCountryPreference(nextCountry: PreferredCountry) {
    setSavingCountry(true);
    setError(null);
    try {
      if (isLoggedIn && userId) {
        const { error: upsertError } = await supabaseBrowser
          .from("user_profiles")
          .upsert(
            {
              id: userId,
              preferred_country: nextCountry,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" }
          );

        if (upsertError) throw upsertError;
      } else {
        window.localStorage.setItem(GUEST_COUNTRY_KEY, nextCountry);
        window.sessionStorage.setItem(GUEST_PROMPTED_KEY, "true");
      }

      setCountry(nextCountry);
      setCountryPickerOpen(false);
      setSettingsOpen(false);
      setDrawerOpen(false);
    } catch (e: any) {
      console.error("Save preference error", e);
      setError(e?.message || "Failed to save preferred country");
    } finally {
      setSavingCountry(false);
    }
  }

  const loadNews = useCallback(async (pageNumber: number, replace = false) => {
    if (!country) return;

    setLoading(true);
    setError(null);
    try {
      let q: any = supabaseBrowser
        .from(getTableForCountry(country))
        .select("*")
        .order("created_at", { ascending: false })
        .range(pageNumber * 10, pageNumber * 10 + 9);

      if (category && category !== "All") q = q.eq("topics", category);

      const { data, error: queryError } = await q;
      if (queryError) throw new Error(queryError.message);

      const mapped: NewsItem[] = (data || []).map((row: any) => {
        const best = row.published_at ?? row.pub_date ?? row.created_at ?? null;
        return {
          id: row.id,
          title: row.title,
          summary: normalizeSummaryForDisplay(row.summary ?? row.description ?? ""),
          imageUrl: row.image_url ?? row.image ?? undefined,
          publishedAt: best,
          sourceUrl: row.source_url ?? undefined,
          source: row.source ?? undefined,
          author: row.author ?? undefined,
        };
      });

      if (mapped.length < 10) setHasMore(false);
      setItems((prev) => (replace ? mapped : [...prev, ...mapped]));
    } catch (e: any) {
      console.error("Load news error", e);
      setError(e?.message || "Failed to load news");
    } finally {
      setLoading(false);
    }
  }, [category, country]);

  useEffect(() => {
    if (!countryReady || !country) return;
    setItems([]);
    setPage(0);
    setHasMore(true);
    loadNews(0, true);
  }, [countryReady, country, category, loadNews]);

  useEffect(() => {
    if (loading || !country) return;
    const node = loaderRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          setPage((p) => p + 1);
        }
      },
      { threshold: 1 }
    );
    if (node) observer.observe(node);
    return () => {
      if (node) observer.unobserve(node);
    };
  }, [country, hasMore, loading]);

  useEffect(() => {
    if (page === 0 || !country) return;
    loadNews(page);
  }, [page, country, loadNews]);

  async function reloadNow() {
    if (!country) return;

    setLoading(true);
    setError(null);
    try {
      let q: any = supabaseBrowser
        .from(getTableForCountry(country))
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (category && category !== "All") q = q.eq("topics", category);

      const { data, error: queryError } = await q;
      if (queryError) throw queryError;

      const mapped = (data || []).map((row: any) => {
        const best = row.published_at ?? row.pub_date ?? row.created_at ?? null;
        return {
          id: row.id,
          title: row.title,
          summary: normalizeSummaryForDisplay(row.summary ?? row.description ?? ""),
          imageUrl: row.image_url ?? row.image ?? undefined,
          publishedAt: best,
          sourceUrl: row.source_url ?? undefined,
          source: row.source ?? undefined,
          author: row.author ?? undefined,
        };
      });

      mapped.sort((a: any, b: any) => {
        const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return tb - ta;
      });
      setItems(mapped.slice(0, 20));
    } catch (e: any) {
      console.error("Reload error", e);
      setError(e?.message || "Reload failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  const isInitialLoad = (loading && items.length === 0) || !countryReady;
  const isRefreshing = loading && items.length > 0 && page === 0;
  const isLoadingMore = loading && items.length > 0 && page > 0;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 relative">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
          <button
            className="inline-flex items-center justify-center rounded-xl border border-gray-200 p-2 hover:bg-gray-100"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path
                fillRule="evenodd"
                d="M3.75 5.25a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Zm0 6a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Zm.75 5.25a.75.75 0 0 0 0 1.5h15a.75.75 0 0 0 0-1.5h-15Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <Image src="/Logo.png" alt="No Logo Found" width={160} height={80} />
          <div className="ml-auto flex items-center gap-3">
            {country && (
              <button
                onClick={() => setCountryPickerOpen(true)}
                className="rounded-md px-3 py-2 border border-gray-200 bg-white text-sm hover:bg-gray-50"
              >
                {COUNTRY_OPTIONS.find((option) => option.value === country)?.label}
              </button>
            )}
            <Link
              href="/"
              className="rounded-md px-3 py-2 bg-black text-white text-sm hover:bg-black/80 cursor-pointer"
            >
              Home
            </Link>
            <button
              onClick={() => reloadNow()}
              className="rounded-md px-3 py-2 bg-black text-white text-sm hover:bg-black/80 cursor-pointer"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="bg-black text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 text-sm sm:text-base flex items-center gap-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path
                  fillRule="evenodd"
                  d="M12 2.25a.75.75 0 0 1 .75.75v17.19l4.72-4.72a.75.75 0 1 1 1.06 1.06l-6 6a.75.75 0 0 1-1.06 0l-6-6a.75.75 0 0 1 1.06-1.06l4.72 4.72V3a.75.75 0 0 1 .75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <p className="font-medium">
              {country
                ? `Showing ${COUNTRY_OPTIONS.find((option) => option.value === country)?.label} news`
                : "Choose a country to start reading"}
            </p>
          </div>
        </div>
      </header>

      {drawerOpen && (
        <button
          aria-label="Close menu overlay"
          className="fixed inset-0 z-30 bg-black/40"
          onClick={() => setDrawerOpen(false)}
        />
      )}

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

        <div className="px-4 py-4 border-b border-gray-100">
          <button
            onClick={() => setSettingsOpen((open) => !open)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-left text-sm font-medium hover:bg-gray-50"
          >
            Settings
          </button>
          {settingsOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-500">Preferred country</p>
              {COUNTRY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => saveCountryPreference(option.value)}
                  disabled={savingCountry}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    country === option.value
                      ? "border-black bg-black text-white"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="py-2 max-h-[calc(100vh-180px)] overflow-auto">
          <ul>
            {CATEGORIES.map((cat) => (
              <li key={cat}>
                <button
                  onClick={() => {
                    setCategory(cat);
                    setDrawerOpen(false);
                  }}
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

      {countryPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-gray-900">
              Choose your preferred country
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {isLoggedIn
                ? "We will save this to your profile and use it whenever you sign in."
                : "We will use this on this device so you keep seeing the right news feed."}
            </p>
            <div className="mt-5 space-y-3">
              {COUNTRY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => saveCountryPreference(option.value)}
                  disabled={savingCountry}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left hover:bg-gray-50"
                >
                  <span className="block text-sm font-semibold text-gray-900">
                    {option.label}
                  </span>
                  <span className="block text-xs text-gray-500">
                    Show {option.label} stories by default
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 pb-20">
        {(isInitialLoad || isRefreshing || savingCountry) && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-40">
            <Loader className="animate-spin w-10 h-10 text-gray-600" />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && countryReady && !country && !error && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            Choose a country to load your news feed.
          </div>
        )}

        {!loading && country && items.length === 0 && !error && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            No news found.
          </div>
        )}

        {items.map((n, index) => (
          <article
            key={`${n.id}-${index}`}
            className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 sm:p-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-[280px,1fr] gap-4">
              <div className="relative aspect-[16/9] sm:aspect-auto sm:h-44 overflow-hidden rounded-xl bg-gray-100">
                <img
                  src={n.imageUrl || "/Logo.png"}
                  alt={n.title}
                  onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                    e.currentTarget.src = "/Logo.png";
                  }}
                  className="h-full w-full object-cover object-top"
                />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold leading-snug">
                  {n.title}
                </h2>
                <div className="text-xs text-gray-500">
                  {n.author ? `short by ${n.author}` : "short"}
                  {n.publishedAt ? ` / ${formatWhen(n.publishedAt)}` : null}
                </div>
                <div className="space-y-2 text-sm leading-6 text-gray-700">
                  {n.summary.map((bullet, bulletIndex) => (
                    <div key={`${n.id}-${bulletIndex}`} className="flex items-start gap-2">
                      <span className="mt-1 text-base leading-none text-gray-900">•</span>
                      <p className="flex-1">{bullet}</p>
                    </div>
                  ))}
                </div>
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

        {isLoadingMore && (
          <div className="text-gray-500 flex justify-center py-4">
            <Loader className="animate-spin w-8 h-8" />
          </div>
        )}

        <div ref={loaderRef} className="h-10" />

        {!hasMore && !loading && items.length > 0 && (
          <div className="text-center text-sm text-gray-500 py-4">
            No more news.
          </div>
        )}
      </main>
    </div>
  );
}
