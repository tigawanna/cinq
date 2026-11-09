import { Hono } from "hono";

export const cinemaxRoute = new Hono()
  .get("/", (c) => c.text("Hello Hono!"))
  .get("/movies", (c) => c.text("Hello Hono!"));
