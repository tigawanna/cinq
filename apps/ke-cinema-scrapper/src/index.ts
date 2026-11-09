import { serve } from "@hono/node-server";
import { app } from "./routes/main.js";

serve(
  {
    fetch: app.fetch,
    port: 7000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
