import { Hono } from "hono";
import { scrapeCinemaxMovies } from "./handlers/scrape.js";

export const cinemaxRoute = new Hono()
  .get("/", async (c) => {
    const movies = await scrapeCinemaxMovies();
    if (movies.error) {
      return c.json({ error: movies.error }, 500);
    }
    if (!movies.data) {
      return c.json({ error: "No movies found" }, 404);
    }
    return c.json({ data: movies.data }, 200);
  })
  .get("/movies", (c) => c.text("Hello Hono!"));
