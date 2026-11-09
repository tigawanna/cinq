import { TigawannaCredit } from "@tigawanna/credit";
import "@tigawanna/credit/styles.css";
import { landingFooter } from "@/content/landing";
import { AppConfig } from "@/utils/system";

export function LandingFooter() {
  return (
    <footer className="border-t border-base-300 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 md:flex-row">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-content">
            {AppConfig.wordmark}
          </span>
          <span className="font-semibold">{AppConfig.name}</span>
        </div>
        <p className="text-sm text-neutral-content">{landingFooter.tagline}</p>
      </div>
      <div className="mx-auto mt-6 flex max-w-6xl justify-center">
        <TigawannaCredit position="inline" />
      </div>
    </footer>
  );
}
