// Skip Google's EU cookie-consent interstitial (consent.yt.com /
// consent.google.com) by pre-seeding the consent cookie with the
// "only essential cookies" (Reject all) choice. An existing choice is kept.

import type { Session } from "electron";

/** SOCS value Google sets for "Reject all"; the same one yt-dlp uses. */
const ESSENTIAL_ONLY = "CAI";

const CONSENT_DOMAINS = ["\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com", "google.com"];

// Google's own consent cookie lives ~13 months.
const LIFETIME_SECONDS = 400 * 24 * 60 * 60;

export async function seedConsent(session: Session) {
  const expirationDate = Date.now() / 1000 + LIFETIME_SECONDS;
  await Promise.all(
    CONSENT_DOMAINS.map(async (domain) => {
      const existing = await session.cookies.get({ domain, name: "SOCS" });
      if (existing.length > 0) return;
      await session.cookies.set({
        url: `https://www.${domain}/`,
        domain: `.${domain}`,
        path: "/",
        name: "SOCS",
        value: ESSENTIAL_ONLY,
        secure: true,
        sameSite: "lax",
        expirationDate,
      });
    }),
  );
}
