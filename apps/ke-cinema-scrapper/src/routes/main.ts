import { Hono } from "hono";
import { cinemaxRoute } from "./cinemax/index.js";

export const app = new Hono()
  .get("/", (c) => c.text("Welcome to the CineFam API!"))
  .route("/cinemax", cinemaxRoute);
