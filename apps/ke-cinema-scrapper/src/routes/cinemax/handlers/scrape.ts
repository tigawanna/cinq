import puppeteer from "puppeteer";

export async function scrapeCinemaxMovies() {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
  });
  try {
    // Or import puppeteer from 'puppeteer-core';

    // Launch the browser and open a new blank page.
    const page = await browser.newPage();

    // Navigate the page to a URL.
    await page.goto("https://developer.chrome.com/");

    // Set the screen size.
    await page.setViewport({ width: 1080, height: 1024 });

    // Open the search menu using the keyboard.
    await page.keyboard.press("/");

    // Type into search box using accessible input name.
    await page.locator("::-p-aria(Search)").fill("automate beyond recorder");

    // Wait and click on first result.
    await page.locator(".devsite-result-item-link").click();

    // Locate the full title with a unique string.
    const textSelector = await page.locator("::-p-text(Customize and automate)").waitHandle();
    const fullTitle = await textSelector?.evaluate((el) => el.textContent);

    // Print the full title.
    console.log('The title of this blog post is "%s".', fullTitle);
    return { data: fullTitle, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error: "Failed to scrape Cinemax movies" };
  } finally {
    await browser.close();
  }
}
