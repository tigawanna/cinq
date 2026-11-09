import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CINEMAX_TWO_RIVERS_URL, TWO_RIVERS_SLUG } from "./contsnants.js";

/**
 * Scrapes every movie at Century Cinemax Two Rivers by id.
 *
 * The site is server-rendered Laravel + Livewire, so there is no public JSON
 * API to lean on. Instead we use two stable, name-independent anchors:
 *
 *  1. Listing page  : a[name="movie_code"]  -> one anchor per movie, href is
 *                     /movie/show/<cinema-slug>/<movie-slug>.
 *  2. Detail page   : input[name="movie_code"] -> the numeric cinema movie id,
 *                     and [wire\:snapshot] -> the full Livewire payload with
 *                     the Title model key plus every date/showtime/screen.
 *
 * Nothing here keys off a movie title. Titles are only captured for display.
 *
 * Run with:
 *   pnpm exec playwright test tests/cinemax/list-movies.spec.ts --project=chromium
 */

type MovieCard = {
  href: string;
  slug: string;
  name: string;
  poster: string;
  rating: string | null;
  runtime: string | null;
};

type LivewireShowTime = {
  code: string;
  hall: string;
  hallCode: string;
  reserved: string;
  time: string; // YYYYMMDDHHmmss
};

type LivewireSnapshot = {
  data?: {
    movie?: [null, { class: string; key: number; s: string }] | null;
    showDates?: Record<string, unknown>;
    showTimes?: unknown;
    date?: string;
    [key: string]: unknown;
  };
};

type ShowTime = {
  code: string;
  date: string; // YYYY-MM-DD
  startsAt: string; // YYYY-MM-DDTHH:mm:ss (cinema local time)
  timeLabel: string; // e.g. 3:15 PM
  screen: string; // e.g. Screen 3
  screenCode: string; // e.g. SCTHREE
  reservedSeating: boolean;
};

type ScrapedMovie = {
  cinema: string; // rivers
  movieCode: string; // numeric id used by the booking form
  titleId: number | null; // Laravel App\Models\Title primary key
  slug: string;
  url: string;
  name: string; // display only
  rating: string | null;
  runtime: string | null;
  poster: string | null;
  synopsis: string | null;
  showtimes: ShowTime[];
};

function showTimeFromLivewire(raw: LivewireShowTime): ShowTime {
  const dateKey = raw.time.slice(0, 8);
  const date = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
  const hour24 = Number(raw.time.slice(8, 10));
  const minute = raw.time.slice(10, 12);
  const second = raw.time.slice(12, 14);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return {
    code: raw.code,
    date,
    startsAt: `${date}T${raw.time.slice(8, 10)}:${minute}:${second}`,
    timeLabel: `${hour12}:${minute} ${hour24 < 12 ? "AM" : "PM"}`,
    screen: raw.hall,
    screenCode: raw.hallCode,
    reservedSeating: raw.reserved === "1",
  };
}

async function collectMovieCards(page: Page): Promise<MovieCard[]> {
  const cards = await page.locator('a[name="movie_code"]').evaluateAll((nodes) =>
    (nodes as HTMLAnchorElement[]).map((anchor) => {
      const pathParts = new URL(anchor.href).pathname.split("/").filter(Boolean);
      const spans = Array.from(anchor.querySelectorAll("span")).map((span) =>
        (span.textContent ?? "").trim(),
      );

      return {
        href: anchor.href,
        slug: pathParts.at(-1) ?? "",
        name: (anchor.querySelector("p")?.textContent ?? "").trim(),
        poster: anchor.querySelector("img")?.getAttribute("src") ?? "",
        rating: spans.find((text) => /^(TBC|\d+\+)$/.test(text)) ?? null,
        runtime: spans.find((text) => /\d+h\s*\d+m/.test(text)) ?? null,
      };
    }),
  );

  return cards;
}

async function scrapeMovie(page: Page, card: MovieCard): Promise<ScrapedMovie> {
  await page.goto(card.href, { waitUntil: "domcontentloaded" });

  // Numeric cinema id for this movie (booking form field).
  const movieCodeInput = page.locator('input[name="movie_code"]');
  await expect(movieCodeInput).toHaveCount(1);
  const movieCode = (await movieCodeInput.inputValue()).trim();
  expect(movieCode).toMatch(/^\d+$/);

  const synopsis = (
    await page
      .locator('input[name="synopsis"]')
      .first()
      .inputValue()
      .catch(() => "")
  ).trim();

  const posterAttr = (
    await page
      .locator('input[name="poster"]')
      .first()
      .inputValue()
      .catch(() => "")
  ).trim();

  const rawSnapshot = await page.locator("[wire\\:snapshot]").first().getAttribute("wire:snapshot");
  const snapshot = rawSnapshot ? (JSON.parse(rawSnapshot) as LivewireSnapshot) : undefined;

  // Laravel App\Models\Title key from the Livewire model reference.
  const movieRef = snapshot?.data?.movie;
  const titleId =
    Array.isArray(movieRef) &&
    movieRef[1] !== null &&
    typeof movieRef[1] === "object" &&
    typeof (movieRef[1] as { key?: unknown }).key === "number"
      ? (movieRef[1] as { key: number }).key
      : null;

  // The snapshot holds every bookable date, showtime and screen. Livewire
  // nests/wraps PHP arrays in several shapes, so instead of decoding the
  // envelope we recursively collect every showtime record by its own shape.
  const showtimesByCode = new Map<string, ShowTime>();
  const collectShowTimes = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) collectShowTimes(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    if (
      typeof record.code === "string" &&
      typeof record.time === "string" &&
      typeof record.hall === "string" &&
      /^\d{14}$/.test(record.time)
    ) {
      const show = showTimeFromLivewire(record as LivewireShowTime);
      showtimesByCode.set(show.code, show);
      return;
    }

    for (const nested of Object.values(record)) collectShowTimes(nested);
  };

  collectShowTimes(snapshot?.data);

  const showtimes = [...showtimesByCode.values()].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );

  // Fallback for the poster: JSON-LD always carries the canonical movie image.
  let poster = posterAttr || card.poster || null;
  if (!poster) {
    const jsonLd = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) =>
      scripts
        .map((script) => {
          try {
            return JSON.parse(script.textContent ?? "") as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((value): value is Record<string, unknown> => value !== null),
    );

    const movieLd = jsonLd.find((entry) => entry["@type"] === "Movie");
    if (movieLd && typeof movieLd.image === "string") poster = movieLd.image;
  }

  return {
    cinema: TWO_RIVERS_SLUG,
    movieCode,
    titleId,
    slug: card.slug,
    url: card.href,
    name: card.name,
    rating: card.rating,
    runtime: card.runtime,
    poster,
    synopsis: synopsis || null,
    showtimes,
  };
}

test("scrapes every Two Rivers movie by id, with showtimes and screens", async ({
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(180_000);

  await page.goto(CINEMAX_TWO_RIVERS_URL, { waitUntil: "domcontentloaded" });

  // Server-rendered cards: stable hook is the name attribute, not the title.
  const cardLocator = page.locator('a[name="movie_code"]');
  await expect(cardLocator.first()).toBeVisible();

  const cards = await collectMovieCards(page);
  expect(cards.length).toBeGreaterThan(0);

  const movies: ScrapedMovie[] = [];
  for (const card of cards) {
    expect(card.href).toContain(`/movie/show/${TWO_RIVERS_SLUG}/`);
    movies.push(await scrapeMovie(page, card));
  }

  // Every movie must expose its numeric id, and at least one must be bookable.
  for (const movie of movies) {
    expect(movie.movieCode, `missing movie_code for ${movie.slug}`).toMatch(/^\d+$/);
    expect(movie.showtimes.every((show) => show.code && show.screen)).toBe(true);
  }
  expect(movies.flatMap((movie) => movie.showtimes).length).toBeGreaterThan(0);

  const outputDir = path.resolve(process.cwd(), "data");
  const outputFile = path.join(outputDir, "two-rivers-movies.json");
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(movies, null, 2)}\n`, "utf8");
  await testInfo.attach("two-rivers-movies.json", {
    path: outputFile,
    contentType: "application/json",
  });

  console.table(
    movies.map((movie) => ({
      movieCode: movie.movieCode,
      titleId: movie.titleId,
      slug: movie.slug,
      shows: movie.showtimes.length,
      screens: [...new Set(movie.showtimes.map((show) => show.screen))].join(", "),
    })),
  );
  console.log(`Wrote ${movies.length} movies to ${outputFile}`);
});
