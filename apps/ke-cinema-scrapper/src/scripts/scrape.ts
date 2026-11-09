import { scrapeCinemaxMovies } from "../routes/cinemax/handlers/scrape.js";

await scrapeCinemaxMovies().then((movies) => {
  if (movies.error) {
    console.error(movies.error);
  }
  if (!movies.data) {
    console.error("Error: No movies found");
  }
  console.log("Result:", movies.data);
});
